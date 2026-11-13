import {
  type OwnAdataRead,
  ownAdataReadSchema,
  type OwnProfile,
  ownProfileSchema,
  PREFILL_FIELDS,
  PROFILE_SECTIONS,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import {
  catalogVisible,
  externalCheck,
  externalCheckAttempt,
  manufacturerProfiles,
  organizations,
  prefilledValue,
  profileSections,
  sectionRevisions,
} from '../../database/schema/index.js';

/**
 * Профиль производителя. Каркас: создание Draft с восемью секциями и рабочими редакциями.
 * Редактирование секций, полнота, отправка, разблокировка и pending changes —
 * следующие итерации (архитектура §7–8, MAN-10…96).
 */
@Injectable()
export class ProfilesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Свой профиль производителя, только для чтения (MAN-41, MAN-46, IMBC-22). Ищется только по организации
   * сеанса (GEN-11); у организации без профиля — 404. Статус актуальности и тир — только у Verified
   * (раздел 5.5). Тир — из строки своего профиля в catalog_visible: site surveyed хранится только там;
   * Verified вне проекции — tier_1 (IMBC-19, IMBC-20). Ответ не по схеме — сбой сервера (500), а не 400.
   */
  async own(organizationId: string): Promise<OwnProfile> {
    const p = manufacturerProfiles;
    const [row] = await this.db
      .select({
        profileId: p.id,
        organizationName: organizations.name,
        bin: organizations.bin,
        status: p.status,
        hasPendingChanges: p.hasPendingChanges,
        updateStatus: p.updateStatus,
        projectedTier: catalogVisible.tier,
        completenessPct: p.completenessPct,
        registeredAt: p.registeredAt,
        verifiedAt: p.verifiedAt,
      })
      .from(p)
      .innerJoin(organizations, eq(organizations.id, p.organizationId))
      .leftJoin(catalogVisible, eq(catalogVisible.profileId, p.id))
      .where(eq(p.organizationId, organizationId))
      .limit(1);
    if (!row) throw new ProblemException(404, 'not_found', 'Профиль не найден');

    const { projectedTier, updateStatus, registeredAt, verifiedAt, ...fields } = row;
    const verified = row.status === 'verified';
    return parseResponse(
      ownProfileSchema,
      {
        ...fields,
        updateStatus: verified ? updateStatus : null,
        // site_surveyed пока есть только в проекции: Verified и site surveyed вне её (например, due diligence red)
        // показывается tier_1, хотя по IMBC-20 это tier 2; перейти на site_survey_records, когда они появятся.
        tier: verified ? (projectedTier ?? 'tier_1') : null,
        registeredAt: registeredAt.toISOString(),
        verifiedAt: verifiedAt?.toISOString() ?? null,
      },
      'свой профиль',
    );
  }

  /**
   * Чтение Adata своего профиля (MAN-06, MAN-07, IMBC-07). Профиль, проверка, попытка и значения ищутся только
   * по организации сеанса (GEN-11); у организации без профиля — 404. Нет проверки или попытки — not_requested,
   * queued и polling — waiting, иначе состояние попытки; недоступность Adata — состояние, не ошибка (EXT-04).
   * Значения — только у received. failure, poll_token, bin, value попытки и квота не выбираются, а строгая
   * схема ответа не пропустит лишний ключ. Adata не вызывается, попытка и задание не создаются.
   */
  async ownAdata(organizationId: string): Promise<OwnAdataRead> {
    const p = manufacturerProfiles;
    const a = externalCheckAttempt;
    const [row] = await this.db
      .select({ attemptId: a.id, state: a.state, requestedAt: a.requestedAt, completedAt: a.completedAt })
      .from(p)
      .leftJoin(
        externalCheck,
        and(
          eq(externalCheck.profileId, p.id),
          eq(externalCheck.organizationId, organizationId),
          eq(externalCheck.connector, 'adata'),
        ),
      )
      .leftJoin(a, eq(a.id, externalCheck.latestAttemptId))
      .where(eq(p.organizationId, organizationId))
      .limit(1);
    if (!row) throw new ProblemException(404, 'not_found', 'Профиль не найден');

    const read = (value: OwnAdataRead) => parseResponse(ownAdataReadSchema, value, 'чтение Adata');
    if (!row.attemptId || !row.state || !row.requestedAt)
      return read({ state: 'not_requested', requestedAt: null, readAt: null, fields: [] });

    const requestedAt = row.requestedAt.toISOString();
    if (row.state !== 'received') {
      const state = row.state === 'queued' || row.state === 'polling' ? 'waiting' : row.state;
      return read({ state, requestedAt, readAt: null, fields: [] });
    }

    const v = prefilledValue;
    const values = await this.db
      .select({ field: v.field, value: v.value, label: v.label, readAt: v.readAt })
      .from(v)
      .where(and(eq(v.attemptId, row.attemptId), eq(v.organizationId, organizationId), eq(v.source, 'adata')))
      .orderBy(asc(v.position));
    // Порядок показа — PREFILL_FIELDS; поле, которого Adata не вернул, в ответ не входит.
    const fields = PREFILL_FIELDS.flatMap((field) => {
      const rows = values.filter((r) => r.field === field);
      if (rows.length === 0) return [];
      return [
        {
          field,
          source: 'adata' as const,
          readAt: rows[0]!.readAt.toISOString(),
          items: rows.map(({ value, label }) => ({ value, label })),
        },
      ];
    });
    return read({ state: 'received', requestedAt, readAt: row.completedAt?.toISOString() ?? null, fields });
  }

  /**
   * Профиль Draft с восемью секциями (MAN-03). Создаётся, когда задан пароль (NOT-23): событием Keycloak
   * или первым входом — `ManufacturerOnboardingService.onPasswordSet`. Draft виден только производителю
   * и IMBC (MAN-04). `registeredAt` — момент установки пароля (DBML). Идемпотентно.
   */
  async ensureDraft(
    organizationId: string,
    authorId: string,
    opts: { heardAboutUs?: string | null; registeredAt?: Date; outer?: Database } = {},
  ): Promise<string> {
    return (opts.outer ?? this.db).transaction(async (tx) => {
      const existing = await tx.query.manufacturerProfiles.findFirst({
        where: eq(manufacturerProfiles.organizationId, organizationId),
      });
      if (existing) return existing.id;

      const [profile] = await tx
        .insert(manufacturerProfiles)
        .values({ organizationId, heardAboutUs: opts.heardAboutUs ?? null, registeredAt: opts.registeredAt })
        .onConflictDoNothing({ target: manufacturerProfiles.organizationId })
        .returning({ id: manufacturerProfiles.id });
      if (!profile) {
        const raced = await tx.query.manufacturerProfiles.findFirst({
          where: eq(manufacturerProfiles.organizationId, organizationId),
        });
        return raced!.id;
      }

      for (const kind of PROFILE_SECTIONS) {
        const [section] = await tx
          .insert(profileSections)
          .values({ profileId: profile.id, kind })
          .returning({ id: profileSections.id });
        const [revision] = await tx
          .insert(sectionRevisions)
          .values({ sectionId: section!.id, number: 1, authorId })
          .returning({ id: sectionRevisions.id });
        await tx
          .update(profileSections)
          .set({ workingRevisionId: revision!.id })
          .where(eq(profileSections.id, section!.id));
      }
      return profile.id;
    });
  }
}

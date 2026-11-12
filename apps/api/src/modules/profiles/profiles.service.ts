import { type OwnProfile, ownProfileSchema, PROFILE_SECTIONS } from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import {
  catalogVisible,
  manufacturerProfiles,
  organizations,
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
   * Профиль Draft с восемью секциями (MAN-03). Создаётся при регистрации — Draft виден
   * только производителю и IMBC (MAN-04) — и при первом входе, если его ещё нет. Идемпотентно.
   */
  async ensureDraft(
    organizationId: string,
    authorId: string,
    opts: { heardAboutUs?: string | null; outer?: Database } = {},
  ): Promise<string> {
    return (opts.outer ?? this.db).transaction(async (tx) => {
      const existing = await tx.query.manufacturerProfiles.findFirst({
        where: eq(manufacturerProfiles.organizationId, organizationId),
      });
      if (existing) return existing.id;

      const [profile] = await tx
        .insert(manufacturerProfiles)
        .values({ organizationId, heardAboutUs: opts.heardAboutUs ?? null })
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

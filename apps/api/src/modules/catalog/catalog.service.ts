import {
  type CatalogFilter,
  type CatalogPage,
  type CompanyCardData,
  type CompanyPage,
  companyCardDataSchema,
  type Dashboard,
  dashboardSchema,
  normalizeCompanyName,
  type Role,
  type Scope,
} from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, arrayOverlaps, asc, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { ProblemException } from '../../common/problem.js';
import { AuditService } from '../../common/audit.service.js';
import { policyForTransaction } from '../../common/policy.js';
import { DB, type Database } from '../../database/database.module.js';
import { catalogVisible } from '../../database/schema/index.js';
import { VALKEY } from '../../infra/infra.module.js';
import { loadCurrentCompanySurvey } from '../site-survey/site-survey-company.js';
import type { AuthUser } from '../auth/auth.types.js';

const t = catalogVisible;
const DASHBOARD_TTL_S = 60;
/** v2: счётчики по статусу актуальности v1.3 (UPD-06). Кеш прежней формы (dashboard:v1) не читается. */
const DASHBOARD_CACHE_KEY = 'dashboard:v2';

/** card прежней формы (например, `{ demo: true }`) — контактов нет. */
const NO_CONTACTS: CompanyCardData = { companyPhone: null, companyEmail: null, focalPoint: null };
const isoDate = z.iso.date();

/** Дата сертификата из certificates_valid_until (тип → дата); нет записи или не дата — null. */
function validUntil(dates: unknown, type: string): string | null {
  if (dates === null || typeof dates !== 'object' || Array.isArray(dates)) return null;
  const value: unknown = (dates as Record<string, unknown>)[type];
  return isoDate.safeParse(value).success ? (value as string) : null;
}

/** Запись кеша дашборда, если она разбирается и проходит dashboardSchema; иначе null — считаем заново. */
function cachedDashboard(raw: string | null): Dashboard | null {
  if (!raw) return null;
  try {
    const parsed = dashboardSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Порядок выдачи: unresponsive ниже active и outdated при любой сортировке (UPD-04, OPR-01, OPR-33),
 * затем ключи выбранной сортировки. Между active и outdated порядка нет. Последний ключ — первичный
 * ключ проекции profile_id: смысла не несёт, только делает страницы устойчивыми при равных ключах.
 */
export function catalogOrder(sort: CatalogFilter['sort']): SQL[] {
  const keys = {
    name: [asc(t.nameRu)],
    verified_at: [desc(t.verifiedAt)],
    region: [asc(t.region), asc(t.nameRu)],
  }[sort];
  return [sql`(${t.updateStatus} = 'unresponsive') asc`, ...keys, asc(t.profileId)];
}

/**
 * Каталог и дашборд читают только проекцию catalog_visible (архитектура §10):
 * в ней нет записей IMBC, заметок операторов и ожидающих значений (DATA-34).
 * Видимый профиль — Verified и due diligence green/amber при любом статусе актуальности
 * (раздел 4); unresponsive остаётся в выдаче (UPD-04).
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(VALKEY) private readonly valkey: Redis,
    private readonly audit: AuditService = new AuditService(db),
  ) {}

  /** Между фильтрами — AND, внутри одного фильтра — OR (OPR-04). */
  buildConditions(f: CatalogFilter): SQL[] {
    const where: SQL[] = [];
    if (f.q) {
      const digits = f.q.replace(/\s+/g, '');
      if (/^\d{3,12}$/.test(digits)) {
        where.push(sql`${t.bin} like ${`${digits}%`}`);
      } else {
        const norm = normalizeCompanyName(f.q);
        // Подстрока или похожее слово (word_similarity): опечатки и «й/и» не мешают найти компанию (OPR-07).
        where.push(sql`(${t.nameNormalized} like ${`%${norm}%`} or ${norm} <% ${t.nameNormalized})`);
      }
    }
    if (f.region?.length) where.push(inArray(t.region, f.region));
    if (f.group?.length) where.push(arrayOverlaps(t.commodityGroups, f.group));
    if (f.type?.length) where.push(arrayOverlaps(t.commodityTypes, f.type));
    if (f.cert?.length) {
      // По умолчанию — только действующие верифицированные сертификаты (OPR-04).
      where.push(
        f.certAnyStatus
          ? arrayOverlaps(t.certificateTypes, f.cert)
          : sql`exists (select 1 from jsonb_each_text(${t.certificatesValidUntil}) c
                where c.key in ${f.cert} and (c.value is null or c.value::date >= current_date))`,
      );
    }
    if (f.surveyed !== undefined) where.push(eq(t.siteSurveyed, f.surveyed));
    if (f.tier?.length) where.push(inArray(t.tier, f.tier));
    if (f.tnved) where.push(sql`exists (select 1 from unnest(${t.tnvedCodes}) c where c like ${`${f.tnved}%`})`);
    if (f.kpved) where.push(sql`exists (select 1 from unnest(${t.kpvedCodes}) c where c like ${`${f.kpved}%`})`);
    if (f.oked?.length) where.push(arrayOverlaps(t.okedCodes, f.oked));
    if (f.worksWith?.length) where.push(inArray(t.worksWithCount, f.worksWith));
    if (f.headcountMin !== undefined) where.push(gte(t.headcountTotal, f.headcountMin));
    if (f.headcountMax !== undefined) where.push(lte(t.headcountTotal, f.headcountMax));
    if (f.certValidUntil) {
      where.push(
        sql`exists (select 1 from jsonb_each_text(${t.certificatesValidUntil}) c
            where c.value is null or c.value::date >= ${f.certValidUntil}::date)`,
      );
    }
    if (f.unifiedRegister !== undefined) where.push(eq(t.unifiedRegister, f.unifiedRegister));
    if (f.verifiedFrom) where.push(gte(t.verifiedAt, new Date(f.verifiedFrom)));
    if (f.verifiedTo) where.push(lte(t.verifiedAt, new Date(`${f.verifiedTo}T23:59:59+05:00`)));
    return where;
  }

  async search(f: CatalogFilter, scope: Scope): Promise<CatalogPage> {
    // TODO(scope=all): эксперт и директор ищут по всем профилям, включая Draft и Returned
    // (раздел 4). Для них нужна отдельная внутренняя проекция; пока — видимые профили.
    void scope;
    const conditions = this.buildConditions(f);

    const rows = await this.db
      .select({
        profileId: t.profileId,
        bin: t.bin,
        nameEn: t.nameEn,
        nameRu: t.nameRu,
        region: t.region,
        commodityGroups: t.commodityGroups,
        mainTnved: t.mainTnved,
        certificateTypes: t.certificateTypes,
        siteSurveyed: t.siteSurveyed,
        tier: t.tier,
        verifiedAt: t.verifiedAt,
        updateStatus: t.updateStatus,
        pendingChanges: t.pendingChanges,
        worksWithCount: t.worksWithCount,
        total: sql<number>`count(*) over()`.mapWith(Number),
      })
      .from(t)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...catalogOrder(f.sort))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize);

    return {
      items: rows.map(({ total: _total, verifiedAt, ...row }) => ({
        ...row,
        verifiedAt: verifiedAt?.toISOString() ?? null,
      })),
      total: rows[0]?.total ?? 0,
      page: f.page,
      pageSize: f.pageSize,
    };
  }

  /**
   * Страница компании (OPR-09, OPR-10, OPR-11). При любом scope строка ищется только в проекции:
   * профиль вне неё (не Verified, due diligence red) — тот же 404, что и несуществующий id.
   * Внутренней проекции для scope `all` пока нет (см. search). Ключ focalPoint есть в ответе только
   * у роли с focal_point.read: наблюдатель его не получает (GEN-13).
   */
  async company(profileId: string, role: Role, actor?: AuthUser): Promise<CompanyPage> {
    try {
      return await this.db.transaction(
        (raw) => this.companyFromSnapshot(raw as unknown as Database, profileId, role, actor),
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    } catch (error) {
      if (actor && error instanceof ProblemException && error.getStatus() === 403) {
        await this.audit.record({
          userId: actor.id,
          organizationId: actor.organizationId,
          action: 'catalog.search',
          objectType: 'route',
          objectId: '/v1/catalog/companies/:profileId',
          outcome: 'denied',
        });
      }
      throw error;
    }
  }

  private async companyFromSnapshot(
    tx: Database,
    profileId: string,
    role: Role,
    actor?: AuthUser,
  ): Promise<CompanyPage> {
    const policy = await policyForTransaction(tx);
    const scope = policy.can(role, 'catalog.search', 'a_register');
    if (scope !== 'visible' && scope !== 'all')
      throw new ProblemException(403, 'forbidden', 'Нет прав на это действие');
    if (actor) {
      const current = (
        await tx.execute<{ role: string; organizationId: string; type: string }>(sql`
        select a.role,a.organization_id as "organizationId",o.type from user_accounts a
        join organizations o on o.id=a.organization_id where a.id=${actor.id} and a.state='active'`)
      ).rows[0];
      if (
        !current ||
        current.role !== role ||
        actor.role !== role ||
        current.organizationId !== actor.organizationId ||
        current.type !== (role === 'operator' || role === 'observer' ? role : 'imbc')
      )
        throw new ProblemException(403, 'forbidden', 'Нет прав на это действие');
    }
    const [row] = await tx
      .select({
        profileId: t.profileId,
        organizationId: t.organizationId,
        bin: t.bin,
        nameEn: t.nameEn,
        nameRu: t.nameRu,
        region: t.region,
        commodityGroups: t.commodityGroups,
        tnvedCodes: t.tnvedCodes,
        mainTnved: t.mainTnved,
        headcountTotal: t.headcountTotal,
        certificateTypes: t.certificateTypes,
        certificatesValidUntil: t.certificatesValidUntil,
        siteSurveyed: t.siteSurveyed,
        tier: t.tier,
        unifiedRegister: t.unifiedRegister,
        worksWithCount: t.worksWithCount,
        updateStatus: t.updateStatus,
        pendingChanges: t.pendingChanges,
        verifiedAt: t.verifiedAt,
        card: t.card,
      })
      .from(t)
      .where(eq(t.profileId, profileId))
      .limit(1);
    if (!row) throw new ProblemException(404, 'not_found', 'Компания не найдена');

    const { organizationId, certificateTypes, certificatesValidUntil, verifiedAt, card, ...fields } = row;
    const currentSurvey = await loadCurrentCompanySurvey(tx, { profileId, organizationId });
    if (!currentSurvey.visible) throw new ProblemException(404, 'not_found', 'Компания не найдена');
    const siteSurvey = currentSurvey.current;
    const parsed = companyCardDataSchema.safeParse(card);
    const contacts = parsed.success ? parsed.data : NO_CONTACTS;
    const page: CompanyPage = {
      ...fields,
      siteSurveyed: siteSurvey !== null,
      tier: siteSurvey ? 'tier_2' : 'tier_1',
      siteSurvey,
      certificates: certificateTypes.map((type) => ({ type, validUntil: validUntil(certificatesValidUntil, type) })),
      verifiedAt: verifiedAt.toISOString(),
      companyPhone: contacts.companyPhone,
      companyEmail: contacts.companyEmail,
      ...(contacts.diligence ? { diligence: contacts.diligence } : {}),
    };
    if (policy.can(role, 'focal_point.read')) page.focalPoint = contacts.focalPoint;
    return page;
  }

  /**
   * Дашборд оператора, наблюдателя и директора (OPR-31…35). Все счётчики — из проекции:
   * unresponsive остаётся на карте и в счётчиках по статусу (OPR-33), счётчики по тиру — OPR-32.
   * Кеш Valkey на 60 секунд; запись не той формы или не JSON не отдаётся и перезаписывается.
   */
  async dashboard(): Promise<Dashboard> {
    const cached = cachedDashboard(await this.valkey.get(DASHBOARD_CACHE_KEY).catch(() => null));
    if (cached) return cached;

    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        siteSurveyed: sql<number>`count(*) filter (where ${t.siteSurveyed})`.mapWith(Number),
        unifiedRegister: sql<number>`count(*) filter (where ${t.unifiedRegister})`.mapWith(Number),
        active: sql<number>`count(*) filter (where ${t.updateStatus} = 'active')`.mapWith(Number),
        outdated: sql<number>`count(*) filter (where ${t.updateStatus} = 'outdated')`.mapWith(Number),
        unresponsive: sql<number>`count(*) filter (where ${t.updateStatus} = 'unresponsive')`.mapWith(Number),
        tier1: sql<number>`count(*) filter (where ${t.tier} = 'tier_1')`.mapWith(Number),
        tier2: sql<number>`count(*) filter (where ${t.tier} = 'tier_2')`.mapWith(Number),
      })
      .from(t);
    const byRegion = await this.db
      .select({ region: t.region, count: sql<number>`count(*)`.mapWith(Number) })
      .from(t)
      .groupBy(t.region);
    const byGroup = await this.db.execute<Dashboard['byCommodityGroup'][number]>(
      sql`select g as "group", count(*)::int as count from ${t}, unnest(${t.commodityGroups}) g group by g order by g`,
    );

    const result: Dashboard = {
      total: totals?.total ?? 0,
      byRegion,
      byCommodityGroup: byGroup.rows,
      siteSurveyed: totals?.siteSurveyed ?? 0,
      unifiedRegister: totals?.unifiedRegister ?? 0,
      updateStatus: {
        active: totals?.active ?? 0,
        outdated: totals?.outdated ?? 0,
        unresponsive: totals?.unresponsive ?? 0,
      },
      tier: { tier_1: totals?.tier1 ?? 0, tier_2: totals?.tier2 ?? 0 },
      generatedAt: new Date().toISOString(),
    };
    await this.valkey
      .set(DASHBOARD_CACHE_KEY, JSON.stringify(result), 'EX', DASHBOARD_TTL_S)
      .catch((error: unknown) => this.logger.debug(`cache skip: ${String(error)}`));
    return result;
  }
}

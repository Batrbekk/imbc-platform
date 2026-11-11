import {
  type CatalogFilter,
  type CatalogPage,
  type Dashboard,
  normalizeCompanyName,
  type Scope,
} from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, arrayOverlaps, asc, desc, eq, gte, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DB, type Database } from '../../database/database.module.js';
import { catalogVisible } from '../../database/schema/index.js';
import { VALKEY } from '../../infra/infra.module.js';

const t = catalogVisible;
const DASHBOARD_TTL_S = 60;
/** v2: счётчики по статусу актуальности v1.3 (UPD-06). Кеш прежней формы (dashboard:v1) не читается. */
const DASHBOARD_CACHE_KEY = 'dashboard:v2';

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
   * Дашборд оператора, наблюдателя и директора (OPR-31…35). Все счётчики — из проекции:
   * unresponsive остаётся на карте и в счётчиках по статусу (OPR-33). Кеш Valkey на 60 секунд.
   */
  async dashboard(): Promise<Dashboard> {
    const cached = await this.valkey.get(DASHBOARD_CACHE_KEY).catch(() => null);
    if (cached) return JSON.parse(cached) as Dashboard;

    const [totals] = await this.db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        siteSurveyed: sql<number>`count(*) filter (where ${t.siteSurveyed})`.mapWith(Number),
        unifiedRegister: sql<number>`count(*) filter (where ${t.unifiedRegister})`.mapWith(Number),
        active: sql<number>`count(*) filter (where ${t.updateStatus} = 'active')`.mapWith(Number),
        outdated: sql<number>`count(*) filter (where ${t.updateStatus} = 'outdated')`.mapWith(Number),
        unresponsive: sql<number>`count(*) filter (where ${t.updateStatus} = 'unresponsive')`.mapWith(Number),
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
      generatedAt: new Date().toISOString(),
    };
    await this.valkey
      .set(DASHBOARD_CACHE_KEY, JSON.stringify(result), 'EX', DASHBOARD_TTL_S)
      .catch((error: unknown) => this.logger.debug(`cache skip: ${String(error)}`));
    return result;
  }
}

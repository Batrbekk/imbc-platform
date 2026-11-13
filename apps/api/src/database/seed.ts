/**
 * Демо-данные для dev-стенда (SEED_DEMO=true в compose). Идемпотентно: повторный запуск ничего не дублирует.
 * Учётные записи совпадают с пользователями realm-файла Keycloak (infrastructure/keycloak/imbc-realm.json).
 * Все компании вымышленные; БИН сгенерированы с правильной контрольной цифрой.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type CompanyCardData,
  computeBinCheckDigit,
  normalizeCompanyName,
  type CommodityGroup,
  type ProfileStatus,
  type Role,
  type UpdateStatus,
} from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadReferenceDirectory, REFERENCE_DATA_DIR, type ReferenceLoadResult } from './reference-data.js';
import * as schema from './schema/index.js';

const { organizations, userAccounts, manufacturerProfiles, catalogVisible, ndaVersion } = schema;

/**
 * Версия 1 NDA на стенде — явная заглушка на трёх языках (FC-02, Р-5): текст NDA предоставит IMBC,
 * и он придёт миграцией следующей версией. Миграция заглушку не кладёт — иначе она попала бы в продакшен.
 */
export const NDA_PLACEHOLDER_BODY = [
  'УАҚЫТША МӘТІН — ЗАҢДЫҚ ҚҰЖАТ ЕМЕС. Платформаның құпияны жария етпеу туралы келісімінің (NDA) мәтінін IMBC ұсынады. Бұл мәтін тек сынақ стендіне арналған, оған сүйенуге болмайды.',
  'ВРЕМЕННЫЙ ТЕКСТ — НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ. Текст соглашения о неразглашении (NDA) платформы предоставит IMBC. Этот текст существует только для тестового стенда, полагаться на него нельзя.',
  'PLACEHOLDER — NOT A LEGAL TEXT. IMBC will provide the text of the platform non-disclosure agreement (NDA). This text exists only for the test environment and must not be relied on.',
].join('\n\n');
const NDA_PUBLISHER_EMAIL = 'admin@imbc.local';

function demoBin(seed: number): string {
  for (let i = 0; i < 100; i++) {
    const head = `2401${String(seed * 100 + i).padStart(7, '0')}`;
    const digit = computeBinCheckDigit(head);
    if (digit !== null) return `${head}${digit}`;
  }
  throw new Error('не удалось подобрать БИН');
}

const PEOPLE: { email: string; role: Role; org: 'imbc' | 'operator' | 'observer' | 'manufacturer'; name: string }[] = [
  { email: 'expert@imbc.local', role: 'expert', org: 'imbc', name: 'Эксперт IMBC' },
  { email: 'admin@imbc.local', role: 'administrator', org: 'imbc', name: 'Администратор IMBC' },
  { email: 'director@imbc.local', role: 'director', org: 'imbc', name: 'Директор IMBC' },
  { email: 'operator@operator.local', role: 'operator', org: 'operator', name: 'Специалист оператора' },
  { email: 'observer@observer.local', role: 'observer', org: 'observer', name: 'Наблюдатель' },
  { email: 'manufacturer@demo.local', role: 'manufacturer', org: 'manufacturer', name: 'Производитель (демо)' },
];

const COMPANIES: {
  ru: string;
  en: string;
  region: string;
  groups: CommodityGroup[];
  tnved: string[];
  certs: string[];
  surveyed: boolean;
  headcount: number;
  /** Статус актуальности: unresponsive тоже в каталоге и на дашборде, ниже остальных (UPD-04, OPR-33). */
  updateStatus: UpdateStatus;
  /** ФИО вымышленного контактного лица (focal point); null — пустое состояние страницы компании. */
  focalPoint: string | null;
}[] = [
  {
    ru: 'ТОО «Демо Металл Конструкция»',
    en: 'Demo Metal Structures LLP',
    region: 'KZ-ATY',
    groups: ['A'],
    tnved: ['7308909809'],
    certs: ['ISO 9001'],
    surveyed: true,
    headcount: 240,
    updateStatus: 'active',
    focalPoint: 'Айгерим Сапарова',
  },
  {
    ru: 'ТОО «Каспий Демо Сервис»',
    en: 'Caspian Demo Service LLP',
    region: 'KZ-MAN',
    groups: ['B', 'C'],
    tnved: ['8481809907'],
    certs: ['ISO 9001', 'API 6D'],
    surveyed: true,
    headcount: 410,
    updateStatus: 'active',
    focalPoint: 'Ерлан Жумабеков',
  },
  {
    ru: 'АО «Пример Кабель»',
    en: 'Example Cable JSC',
    region: 'KZ-PAV',
    groups: ['C'],
    tnved: ['8544499108'],
    certs: ['ISO 14001'],
    surveyed: false,
    headcount: 120,
    updateStatus: 'active',
    focalPoint: 'Динара Абенова',
  },
  {
    ru: 'ТОО «Тест Химия»',
    en: 'Test Chemicals LLP',
    region: 'KZ-ATY',
    groups: ['D'],
    tnved: ['3824999609'],
    certs: [],
    surveyed: false,
    headcount: 65,
    updateStatus: 'unresponsive',
    focalPoint: null,
  },
  {
    ru: 'ТОО «Образец Спецодежда»',
    en: 'Sample Workwear LLP',
    region: 'KZ-ALA',
    groups: ['E'],
    tnved: ['6211339000'],
    certs: ['ISO 45001'],
    surveyed: true,
    headcount: 90,
    updateStatus: 'active',
    focalPoint: 'Нурлан Сейткали',
  },
  {
    ru: 'ТОО «Демо Насос Завод»',
    en: 'Demo Pump Plant LLP',
    region: 'KZ-KAR',
    groups: ['B'],
    tnved: ['8413702100'],
    certs: ['ISO 9001', 'API 610'],
    surveyed: true,
    headcount: 310,
    updateStatus: 'active',
    focalPoint: 'Асель Тулегенова',
  },
  {
    ru: 'ТОО «Степь Пластик»',
    en: 'Steppe Plastics LLP',
    region: 'KZ-AST',
    groups: ['C', 'D'],
    tnved: ['3917400009'],
    certs: [],
    surveyed: false,
    headcount: 45,
    updateStatus: 'outdated',
    focalPoint: 'Бауыржан Оспанов',
  },
  {
    ru: 'ТОО «Атырау Демо Арматура»',
    en: 'Atyrau Demo Valves LLP',
    region: 'KZ-ATY',
    groups: ['B'],
    tnved: ['8481805190'],
    certs: ['ISO 9001'],
    surveyed: true,
    headcount: 180,
    updateStatus: 'active',
    focalPoint: 'Гульнара Ахметова',
  },
];

/**
 * Профили очереди SME (REV-01, REV-04): организации без строк в catalog_visible и без аккаунтов.
 * `assigned` — профиль назначен демо-эксперту; `daysAgo` — дата регистрации, задаёт порядок очереди.
 * Draft в очередь не входит.
 */
const QUEUE_COMPANIES: { name: string; status: ProfileStatus; assigned: boolean; daysAgo: number }[] = [
  { name: 'ТОО «Жаңа Демо Құрылыс»', status: 'submitted', assigned: false, daysAgo: 6 },
  { name: 'ТОО «Демо Агро Өнім»', status: 'submitted', assigned: false, daysAgo: 4 },
  { name: 'ТОО «Демо Электро Монтаж»', status: 'under_review', assigned: true, daysAgo: 3 },
  { name: 'ТОО «Демо Жоба»', status: 'draft', assigned: false, daysAgo: 1 },
];
const SME_EMAIL = 'expert@imbc.local';

/**
 * Записывает демо-данные в одной транзакции и загружает временные справочники (`reference-data/provisional`:
 * значения прототипа, пока IMBC не прислал перечни — ADM-08). Пул не закрывает.
 */
export async function seedDemo(pool: pg.Pool): Promise<ReferenceLoadResult[]> {
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  await db.transaction(async (tx) => {
    const orgIds: Record<string, string> = {};
    for (const [key, name, type] of [
      ['imbc', 'IMBC', 'imbc'],
      ['operator', 'Оператор (демо)', 'operator'],
      ['observer', 'Наблюдатель (демо)', 'observer'],
    ] as const) {
      // Ключи уникальных индексов: IMBC одна (organizations_imbc_uq) — по типу, даже если её переименовали;
      // оператор и наблюдатель — по типу и имени без учёта регистра (organizations_name_uq).
      const existing = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          type === 'imbc'
            ? sql`${organizations.type} = 'imbc'`
            : sql`${organizations.type} = ${type} and lower(${organizations.name}) = lower(${name})`,
        );
      orgIds[key] =
        existing[0]?.id ??
        (
          await tx
            .insert(organizations)
            .values({ type, name, isMajorOperator: key === 'operator' })
            .returning()
        )[0]!.id;
    }

    for (const [i, c] of COMPANIES.entries()) {
      const bin = demoBin(i + 1);
      const [org] = await tx
        .insert(organizations)
        .values({ type: 'manufacturer', name: c.ru, bin })
        .onConflictDoUpdate({ target: organizations.bin, targetWhere: sql`bin is not null`, set: { name: c.ru } })
        .returning();
      if (i === 0) orgIds.manufacturer = org!.id;
      const verifiedAt = new Date(Date.now() - (i + 1) * 9 * 86_400_000);
      const [profile] = await tx
        .insert(manufacturerProfiles)
        .values({
          organizationId: org!.id,
          status: 'verified',
          updateStatus: c.updateStatus,
          // Регистрация — за 30 дней до верификации.
          registeredAt: new Date(verifiedAt.getTime() - 30 * 86_400_000),
          verifiedAt,
          completenessPct: 100,
        })
        .onConflictDoUpdate({
          target: manufacturerProfiles.organizationId,
          // verified_at строки на стенде не меняется: дата регистрации считается от сохранённой.
          set: {
            status: 'verified',
            updateStatus: c.updateStatus,
            registeredAt: sql`coalesce(${manufacturerProfiles.verifiedAt} - interval '30 days', ${manufacturerProfiles.registeredAt})`,
          },
        })
        .returning();
      const until = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
      const row = {
        profileId: profile!.id,
        organizationId: org!.id,
        bin,
        nameEn: c.en,
        nameRu: c.ru,
        nameNormalized: normalizeCompanyName(c.ru),
        region: c.region,
        commodityGroups: c.groups,
        commodityTypes: [],
        tnvedCodes: c.tnved,
        kpvedCodes: [],
        okedCodes: [],
        certificateTypes: c.certs,
        certificatesValidUntil: Object.fromEntries(c.certs.map((k) => [k, until])),
        mainTnved: c.tnved[0] ?? null,
        headcountTotal: c.headcount,
        siteSurveyed: c.surveyed,
        unifiedRegister: i % 3 === 0,
        updateStatus: c.updateStatus,
        verifiedAt,
        // Префилл и контактное лицо страницы компании (OPR-09); форма — companyCardDataSchema.
        card: {
          companyPhone: `+7 700 000 00 0${i + 1}`,
          companyEmail: `info@company${i + 1}.demo.local`,
          focalPoint:
            c.focalPoint === null
              ? null
              : {
                  fullName: c.focalPoint,
                  position: 'Коммерческий директор',
                  email: `focal@company${i + 1}.demo.local`,
                  phone: `+7 701 000 00 0${i + 1}`,
                },
        } satisfies CompanyCardData,
      };
      // set: row — и card: на стенде строки уже есть с card прежней формы ({ demo: true }).
      await tx.insert(catalogVisible).values(row).onConflictDoUpdate({ target: catalogVisible.profileId, set: row });
    }

    for (const p of PEOPLE) {
      await tx
        .insert(userAccounts)
        .values({
          organizationId: orgIds[p.org]!,
          email: p.email,
          role: p.role,
          fullName: p.name,
          state: 'invited',
          locale: 'ru',
        })
        .onConflictDoNothing();
    }

    // NDA: заглушка — только в пустую таблицу; версию, которая уже есть (текст IMBC), seed не трогает.
    const [anyVersion] = await tx.select({ id: ndaVersion.id }).from(ndaVersion).limit(1);
    if (!anyVersion) {
      const [publisher] = await tx
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(sql`lower(${userAccounts.email}) = ${NDA_PUBLISHER_EMAIL}`);
      await tx
        .insert(ndaVersion)
        .values({ versionNumber: 1, body: NDA_PLACEHOLDER_BODY, isCurrent: true, publishedBy: publisher!.id });
    }

    // Очередь SME. Статус, назначение и дата регистрации задаются при каждом запуске: строки
    // прежнего запуска возвращаются к демо-состоянию.
    const [sme] = await tx
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(sql`lower(${userAccounts.email}) = ${SME_EMAIL}`);
    for (const [i, q] of QUEUE_COMPANIES.entries()) {
      const [org] = await tx
        .insert(organizations)
        .values({ type: 'manufacturer', name: q.name, bin: demoBin(COMPANIES.length + i + 1) })
        .onConflictDoUpdate({ target: organizations.bin, targetWhere: sql`bin is not null`, set: { name: q.name } })
        .returning();
      const state = {
        status: q.status,
        hasPendingChanges: false,
        assignedExpertId: q.assigned ? (sme?.id ?? null) : null,
        registeredAt: new Date(Date.now() - q.daysAgo * 86_400_000),
      };
      await tx
        .insert(manufacturerProfiles)
        .values({ organizationId: org!.id, ...state })
        .onConflictDoUpdate({ target: manufacturerProfiles.organizationId, set: state });
    }
  });

  // Временные значения справочников — только на стенде: в продакшен их не кладёт ни миграция, ни seed.
  return loadReferenceDirectory(db, join(REFERENCE_DATA_DIR, 'provisional'), 'provisional');
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  const pool = new pg.Pool({ connectionString: url, max: 1, application_name: 'imbc-seed' });
  try {
    const references = await seedDemo(pool);
    console.log(
      `Демо-данные: ${PEOPLE.length} учётных записей, ${COMPANIES.length} компаний в каталоге, профилей вне каталога: ${QUEUE_COMPANIES.length}`,
    );
    for (const r of references)
      console.log(`Справочники (временные): ${r.dictionary} +${r.inserted} (+${r.translationsAdded} переводов)`);
  } finally {
    await pool.end();
  }
}

// Запуск только при прямом вызове (`node dist/database/seed.js`), не при импорте из тестов.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}

/**
 * Демо-данные для dev-стенда (SEED_DEMO=true в compose). Идемпотентно: повторный запуск ничего не дублирует.
 * Учётные записи совпадают с пользователями realm-файла Keycloak (infrastructure/keycloak/imbc-realm.json).
 * Все компании вымышленные; БИН сгенерированы с правильной контрольной цифрой.
 */
import { pathToFileURL } from 'node:url';
import {
  computeBinCheckDigit,
  normalizeCompanyName,
  type CommodityGroup,
  type Role,
  type UpdateStatus,
} from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

const { organizations, userAccounts, manufacturerProfiles, catalogVisible } = schema;

function demoBin(seed: number): string {
  for (let i = 0; i < 100; i++) {
    const head = `2401${String(seed * 100 + i).padStart(7, '0')}`;
    const digit = computeBinCheckDigit(head);
    if (digit !== null) return `${head}${digit}`;
  }
  throw new Error('не удалось подобрать БИН');
}

/** Адрес демо-наблюдателя до v1.3 и после (GEN-06), в нижнем регистре. */
const OBSERVER_EMAIL = { legacy: 'spectator@spectator.local', current: 'observer@observer.local' } as const;

const PEOPLE: { email: string; role: Role; org: 'imbc' | 'operator' | 'observer' | 'manufacturer'; name: string }[] = [
  { email: 'expert@imbc.local', role: 'expert', org: 'imbc', name: 'Эксперт IMBC' },
  { email: 'admin@imbc.local', role: 'administrator', org: 'imbc', name: 'Администратор IMBC' },
  { email: 'director@imbc.local', role: 'director', org: 'imbc', name: 'Директор IMBC' },
  { email: 'operator@operator.local', role: 'operator', org: 'operator', name: 'Специалист оператора' },
  { email: OBSERVER_EMAIL.current, role: 'observer', org: 'observer', name: 'Наблюдатель' },
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
  },
];

/** Записывает демо-данные в одной транзакции. Пул не закрывает. */
export async function seedDemo(pool: pg.Pool): Promise<void> {
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  await db.transaction(async (tx) => {
    const orgIds: Record<string, string> = {};
    for (const [key, name, type] of [
      ['imbc', 'IMBC', 'imbc'],
      ['operator', 'Оператор (демо)', 'operator'],
      ['observer', 'Наблюдатель (демо)', 'observer'],
    ] as const) {
      const existing = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(sql`${organizations.name} = ${name}`);
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
          verifiedAt,
          completenessPct: 100,
        })
        .onConflictDoUpdate({
          target: manufacturerProfiles.organizationId,
          set: { status: 'verified', updateStatus: c.updateStatus },
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
        card: { demo: true },
      };
      await tx.insert(catalogVisible).values(row).onConflictDoUpdate({ target: catalogVisible.profileId, set: row });
    }

    // Прежний адрес демо-наблюдателя (до v1.3, GEN-06) меняется на месте: id аккаунта не меняется,
    // поэтому пара в DEV_FIXED_OTP_ACCOUNTS, idp_subject, принятая ответственность и доверенные
    // устройства сохраняются. Если новый адрес уже занят, оба аккаунта остаются как были.
    await tx.execute(sql`
      UPDATE user_accounts SET email = ${OBSERVER_EMAIL.current}
      WHERE lower(email) = ${OBSERVER_EMAIL.legacy}
        AND NOT EXISTS (SELECT 1 FROM user_accounts WHERE lower(email) = ${OBSERVER_EMAIL.current})`);

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
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  const pool = new pg.Pool({ connectionString: url, max: 1, application_name: 'imbc-seed' });
  try {
    await seedDemo(pool);
    console.log(`Демо-данные: ${PEOPLE.length} учётных записей, ${COMPANIES.length} компаний в каталоге`);
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

import type {
  CapacityUnit,
  CommodityGroup,
  ContactRole,
  DocumentStatus,
  ProfileSection,
  ProfileStatus,
  UpdateStatus,
} from "@imbc/contracts";

import { ACCOUNT } from "./accounts";
import { file, type FileRef } from "./common";
import { MANUFACTURERS } from "./organizations";

/** Основная информация (MAN-09…MAN-12). */
export interface MainSection {
  legalName: string;
  legalForm: "LLP" | "JSC" | "LLC";
  website: string | null;
  director: string;
  registeredOn: string;
  okedCodes: string[];
  region: string;
  city: string;
  legalAddress: string;
  productionAddress: string;
  companyPhone: string;
  contactEmail: string;
  unifiedRegister: { registered: boolean; firstIncludedOn: string | null; extract: FileRef | null };
}

/** Контакт (MAN-13, MAN-14): ровно один — focal point. */
export interface Contact {
  id: string;
  fullName: string;
  position: string;
  email: string;
  phone: string;
  role: ContactRole;
  focalPoint: boolean;
}

/** Персонал (MAN-17…MAN-20). */
export interface PersonnelSection {
  managers: number | null;
  office: number | null;
  production: number | null;
  foreignManagers: number | null;
  orgChart: FileRef | null;
  cvs: FileRef[];
}

/** Акционер (MAN-21). */
export interface Shareholder {
  id: string;
  name: string;
  sharePct: number;
  country: string;
}

/** Мощность: добавленная строка — число и единица в год (MAN-23); строка e-Ondiris — текст (MAN-25). */
export type ProductCapacity = { kind: "added"; value: number; unit: CapacityUnit } | { kind: "registry"; text: string };

/** Продуктовая линия (MAN-23…MAN-25). У строки e-Ondiris есть `registry`, её нельзя править. */
export interface ProductLine {
  id: string;
  source: "e_ondiris" | "manual";
  nameEn: string;
  nameRu: string;
  group: CommodityGroup;
  commodityType: string;
  tnved: string;
  kpved: string | null;
  capacity: ProductCapacity;
  icvPct: number | null;
  localization: { done: number; total: number } | null;
  certificate: FileRef | null;
  note: string | null;
  registry: { entryNumber: string; inclusionDate: string; active: boolean; enstru: string } | null;
}

/** Оборудование (MAN-29). */
export interface Equipment {
  id: string;
  name: string;
  type: string;
  quantity: number;
  productIds: string[];
}

/** Производство — необязательная секция (MAN-26…MAN-32). */
export interface ProductionSection {
  areaM2: number | null;
  processes: string[];
  equipment: Equipment[];
  workshops: number | null;
  utilisationPct: number | null;
  photos: FileRef[];
}

/** Сертификат (MAN-33…MAN-36); статусы — раздел 6.3. */
export interface Certificate {
  id: string;
  type: string;
  mandatory: boolean;
  number: string;
  issuer: string;
  issuedOn: string;
  expiresOn: string | null;
  file: FileRef | null;
  status: DocumentStatus;
  comment: string | null;
}

/** Документ (MAN-37…MAN-39). `noLicenceRequired` — заявление «лицензия не нужна» (MAN-38). */
export interface ProfileDocument {
  id: string;
  type: "registration_certificate" | "charter" | "licence";
  file: FileRef | null;
  noLicenceRequired: boolean;
  status: DocumentStatus;
  comment: string | null;
}

export interface ProfileSections {
  main: MainSection;
  contacts: Contact[];
  personnel: PersonnelSection;
  shareholders: Shareholder[];
  products: ProductLine[];
  production: ProductionSection;
  certificates: Certificate[];
  documents: ProfileDocument[];
}

/** Решение SME по секции (REV-06) и отметка «изменена после верификации» (MAN-45). */
export interface SectionReview {
  decision: "verified" | "rejected" | null;
  comment: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  changed: boolean;
}

/**
 * Профиль производителя (раздел 9.1). `sections` — значения, которые видят операторы у Verified
 * (последние верифицированные); `pending` — ожидающие проверки правки (REV-08, OPR-11).
 */
export interface ProtoProfile {
  id: string;
  organizationId: string;
  bin: string;
  nameRu: string;
  nameEn: string;
  status: ProfileStatus;
  pendingChanges: boolean;
  /** Только у Verified (раздел 5.5). */
  updateStatus: UpdateStatus | null;
  assignedExpertId: string | null;
  registeredAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  lastConfirmedAt: string | null;
  origin: "registered" | "migrated";
  /** Ответ на «Откуда вы узнали о нас?» — только для IMBC (MAN-01). */
  heardAbout: string;
  /** Принятие NDA (FC-02): версия из `nda.ts`, время, IP. */
  nda: { versionId: string; at: string; ip: string } | null;
  sections: ProfileSections;
  pending: Partial<ProfileSections>;
  review: Record<ProfileSection, SectionReview>;
}

/** Профиль демо-производителя seed (`manufacturer@demo.local`). */
export const DEMO_PROFILE_ID = "p01";

const ALL_SECTIONS: ProfileSection[] = [
  "main",
  "contacts",
  "personnel",
  "shareholders",
  "products",
  "production",
  "certificates",
  "documents",
];

/** Входные данные компании; остальное достраивает `build`. */
interface Spec {
  status: ProfileStatus;
  pendingChanges?: boolean;
  updateStatus: UpdateStatus | null;
  assignedExpertId?: string | null;
  legalForm: MainSection["legalForm"];
  region: string;
  city: string;
  groups: CommodityGroup[];
  tnved: string;
  product: [en: string, ru: string, type: string];
  certs: string[];
  headcount: number;
  focal: string;
  director: string;
  registry: boolean;
  origin?: ProtoProfile["origin"];
  heardAbout: string;
  ndaVersion: "nda-1" | "nda-2" | null;
  registeredAt: string;
  verifiedAt: string | null;
}

const SPECS: Spec[] = [
  {
    status: "verified",
    updateStatus: "active",
    legalForm: "LLP",
    region: "KZ-ATY",
    city: "Атырау",
    groups: ["A"],
    tnved: "7308909809",
    product: ["Modular steel structures", "Металлоконструкции модульные", "Steel structures"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 240,
    focal: "Айгерим Сапарова",
    director: "Ерболат Кенжебаев",
    registry: true,
    heardAbout: "Мероприятие IMBC",
    ndaVersion: "nda-2",
    registeredAt: "2026-09-03T10:00:00+05:00",
    verifiedAt: "2026-09-20T15:00:00+05:00",
  },
  {
    status: "verified",
    pendingChanges: true,
    updateStatus: "active",
    assignedExpertId: ACCOUNT.expert,
    legalForm: "LLP",
    region: "KZ-MAN",
    city: "Актау",
    groups: ["B", "C"],
    tnved: "8481809907",
    product: ["Pipeline valves", "Трубопроводная арматура", "Valves"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001", "API"],
    headcount: 410,
    focal: "Ерлан Жумабеков",
    director: "Талгат Нургалиев",
    registry: false,
    heardAbout: "Оператор",
    ndaVersion: "nda-1",
    registeredAt: "2026-09-04T10:00:00+05:00",
    verifiedAt: "2026-09-25T12:00:00+05:00",
  },
  {
    status: "verified",
    updateStatus: "active",
    legalForm: "JSC",
    region: "KZ-PAV",
    city: "Павлодар",
    groups: ["C"],
    tnved: "8544499108",
    product: ["Power cable 1 kV", "Кабель силовой 1 кВ", "Cables"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 120,
    focal: "Динара Абенова",
    director: "Сергей Ковалёв",
    registry: false,
    origin: "migrated",
    heardAbout: "База IMBC (перенос)",
    ndaVersion: "nda-2",
    registeredAt: "2026-09-05T10:00:00+05:00",
    verifiedAt: "2026-10-02T11:00:00+05:00",
  },
  {
    status: "verified",
    updateStatus: "unresponsive",
    legalForm: "LLP",
    region: "KZ-ATY",
    city: "Атырау",
    groups: ["D"],
    tnved: "3824999609",
    product: ["Drilling fluid additives", "Добавки для буровых растворов", "Chemicals"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 65,
    focal: "Самал Ибраева",
    director: "Аскар Утепов",
    registry: true,
    origin: "migrated",
    heardAbout: "База IMBC (перенос)",
    ndaVersion: "nda-1",
    registeredAt: "2026-09-06T10:00:00+05:00",
    verifiedAt: "2026-09-10T10:00:00+05:00",
  },
  {
    status: "verified",
    updateStatus: "active",
    legalForm: "LLP",
    region: "KZ-ALA",
    city: "Алматы",
    groups: ["E"],
    tnved: "6211339000",
    product: ["Flame-retardant workwear", "Спецодежда огнестойкая", "Workwear"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 90,
    focal: "Нурлан Сейткали",
    director: "Гаухар Жаксылыкова",
    registry: false,
    heardAbout: "Коллеги",
    ndaVersion: "nda-2",
    registeredAt: "2026-09-07T10:00:00+05:00",
    verifiedAt: "2026-10-05T10:00:00+05:00",
  },
  {
    status: "verified",
    updateStatus: "active",
    legalForm: "LLP",
    region: "KZ-KAR",
    city: "Караганда",
    groups: ["B"],
    tnved: "8413702100",
    product: ["Centrifugal pumps", "Насосы центробежные", "Pumps"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001", "API"],
    headcount: 310,
    focal: "Асель Тулегенова",
    director: "Виктор Ли",
    registry: false,
    heardAbout: "Мероприятие IMBC",
    ndaVersion: "nda-2",
    registeredAt: "2026-09-08T10:00:00+05:00",
    verifiedAt: "2026-10-08T10:00:00+05:00",
  },
  {
    status: "verified",
    updateStatus: "outdated",
    legalForm: "LLP",
    region: "KZ-AST",
    city: "Астана",
    groups: ["C", "D"],
    tnved: "3917400009",
    product: ["Plastic pipe fittings", "Фитинги для пластиковых труб", "Pipes and fittings"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 45,
    focal: "Бауыржан Оспанов",
    director: "Мурат Сагинтаев",
    registry: true,
    origin: "migrated",
    heardAbout: "База IMBC (перенос)",
    ndaVersion: null,
    registeredAt: "2026-09-09T10:00:00+05:00",
    verifiedAt: "2026-09-10T10:00:00+05:00",
  },
  {
    status: "verified",
    updateStatus: "active",
    legalForm: "LLP",
    region: "KZ-ATY",
    city: "Атырау",
    groups: ["B"],
    tnved: "8481805190",
    product: ["Ball valves DN50", "Краны шаровые DN50", "Valves"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 180,
    focal: "Гульнара Ахметова",
    director: "Ринат Шакиров",
    registry: false,
    heardAbout: "Оператор",
    ndaVersion: "nda-2",
    registeredAt: "2026-09-10T10:00:00+05:00",
    verifiedAt: "2026-10-12T10:00:00+05:00",
  },
  {
    status: "submitted",
    updateStatus: null,
    legalForm: "LLP",
    region: "KZ-AKT",
    city: "Актобе",
    groups: ["A"],
    tnved: "7308905900",
    product: ["Steel platforms", "Площадки стальные", "Steel structures"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 70,
    focal: "Ержан Давлетов",
    director: "Алия Курманова",
    registry: false,
    heardAbout: "Сайт IMBC",
    ndaVersion: "nda-2",
    registeredAt: "2026-11-06T10:00:00+05:00",
    verifiedAt: null,
  },
  {
    status: "returned",
    updateStatus: null,
    assignedExpertId: ACCOUNT.expert2,
    legalForm: "LLP",
    region: "KZ-KUS",
    city: "Костанай",
    groups: ["E"],
    tnved: "1101001500",
    product: ["Wheat flour for catering", "Мука пшеничная для питания", "Food"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 55,
    focal: "Камила Есенова",
    director: "Болат Ахметжанов",
    registry: false,
    heardAbout: "Коллеги",
    ndaVersion: "nda-2",
    registeredAt: "2026-11-08T10:00:00+05:00",
    verifiedAt: null,
  },
  {
    status: "under_review",
    updateStatus: null,
    assignedExpertId: ACCOUNT.expert,
    legalForm: "LLP",
    region: "KZ-ATY",
    city: "Атырау",
    groups: ["C"],
    tnved: "8537109100",
    product: ["Low-voltage switchboards", "Щиты распределительные низковольтные", "Electrical equipment"],
    certs: ["ISO 9001", "ISO 14001", "ISO 45001"],
    headcount: 95,
    focal: "Тимур Абдрахманов",
    director: "Олжас Байжанов",
    registry: false,
    heardAbout: "Оператор",
    ndaVersion: "nda-2",
    registeredAt: "2026-11-09T10:00:00+05:00",
    verifiedAt: null,
  },
  {
    status: "draft",
    updateStatus: null,
    legalForm: "LLP",
    region: "KZ-ZAP",
    city: "Уральск",
    groups: ["D"],
    tnved: "2710198200",
    product: ["Industrial lubricants", "Смазки индустриальные", "Lubricants"],
    certs: ["ISO 9001"],
    headcount: 30,
    focal: "Айжан Мусина",
    director: "Ерлан Сарсенов",
    registry: false,
    heardAbout: "Социальные сети",
    ndaVersion: "nda-2",
    registeredAt: "2026-11-11T10:00:00+05:00",
    verifiedAt: null,
  },
];

const CERT_ISSUERS: Record<string, string> = {
  "ISO 9001": "Демо Сертификация (орган по сертификации)",
  "ISO 14001": "Демо Сертификация (орган по сертификации)",
  "ISO 45001": "Демо Сертификация (орган по сертификации)",
  API: "Демо орган сертификации API",
};

const review = (decision: SectionReview["decision"], at: string | null, comment: string | null = null) => ({
  decision,
  comment,
  decidedBy: decision ? ACCOUNT.expert : null,
  decidedAt: decision ? at : null,
  changed: false,
});

function build(spec: Spec, i: number): ProtoProfile {
  const n = i + 1;
  const org = MANUFACTURERS[i]!;
  const id = `p${String(n).padStart(2, "0")}`;
  const domain = `company${n}.demo.local`;
  const uploaded = spec.registeredAt;
  const verified = spec.status === "verified";
  const draft = spec.status === "draft";
  const certStatus: DocumentStatus = verified ? "verified" : spec.status === "draft" ? "uploaded" : "under_review";

  const products: ProductLine[] = [
    {
      id: `${id}-pl1`,
      source: spec.registry ? "e_ondiris" : "manual",
      nameEn: spec.product[0],
      nameRu: spec.product[1],
      group: spec.groups[0]!,
      commodityType: spec.product[2],
      tnved: spec.tnved,
      kpved: spec.registry ? "25.11.23" : null,
      capacity: spec.registry
        ? { kind: "registry", text: `${spec.headcount * 40}.00 т/год` }
        : { kind: "added", value: spec.headcount * 25, unit: "pieces" },
      icvPct: spec.registry ? 62 : 0,
      localization: spec.registry ? { done: 9, total: 11 } : null,
      certificate: verified ? file(`${id}-certificate-of-conformity.pdf`, 380, uploaded) : null,
      note: null,
      registry: spec.registry
        ? { entryNumber: `KZ-EO-${org.bin}-01`, inclusionDate: "2024-03-15", active: true, enstru: "251123.900.000000" }
        : null,
    },
  ];
  if (spec.groups[1]) {
    products.push({
      id: `${id}-pl2`,
      source: "manual",
      nameEn: `${spec.product[0]} (service kits)`,
      nameRu: `${spec.product[1]} (ремкомплекты)`,
      group: spec.groups[1],
      commodityType: "Spare parts",
      tnved: `${spec.tnved.slice(0, 4)}900000`,
      kpved: null,
      capacity: { kind: "added", value: 1200, unit: "sets" },
      icvPct: 0,
      localization: null,
      certificate: null,
      note: "Поставка по заявке",
      registry: null,
    });
  }

  const managers = Math.round(spec.headcount * 0.1);
  const office = Math.round(spec.headcount * 0.2);

  return {
    id,
    organizationId: org.id,
    bin: org.bin,
    nameRu: org.name,
    nameEn: org.nameEn,
    status: spec.status,
    pendingChanges: spec.pendingChanges ?? false,
    updateStatus: spec.updateStatus,
    assignedExpertId: spec.assignedExpertId ?? null,
    registeredAt: spec.registeredAt,
    submittedAt: draft ? null : spec.verifiedAt ? addDays(spec.verifiedAt, -7) : addDays(spec.registeredAt, 2),
    verifiedAt: spec.verifiedAt,
    lastConfirmedAt: spec.verifiedAt,
    origin: spec.origin ?? "registered",
    heardAbout: spec.heardAbout,
    nda: spec.ndaVersion ? { versionId: spec.ndaVersion, at: spec.registeredAt, ip: `10.20.0.${n}` } : null,
    sections: {
      main: {
        legalName: org.name,
        legalForm: spec.legalForm,
        website: draft ? null : `https://${domain}`,
        director: spec.director,
        registeredOn: `20${String(10 + (n % 9)).padStart(2, "0")}-0${1 + (n % 9)}-1${n % 9}`,
        okedCodes: spec.registry ? ["25110", "33120"] : ["25110"],
        region: spec.region,
        city: spec.city,
        legalAddress: `${spec.city}, ул. Демонстрационная, ${n}`,
        productionAddress: `${spec.city}, промзона «Демо», участок ${n}`,
        companyPhone: `+7 700 000 00 ${String(n).padStart(2, "0")}`,
        contactEmail: `info@${domain}`,
        unifiedRegister: {
          registered: spec.registry,
          firstIncludedOn: spec.registry ? "2024-03-15" : null,
          extract: spec.registry ? file(`${id}-e-ondiris-extract.pdf`, 120, uploaded) : null,
        },
      },
      contacts: [
        {
          id: `${id}-c1`,
          fullName: spec.focal,
          position: "Коммерческий директор",
          email: `focal@${domain}`,
          phone: `+7 701 000 00 ${String(n).padStart(2, "0")}`,
          role: "commercial",
          focalPoint: true,
        },
        {
          id: `${id}-c2`,
          fullName: spec.director,
          position: "Директор",
          email: `director@${domain}`,
          phone: `+7 702 000 00 ${String(n).padStart(2, "0")}`,
          role: "management",
          focalPoint: false,
        },
        // В Draft контактов два: секция не заполнена (MAN-13 требует трёх).
        ...(draft
          ? []
          : [
              {
                id: `${id}-c3`,
                fullName: "Главный инженер (демо)",
                position: "Главный инженер",
                email: `engineer@${domain}`,
                phone: `+7 705 000 00 ${String(n).padStart(2, "0")}`,
                role: "technical" as const,
                focalPoint: false,
              },
            ]),
      ],
      personnel: {
        managers,
        office,
        production: spec.headcount - managers - office,
        foreignManagers: n % 4 === 0 ? 1 : 0,
        orgChart: draft ? null : file(`${id}-org-chart.pdf`, 210, uploaded),
        cvs: draft ? [] : [file(`${id}-cv-chief-engineer.pdf`, 95, uploaded)],
      },
      shareholders: [
        { id: `${id}-s1`, name: spec.director, sharePct: 60, country: "Казахстан" },
        { id: `${id}-s2`, name: "ТОО «Демо Холдинг»", sharePct: draft ? 30 : 40, country: "Казахстан" },
      ],
      products,
      production: draft
        ? { areaM2: null, processes: [], equipment: [], workshops: null, utilisationPct: null, photos: [] }
        : {
            areaM2: spec.headcount * 30,
            processes: ["Сварка", "Механическая обработка"],
            equipment: [
              {
                id: `${id}-e1`,
                name: "Станок с ЧПУ (демо)",
                type: "Металлообработка",
                quantity: 4,
                productIds: [`${id}-pl1`],
              },
            ],
            workshops: 2,
            utilisationPct: 70,
            photos: [file(`${id}-workshop.jpg`, 1450, uploaded)],
          },
      certificates: spec.certs.map((type, k) => ({
        id: `${id}-cert${k + 1}`,
        type,
        mandatory: type.startsWith("ISO"),
        number: `${type.replace(/\s/g, "")}-DEMO-${String(n * 100 + k)}`,
        issuer: CERT_ISSUERS[type] ?? "Демо Сертификация",
        issuedOn: "2025-02-01",
        expiresOn: "2028-01-31",
        file: file(`${id}-${type.replace(/\s/g, "-").toLowerCase()}.pdf`, 640, uploaded),
        status: certStatus,
        comment: null,
      })),
      documents: [
        {
          id: `${id}-d1`,
          type: "registration_certificate",
          file: file(`${id}-registration-certificate.pdf`, 150, uploaded),
          noLicenceRequired: false,
          status: certStatus,
          comment: null,
        },
        {
          id: `${id}-d2`,
          type: "charter",
          file: draft ? null : file(`${id}-charter.pdf`, 900, uploaded),
          noLicenceRequired: false,
          status: draft ? "missing" : certStatus,
          comment: null,
        },
        {
          id: `${id}-d3`,
          type: "licence",
          file: null,
          noLicenceRequired: true,
          status: draft ? "uploaded" : certStatus,
          comment: null,
        },
      ],
    },
    pending: {},
    review: Object.fromEntries(
      ALL_SECTIONS.map((s) => [s, review(verified ? "verified" : null, spec.verifiedAt)]),
    ) as Record<ProfileSection, SectionReview>,
  };
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
}

/** Двенадцать профилей. Особые случаи дописаны ниже, рядом с объяснением. */
export const profiles: ProtoProfile[] = SPECS.map(build);

const byId = (id: string) => profiles.find((p) => p.id === id)!;

// Verified с ожидающими изменениями: новый контакт ждёт проверки, операторы видят прежние (REV-08, OPR-11).
{
  const p = byId("p02");
  p.pending = {
    contacts: [
      ...p.sections.contacts,
      {
        id: "p02-c4",
        fullName: "Менеджер по тендерам (демо)",
        position: "Менеджер по тендерам",
        email: "tenders@company2.demo.local",
        phone: "+7 707 000 00 02",
        role: "commercial",
        focalPoint: false,
      },
    ],
  };
  p.review.contacts.changed = true;
}

// Unresponsive: сертификат истёк и остаётся на профиле как expired (REV-10).
{
  const p = byId("p04");
  const cert = p.sections.certificates[0]!;
  cert.expiresOn = "2026-10-31";
  cert.status = "expired";
  p.lastConfirmedAt = "2026-04-10T10:00:00+05:00";
}

// Outdated: квартал без подтверждения (UPD-03).
byId("p07").lastConfirmedAt = "2026-06-15T10:00:00+05:00";

// Returned: отклонённые секции и документы с комментариями SME (MAN-44, REV-06).
{
  const p = byId("p10");
  const at = "2026-11-11T16:00:00+05:00";
  for (const s of ALL_SECTIONS) p.review[s] = { ...review("verified", at), decidedBy: ACCOUNT.expert2 };
  p.review.contacts = {
    ...review("rejected", at, "Телефон focal point не отвечает. Укажите действующий номер."),
    decidedBy: ACCOUNT.expert2,
  };
  p.review.certificates = {
    ...review("rejected", at, "Срок ISO 45001 истёк в октябре. Загрузите действующий сертификат."),
    decidedBy: ACCOUNT.expert2,
  };
  p.review.documents = {
    ...review("rejected", at, "Для производства пищевой продукции нужна лицензия или разъяснение."),
    decidedBy: ACCOUNT.expert2,
  };
  const cert = p.sections.certificates.find((c) => c.type === "ISO 45001")!;
  cert.expiresOn = "2026-10-15";
  cert.status = "rejected";
  cert.comment = "Сертификат просрочен.";
  const licence = p.sections.documents.find((d) => d.type === "licence")!;
  licence.status = "rejected";
  licence.comment = "Заявление «лицензия не нужна» не принято.";
}

// Under review: часть секций SME уже решил (REV-02, REV-06).
{
  const p = byId("p11");
  const at = "2026-11-12T10:30:00+05:00";
  p.review.main = review("verified", at);
  p.review.contacts = review("verified", at);
  p.review.personnel = review("rejected", at, "Оргструктура не совпадает с численностью персонала.");
}

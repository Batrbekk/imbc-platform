import {
  contactsReadSchema,
  ownMainInformationSchema,
  ownSectionsOverviewSchema,
  SECTION_KINDS,
  type ContactsRead,
  type MainInformationRead,
  type OwnProfile,
  type OwnSectionsOverview,
  type SectionKind,
  type SectionRead,
} from "@imbc/contracts";
import type { Me } from "@/lib/session";

export const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
export const REGION_ID = uuid(100);
export const ROLE_ID = uuid(101);
export const SITE_ID = uuid(102);
export const SECOND_SITE_ID = uuid(103);
export const READ_AT = "2026-11-12T09:01:30Z";

export const MANUFACTURER: Me = {
  user: {
    id: uuid(1),
    email: "manufacturer@demo.local",
    fullName: null,
    role: "manufacturer",
    organizationId: uuid(2),
    organizationType: "manufacturer",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/profile",
  otpDelivery: "email",
};

export function ownProfile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    profileId: uuid(10),
    organizationName: "ТОО «Демо Металл Конструкция»",
    bin: "240100000001",
    status: "verified",
    hasPendingChanges: false,
    updateStatus: "active",
    tier: "tier_2",
    completenessPct: 100,
    registeredAt: "2026-10-01T10:00:00Z",
    verifiedAt: "2026-11-11T20:00:00Z",
    ...overrides,
  };
}

export function overview(overrides: Partial<OwnSectionsOverview> = {}): OwnSectionsOverview {
  return ownSectionsOverviewSchema.parse({
    profileId: uuid(10),
    profileStatus: "verified",
    readOnly: false,
    hasPendingChanges: false,
    completenessPct: 100 / 3,
    sections: SECTION_KINDS.map((kind, index) => {
      const available = kind === "main_information" || kind === "contacts";
      return {
        kind,
        available,
        profileStatus: "verified",
        revisionId: available ? uuid(20 + index) : null,
        revisionState: available ? "verified" : null,
        revisionOrigin: available ? "manufacturer" : null,
        editVersion: 0,
        savedAt: null,
        readOnly: false,
        hasWorkingChanges: false,
        completeness: { percent: available ? 100 : 0, missing: [] },
      };
    }),
    ...overrides,
  });
}

function section(kind: SectionKind) {
  return {
    kind,
    available: true as const,
    profileStatus: "draft" as const,
    revisionId: uuid(20),
    revisionState: "working" as const,
    revisionOrigin: "manufacturer" as const,
    editVersion: 3,
    savedAt: null,
    readOnly: false,
    hasWorkingChanges: false,
    completeness: { percent: 0, missing: [] },
  };
}

export function mainSection(overrides: Partial<SectionRead<MainInformationRead>> = {}): SectionRead<MainInformationRead> {
  return ownMainInformationSchema.parse({
    ...section("main_information"),
    data: {
      bin: "240100000001",
      loginEmail: "manufacturer@demo.local",
      editable: { website: null, companyPhone: null, contactEmail: null, sites: [] },
      selectedRegions: [],
      legalInformation: {
        legalName: "ТОО «Adata Металл»",
        alternativeName: "Metal Works LLP",
        legalForm: "Товарищество с ограниченной ответственностью",
        directorFullName: "Тестов Тест Тестович",
        stateRegisteredOn: "2016-09-29",
        legalAddress: "Алматы, улица Тестовая, 1",
        founders: ["Айгуль Тестова", "ТОО «Тест Холдинг»"],
        oked: [{ code: "01120", name: "Выращивание риса" }, { code: "28220", name: null }],
      },
      source: { state: "received", readAt: READ_AT, provenance: "adata" },
      registry: { registered: true, firstInclusionOn: "2026-01-05" },
    },
    ...overrides,
  });
}

export function contact(number: number, overrides: Partial<ContactsRead["contacts"][number]> = {}) {
  return {
    fullName: `Person ${number}`,
    position: "Engineer",
    email: `person${number}@demo.local`,
    phone: `+44207946${String(number).padStart(4, "0")}`,
    roleId: ROLE_ID,
    isFocalPoint: number === 1,
    ...overrides,
  };
}

export function contactsSection(
  data: ContactsRead = { contacts: [contact(1), contact(2), contact(3)] },
  overrides: Partial<SectionRead<ContactsRead>> = {},
): SectionRead<ContactsRead> {
  return { ...section("contacts"), completeness: { percent: 100, missing: [] }, data: contactsReadSchema.parse(data), ...overrides };
}

export const regionChoices = {
  items: [{ id: REGION_ID, code: "KZ-ALA", name: "Алматы", parentCode: null }],
  total: 1,
  page: 1,
  pageSize: 100,
};
export const roleChoices = {
  items: [{ id: ROLE_ID, code: "technical", name: "Technical", parentCode: null }],
  total: 1,
  page: 1,
  pageSize: 100,
};

import type { Locale, ImbcNoteRead, ImbcEngagementRead, ImbcProductContextRead, Role } from "@imbc/contracts";
import type { RouteObject } from "react-router";
import { renderRoute } from "./render";
import { stubApi, type ApiReply } from "./api";
import { me as surveyMe, uuid } from "./survey";
import en from "../../messages/en.json";
import ru from "../../messages/ru.json";
import kk from "../../messages/kk.json";
export { uuid };
export const PROFILE = uuid(600),
  ORG = uuid(601),
  ACTOR = uuid(602),
  NOTE = uuid(603),
  PRODUCT = uuid(604),
  SOURCE = uuid(605),
  PROGRAMME = uuid(606),
  PRIORITY = uuid(607),
  EVENT = uuid(608);
export const TIME = "2026-11-01T08:09:10.123456Z",
  NEXT = "2026-11-01T08:09:10.123457Z";
export const BASE = `/api/v1/profiles/${PROFILE}`,
  NOTES = `${BASE}/imbc-notes`,
  ENGAGEMENT = `${BASE}/imbc-engagement`,
  CONTEXT = `${BASE}/products/${PRODUCT}/imbc-context`,
  URL = `/imbc/profiles/${PROFILE}/records`;
export const messages = { en: en.imbcRecords, ru: ru.imbcRecords, kk: kk.imbcRecords };
export const note = (patch: Partial<ImbcNoteRead> = {}): ImbcNoteRead => ({
  id: NOTE,
  profileId: PROFILE,
  organizationId: ORG,
  authorId: null,
  authorName: null,
  kind: "migration_context",
  body: "Demo historical note",
  source: "migration",
  createdAt: TIME,
  updatedAt: TIME,
  ...patch,
});
export const provenance = {
  source: "migration" as const,
  recordedBy: null,
  recordedByName: null,
  createdAt: TIME,
  updatedAt: TIME,
};
export const engagement = (patch: Partial<ImbcEngagementRead> = {}): ImbcEngagementRead => ({
  profileId: PROFILE,
  organizationId: ORG,
  receiptConfirmed: null,
  response: null,
  responseSummary: null,
  readyForSiteVisit: null,
  addedToImbcYear: null,
  folderUrl: null,
  sourceEntryIds: [],
  eoiEvents: [{ id: EVENT, sentOn: "2020-05-04", ...provenance }],
  ...provenance,
  ...patch,
});
export const context = (patch: Partial<ImbcProductContextRead> = {}): ImbcProductContextRead => ({
  productLineIdentityId: PRODUCT,
  profileId: PROFILE,
  organizationId: ORG,
  programmeId: null,
  priorityId: null,
  ...provenance,
  ...patch,
});
export const reference = (id: string, code: string, retired = false) => ({
  id,
  code,
  names: { en: `Demo ${code}`, ru: `Демо ${code}`, kk: `Демо ${code}` },
  retiredAt: retired ? TIME : null,
});
export function fixtures(role: Role = "expert", overrides: Record<string, ApiReply> = {}) {
  const me = surveyMe(role);
  me.user.id = ACTOR;
  me.user.email = `${role}@records.local`;
  const refs: Record<string, ReturnType<typeof reference>[]> = {
    programme: [reference(PROGRAMME, "LC")],
    imbc_priority: [reference(PRIORITY, "1")],
    acquisition_source: [],
  };
  const contextPage = (url: globalThis.URL) => {
    const rows = [
      {
        context: context(),
        product: {
          productLineIdentityId: PRODUCT,
          nameEn: "Demo current product",
          nameRu: "Демо текущая продукция",
          sectionRevisionId: uuid(610),
          isCurrent: true,
        },
      },
    ];
    const ids = url.searchParams.get("ids")?.split(",");
    const items = ids ? rows.filter((row) => ids.includes(row.product.productLineIdentityId)) : rows;
    if (ids && items.length !== ids.length)
      return Response.json(
        { status: 404, code: "not_found" },
        { status: 404, headers: { "content-type": "application/problem+json" } },
      );
    return Response.json({
      profileId: PROFILE,
      organizationId: ORG,
      items,
      total: items.length,
      offset: 0,
      limit: ids?.length ?? 25,
    });
  };
  return stubApi({
    [`GET ${BASE}/imbc-records/context-products`]: contextPage,
    "GET /api/auth/me": { body: me },
    [`GET ${NOTES}`]: {
      body: {
        profileId: PROFILE,
        organizationId: ORG,
        organizationName: "Demo internal manufacturer",
        canEdit: role === "expert",
        items: [note()],
        total: 1,
        offset: 0,
        limit: 25,
      },
    },
    [`GET ${NOTES}/${NOTE}`]: { body: note() },
    [`GET ${NOTES}/${NOTE}/history`]: { body: { items: [], nextCursor: null } },
    [`GET ${ENGAGEMENT}`]: { body: engagement() },
    [`GET ${ENGAGEMENT}/history`]: { body: { items: [], nextCursor: null } },
    [`GET ${CONTEXT}`]: { body: context() },
    [`GET ${CONTEXT}/history`]: { body: { items: [], nextCursor: null } },
    [`GET ${BASE}/imbc-records/product-options`]: {
      body: {
        profileId: PROFILE,
        organizationId: ORG,
        sectionRevisionId: uuid(610),
        items: [{ productLineIdentityId: PRODUCT, nameEn: "Demo current product", nameRu: "Демо текущая продукция" }],
        total: 1,
        offset: 0,
        limit: 25,
      },
    },
    ...Object.fromEntries(
      Object.entries(refs).map(([code, rows]) => [
        `GET ${BASE}/imbc-records/reference-options/${code}`,
        (url: globalThis.URL) => {
          const ids = url.searchParams.get("ids")?.split(",");
          const items = ids ? rows.filter((row) => ids.includes(row.id)) : rows;
          return Response.json({
            dictionaryCode: code,
            items,
            total: items.length,
            offset: 0,
            limit: ids?.length ?? 25,
          });
        },
      ]),
    ),
    ...overrides,
  });
}
export function mount(element: React.ReactNode, locale: Locale = "en", entry = URL, additional: RouteObject[] = []) {
  return renderRoute(entry, {
    locale,
    routes: [
      { path: URL, element },
      { path: "/away", element: <h1>Demo destination</h1> },
      { path: "/reviews", element: <h1>Demo review queue</h1> },
      { path: "/imbc/site-survey-requests", element: <h1>Demo request queue</h1> },
      { path: "/companies/:profileId", element: <h1>Demo company</h1> },
      { path: "/catalog", element: <h1>Demo catalogue</h1> },
      ...additional,
    ],
  });
}

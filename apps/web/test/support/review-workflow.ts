import { SECTION_KINDS, reviewWorkbenchSchema, reviewSectionReadSchema, type ProfileFile, type ReviewOperationalQueue, type ReviewSectionRead, type ReviewWorkbench, type Role } from "@imbc/contracts";
import type { Me } from "@/lib/session";
import { stubApi, type ApiReply } from "./api";
import { contact, mainSection, REGION_ID, ROLE_ID, SITE_ID, uuid } from "./profile-fixtures";

export const REVIEW_ID = uuid(801), REVIEW_PROFILE = uuid(802), REVIEW_EXPERT = uuid(803), REVIEW_OTHER_EXPERT = uuid(804);
export const REVIEW_TIME = "2026-11-01T20:00:00.123456Z", REVIEW_NEW_TIME = "2026-11-16T08:09:10.654321Z";
export const REVIEW_API = `/api/v1/reviews/assignments/${REVIEW_ID}`, REVIEW_URL = `/reviews/assignments/${REVIEW_ID}`;
export const REVIEW_NAME = "Synthetic demo manufacturer";
const certificateId = uuid(820), productId = uuid(821), documentId = uuid(822);
export const reviewFile = (id: number): ProfileFile => ({ fileId: uuid(id), versionId: uuid(id + 1000), versionNumber: 2, originalName: `Demo captured ${id}.pdf`, byteSize: 1024,
  mediaType: "application/pdf", scanState: "passed", rejectionReason: null, uploadedAt: REVIEW_TIME, canDownload: true });
const ref = (id: string, code: string, name: string) => ({ id, code, names: { en: name, ru: name, kk: name }, retired: true });
const label = (id: string, code: string, name: string) => ({ id, code, names: { en: name, ru: name, kk: name } });
export const reviewMetadata = (row: ReviewOperationalQueue["items"][number]) => ({ profileId: row.profileId, organizationName: row.organizationName, status: row.status, hasPendingChanges: row.hasPendingChanges,
  assignmentId: row.assignmentId, assignedExpertId: row.assignedExpertId, assignedExpert: row.assignedExpert, unresolved: row.unresolved });
export function reviewMe(role: Role = "expert"): Me {
  return { user: { id: REVIEW_EXPERT, email: `${role}@review.local`, fullName: "Demo SME", role, organizationId: uuid(899), organizationType: role === "manufacturer" ? "manufacturer" : role === "operator" ? "operator" : "imbc", locale: "en" }, gates: { mfa: true, responsibility: true }, homePath: role === "administrator" ? "/admin/accounts" : "/reviews", otpDelivery: "email" };
}
export const REVIEW_QUEUE: ReviewOperationalQueue = { items: [{ profileId: REVIEW_PROFILE, organizationName: REVIEW_NAME, bin: "000100000001", status: "submitted", hasPendingChanges: false,
  assignmentId: REVIEW_ID, assignedExpertId: null, assignedExpert: null, registeredAt: "2026-10-01T00:00:00Z", receivedAt: REVIEW_TIME, unresolved: false }], total: 1, offset: 0, limit: 25 };
export function reviewFixture() {
  const main = mainSection().data; main.editable = { companyPhone: "+442079460001", contactEmail: "company@review.local", website: null,
    sites: [{ identityId: SITE_ID, address: "Demo submitted factory address", city: "Demo city", regionId: REGION_ID }] }; main.selectedRegions = [label(REGION_ID, "KZ-ALA", "Demo retired region")];
  const metadata: ReviewWorkbench["sections"] = SECTION_KINDS.map((kind, index) => ({ kind, revisionId: uuid(900 + index), revisionState: "submitted", reviewRequired: true, retainedDecisionId: null, completenessPct: 100, decision: null, items: [] }));
  const chart = reviewFile(830), certFile = reviewFile(831), docFile = reviewFile(832);
  metadata.find(section => section.kind === "documents")!.items = [{ subject: { kind: "document", documentId: uuid(840) }, stableIdentityId: documentId, fileObjectId: docFile.fileId,
    label: { kind: "document", positionInList: 4, type: { code: "charter", names: { en: "Demo charter", ru: "Демо устав", kk: "Демо жарғы" } }, customName: "Demo original document label" }, decision: null }];
  metadata.find(section => section.kind === "certificates")!.items = [{ subject: { kind: "certificate", certificateId: uuid(841) }, stableIdentityId: certificateId, fileObjectId: certFile.fileId,
    label: { kind: "certificate", positionInList: 2, type: null, number: "Demo cert 003", customTypeName: "Demo held product certificate" }, decision: null }];
  const data: Record<string, unknown> = {
    main_information: main, contacts: { contacts: [contact(1), contact(2), contact(3)] },
    personnel: { editable: { managersCount: 2, engineersCount: 3, productionWorkersCount: 4, nonresidentCount: 1, organisationChartIds: [chart.fileId], cvFileIds: [] }, totalHeadcount: 9, organisationCharts: [chart], cvs: [] },
    products: { editable: { products: [{ kind: "registry", identityId: productId, productionSiteIdentityId: SITE_ID, note: "Demo submitted product note", certificateIdentityIds: [certificateId] }], unifiedRegisterExtractId: null },
      lines: [{ identityId: productId, source: "e_ondiris", nameEn: "Demo submitted pump", nameRu: "Демо насос", commodityTypeId: uuid(850), tnVedCode: "0012345678", tnVedEntryId: null, kpved: [{ code: "00123", sourceName: "Demo raw classification", entryId: null }], capacityQuantity: "9007199254740993.125", capacityUnitId: uuid(851), capacityText: null, inCountryValueShare: "0", enstruCode: "000123", enstruName: "Demo ENSTRU", unifiedRegisterRegistrationNumber: "Demo reg 001", unifiedRegisterActive: false, unifiedRegisterIncludedOn: "2026-01-01", productionSiteIdentityId: SITE_ID, note: "Demo submitted product note", certificateIdentityIds: [certificateId] }], extract: null,
      selectedReferences: { commodityTypes: [{ ...ref(uuid(850), "pump", "Demo pump classification"), group: ref(uuid(852), "A", "Demo group") }], tnVed: [], kpved: [], units: [ref(uuid(851), "pieces", "Demo pieces")] }, relatedChoices: null },
    production: { editable: { areaSqm: "9007199254740993.12", workshopCount: null, utilisationPercent: "20.25", processEntryIds: [], photoIds: [], equipment: [{ name: "Demo equipment", typeId: null, quantity: null, photoId: null, productIdentityIds: [productId] }] }, photos: [], equipmentPhotos: [null], selectedReferences: { processes: [], equipmentTypes: [] }, productChoices: null },
    certificates: { editable: { certificates: [{ identityId: certificateId, group: "product", certificateTypeId: null, customTypeName: "Demo held product certificate", notHeld: false, number: "Demo cert 003", issuingBody: "Demo issuer", issuedOn: "2026-01-01", expiresOn: null, fileId: certFile.fileId },
      { identityId: uuid(823), group: "company", certificateTypeId: uuid(853), customTypeName: null, notHeld: true, number: null, issuingBody: null, issuedOn: null, expiresOn: null, fileId: null }] }, certificates: [{ identityId: certificateId, certificateType: null, status: "under_review", file: certFile }, { identityId: uuid(823), certificateType: { ...label(uuid(853), "ISO 9001", "ISO 9001"), customNameAllowed: false }, status: null, file: null }], requiredTypes: [], requirementSource: "submission" },
    documents: { editable: { documents: [{ identityId: documentId, documentTypeId: uuid(854), customName: "Demo original document label", fileId: docFile.fileId }] }, documents: [{ identityId: documentId, documentType: { ...label(uuid(854), "charter", "Demo charter"), customNameAllowed: false }, status: "under_review", file: docFile }], requiredTypes: [], requirementSource: "submission" },
  };
  const workbench = reviewWorkbenchSchema.parse({ profileId: REVIEW_PROFILE, organizationName: REVIEW_NAME, profileStatus: "under_review", hasPendingChanges: false,
    assignment: { id: REVIEW_ID, expertId: REVIEW_EXPERT, receivedAt: REVIEW_TIME, assignedAt: REVIEW_TIME }, sections: metadata, canSubmitResult: false });
  const sections = Object.fromEntries(metadata.map(section => [section.kind, reviewSectionReadSchema.parse({ ...section, data: data[section.kind],
    ...(section.kind === "contacts" ? { selectedContactRoles: [ref(ROLE_ID, "technical", "Demo retired contact role")] } : {}) })])) as Record<ReviewSectionRead["kind"], ReviewSectionRead>;
  return { workbench, sections };
}
export function stubReview(role: Role = "expert", overrides: Record<string, ApiReply> = {}, fixture = reviewFixture()) {
  const admin = REVIEW_QUEUE.items.map(reviewMetadata);
  return stubApi({ "GET /api/auth/me": { body: reviewMe(role) }, "GET /api/v1/reviews/queue": { body: REVIEW_QUEUE }, "GET /api/v1/reviews/assignment-queue": { body: { items: admin, total: 1, offset: 0, limit: 25 } },
    [`GET /api/v1/reviews/assignment-queue/${REVIEW_ID}`]: { body: admin[0] },
    "GET /api/v1/reviews/queue/experts": { body: [{ id: REVIEW_EXPERT, label: "Demo SME" }, { id: REVIEW_OTHER_EXPERT, label: "Demo second SME" }] }, "GET /api/v1/reviews/experts": { body: [{ id: REVIEW_EXPERT, label: "Demo SME" }, { id: REVIEW_OTHER_EXPERT, label: "Demo second SME" }] },
    [`POST ${REVIEW_API}/open`]: { body: fixture.workbench }, [`GET ${REVIEW_API}`]: { body: fixture.workbench },
    ...Object.fromEntries(SECTION_KINDS.map(kind => [`GET ${REVIEW_API}/sections/${kind}`, { body: fixture.sections[kind] }])), ...overrides });
}

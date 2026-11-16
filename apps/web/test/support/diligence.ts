import { diligenceReadSchema, diligenceHistorySchema, type DiligenceHistoryEntry, type DiligenceRead, type Role } from "@imbc/contracts";
import type { Me } from "@/lib/session";
import { stubApi, type ApiReply } from "./api";

export const ddId = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const DD_PROFILE = ddId(10), DD_ORG = ddId(11), DD_URL = `/imbc/profiles/${DD_PROFILE}/due-diligence`, DD_API = `/api/v1/profiles/${DD_PROFILE}/due-diligence`;
export const DD_TIME = "2026-11-15T01:02:03.123456Z", DD_NEW_TIME = "2026-11-16T08:09:10.654321Z";
export const DD_DATA: DiligenceRead = {
  profileId: DD_PROFILE, organizationId: DD_ORG,
  record: { profileId: DD_PROFILE, organizationId: DD_ORG, checkedOn: "2026-11-15", checkedAt: DD_TIME, sourceIsTestData: true,
    adataResult: "red", result: "red", comment: "Demo saved explanation", reportFileId: ddId(20), reportFileVersionId: ddId(21), reportFileVersionNumber: 2,
    overriddenBy: null, overriddenAt: null, enhanced: "not_done", enhancedComment: null, enhancedReportFileId: null, enhancedReportFileVersionId: null, enhancedReportFileVersionNumber: null,
    sourceSnapshotId: ddId(12), updatedAt: DD_TIME },
  checks: [
    { groupName: "company_enterprise", subjectName: "Demo DD company", checkName: "Demo critical bankruptcy", adataValue: "yes", mark: "finding", attention: false },
    { groupName: "director", subjectName: "Demo DD director", checkName: "Demo court counts", adataValue: '{"civil":"9007199254740993","criminal":"0","administrative":"0","APPK":"0"}', mark: "shown_only", attention: true },
    { groupName: "company_tax", subjectName: "Demo DD company", checkName: "Demo exact tax total", adataValue: "9007199254740993.12500", mark: "clear", attention: false },
    { groupName: "company_procurement", subjectName: "Demo DD company", checkName: "Demo shown zero", adataValue: "0", mark: "shown_only", attention: false },
    { groupName: "founder", subjectName: "Demo DD founder", checkName: "Demo source timeout", adataValue: null, mark: "no_answer", attention: false },
  ].map((check, position) => ({ ...check, id: ddId(30 + position), position, profileId: DD_PROFILE, organizationId: DD_ORG })) as DiligenceRead["checks"],
  lastRun: { attemptId: ddId(40), snapshotId: ddId(12), state: "received", requestedAt: DD_TIME, completedAt: DD_TIME, isTestData: true },
};
function stored(data: DiligenceRead) {
  const r = data.record;
  return { record: r ? { profile_id: r.profileId, organization_id: r.organizationId, checked_on: r.checkedOn, adata_result: r.adataResult, result: r.result, comment: r.comment,
    report_file_id: r.reportFileId, report_file_version_id: r.reportFileVersionId, overridden_by: r.overriddenBy, overridden_at: r.overriddenAt,
    enhanced: r.enhanced, enhanced_comment: r.enhancedComment, enhanced_report_file_id: r.enhancedReportFileId, enhanced_report_file_version_id: r.enhancedReportFileVersionId,
    source_snapshot_id: r.sourceSnapshotId, updated_at: r.updatedAt } : null,
    checks: data.checks.map(c => ({ id: c.id, profile_id: c.profileId, organization_id: c.organizationId, group_name: c.groupName, subject_name: c.subjectName, check_name: c.checkName, adata_value: c.adataValue, mark: c.mark, attention: c.attention, position: c.position })) };
}
export const DD_HISTORY: DiligenceHistoryEntry = {
  id: ddId(50), at: DD_NEW_TIME, actorId: ddId(1), actorName: "Demo SME",
  action: "due_diligence.override", diff: { operationId: ddId(51), actor: { type: "user", id: ddId(1) },
    before: stored({ ...DD_DATA, record: { ...DD_DATA.record!, comment: "Demo old full comment", reportFileVersionId: ddId(22), reportFileVersionNumber: 1 } }),
    after: stored({ ...DD_DATA, record: { ...DD_DATA.record!, comment: "Demo new full comment", updatedAt: DD_NEW_TIME } }) },
  reports: [{ fileId: ddId(20), versionId: ddId(22), versionNumber: 1 }, { fileId: ddId(20), versionId: ddId(21), versionNumber: 2 }],
  sourceSnapshots: [{ snapshotId: ddId(12), checkedAt: DD_TIME, isTestData: true }],
};
export function ddMe(role: Role): Me {
  return { user: { id: ddId(1), email: `${role}@diligence.local`, fullName: "Demo user", role, organizationId: ddId(2), organizationType: role === "manufacturer" ? "manufacturer" : role === "operator" ? "operator" : "imbc", locale: "en" }, gates: { mfa: true, responsibility: true }, homePath: "/reviews", otpDelivery: "email" };
}
export function stubDiligence(role: Role = "expert", data = DD_DATA, overrides: Record<string, ApiReply> = {}) {
  diligenceReadSchema.parse(data); diligenceHistorySchema.parse([DD_HISTORY]);
  return stubApi({ "GET /api/auth/me": { body: ddMe(role) }, [`GET ${DD_API}`]: { body: data }, [`GET ${DD_API}/history`]: { body: [DD_HISTORY] }, ...overrides });
}

import { entryDisplayName, type ProfileFile, type ProfileOwnReviewItemLabel, type ProfileReviewSubject, type ReviewSectionRead } from "@imbc/contracts";
import { ApiError } from "@/lib/api";
/** A denied/reassigned assignment requires fresh authority proof before any further write. */
export const reviewAuthorityLost = (error: unknown) => error instanceof ApiError
  && ([401, 403].includes(error.status) || error.code === "assignment_changed");
export const reviewSubjectKey = (subject: ProfileReviewSubject) => JSON.stringify(subject);
export function reviewItemTitle(label: ProfileOwnReviewItemLabel | null, locale: "en" | "ru" | "kk", fallback: string) {
  if (!label) return fallback;
  if (label.kind === "file") return label.originalName;
  const type = label.type ? entryDisplayName(label.type.names, locale, label.type.code) : null;
  return (label.kind === "document" ? [type, label.customName] : [type, label.customTypeName, label.number]).filter(Boolean).join(" — ") || fallback;
}
export function reviewSectionFiles(section: ReviewSectionRead): ProfileFile[] {
  switch (section.kind) {
    case "personnel": return [...section.data.organisationCharts, ...section.data.cvs];
    case "products": return section.data.extract ? [section.data.extract] : [];
    case "production": return [...section.data.photos, ...section.data.equipmentPhotos.filter((file): file is ProfileFile => file !== null)];
    case "certificates": return section.data.certificates.flatMap(row => row.file ? [row.file] : []);
    case "documents": return section.data.documents.flatMap(row => row.file ? [row.file] : []);
    default: return [];
  }
}
export function reviewUnverifiableItems(section: ReviewSectionRead) {
  return new Set(section.items.filter(item => {
    let file: ProfileFile | undefined | null;
    if (item.subject.kind === "file") { const subject = item.subject; file = reviewSectionFiles(section).find(file => file.fileId === item.fileObjectId && file.versionId === subject.fileVersionId); }
    else if (item.subject.kind === "document" && section.kind === "documents") file = section.data.documents.find(row => row.identityId === item.stableIdentityId)?.file;
    else if (item.subject.kind === "certificate" && section.kind === "certificates") file = section.data.certificates.find(row => row.identityId === item.stableIdentityId)?.file;
    return !file || file.scanState !== "passed" || file.versionId === null || file.versionNumber === null;
  }).map(item => reviewSubjectKey(item.subject)));
}
export function reviewSectionFileBlocked(section: ReviewSectionRead) {
  let ids: (string | null)[] = [];
  switch (section.kind) {
    case "personnel": ids = [...section.data.editable.organisationChartIds, ...section.data.editable.cvFileIds]; break;
    case "products": ids = [section.data.editable.unifiedRegisterExtractId]; break;
    case "production": ids = [...section.data.editable.photoIds, ...section.data.editable.equipment.map(row => row.photoId)]; break;
    case "certificates": ids = section.data.editable.certificates.filter(row => !row.notHeld).map(row => row.fileId); break;
    case "documents": ids = section.data.editable.documents.map(row => row.fileId); break;
  }
  const files = reviewSectionFiles(section);
  return ids.some(id => id !== null && !files.some(file => file.fileId === id && file.scanState === "passed" && file.versionId !== null && file.versionNumber !== null));
}

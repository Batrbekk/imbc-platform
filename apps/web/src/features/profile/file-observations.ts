import type { ProfileFile } from "@imbc/contracts";

/** Refresh scan observations only for the exact displayed file version, never content or edit intent. */
export function mergeFileObservations<T>(retained: T, observed: T): T {
  const files = new Map<string, ProfileFile>();
  function isFile(node: object): node is ProfileFile {
    return "fileId" in node && "versionId" in node && "scanState" in node && "canDownload" in node;
  }
  function collect(node: unknown) {
    if (typeof node !== "object" || node === null) return;
    if (isFile(node)) { if (node.versionId) files.set(`${node.fileId}:${node.versionId}`, node); return; }
    for (const child of Object.values(node)) collect(child);
  }
  collect(observed);
  function merge(node: unknown): unknown {
    if (typeof node !== "object" || node === null) return node;
    if (isFile(node)) {
      const latest = node.versionId ? files.get(`${node.fileId}:${node.versionId}`) : undefined;
      return latest ? { ...node, scanState: latest.scanState, rejectionReason: latest.rejectionReason, canDownload: latest.canDownload } : node;
    }
    if (Array.isArray(node)) return node.map(merge);
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, merge(value)]));
  }
  return merge(retained) as T;
}

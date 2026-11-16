import { diligenceReadSchema, diligenceHistorySchema, type DiligenceEnhancedWrite, type DiligenceOverrideWrite } from "@imbc/contracts";
import { api } from "@/lib/api";

export const diligencePath = (profileId: string) => `/v1/profiles/${encodeURIComponent(profileId)}/due-diligence`;
export const readDiligence = async (profileId: string) => diligenceReadSchema.parse(await api(diligencePath(profileId)));
export const runDiligence = async (profileId: string) => diligenceReadSchema.parse(await api(`${diligencePath(profileId)}/runs`, { method: "POST", json: {} }));
export const saveOverride = async (profileId: string, write: DiligenceOverrideWrite) => diligenceReadSchema.parse(await api(`${diligencePath(profileId)}/override`, { method: "PUT", json: write }));
export const saveEnhanced = async (profileId: string, write: DiligenceEnhancedWrite) => diligenceReadSchema.parse(await api(`${diligencePath(profileId)}/enhanced`, { method: "PUT", json: write }));
export const readDiligenceHistory = async (profileId: string, beforeId?: string) => diligenceHistorySchema.parse(await api(`${diligencePath(profileId)}/history${beforeId ? `?beforeId=${encodeURIComponent(beforeId)}` : ""}`));
/** Evidence links use the captured numeric version, never the current object version. */
export const diligenceReportUrl = (fileId: string, versionNumber: number) => `/api/v1/files/${encodeURIComponent(fileId)}/content?version=${versionNumber}`;

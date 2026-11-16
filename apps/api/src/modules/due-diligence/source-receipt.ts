import { ADATA_DILIGENCE_SCHEMA_SHA256, InvalidAdataDiligenceData, normalizeAdataCompanyInfo } from './adata-normalizer.js';
import { DILIGENCE_CATALOG_VERSION } from './catalog.js';
import type { DiligenceEvidence, DiligenceResult } from './scoring.js';

export type DiligenceSourceReceiptState = 'received' | 'no_answer' | 'unavailable' | 'modules_not_connected' | 'not_configured' | 'quota_exhausted' | 'malformed';
/** A separate immutable Class C packet. The worker stores Main prefill separately, never the raw report. */
export interface DiligenceSourceReceipt {
  state: DiligenceSourceReceiptState;
  evidence: readonly DiligenceEvidence[];
  automaticResult: DiligenceResult | null;
  schemaVersion: string;
  schemaSha256: string;
  isTestData: boolean;
}
export function unavailableDiligenceReceipt(state: Exclude<DiligenceSourceReceiptState, 'received'>, isTestData: boolean): DiligenceSourceReceipt {
  if (typeof isTestData !== 'boolean') throw new InvalidAdataDiligenceData('invalid_context');
  return { state, evidence: [], automaticResult: null, schemaVersion: DILIGENCE_CATALOG_VERSION, schemaSha256: ADATA_DILIGENCE_SCHEMA_SHA256, isTestData };
}
export function normalizedDiligenceReceipt(data: unknown, options: { bin: string; companyName: string; isTestData: boolean }): DiligenceSourceReceipt {
  try {
    const normalized = normalizeAdataCompanyInfo(data, options);
    return {
      state: normalized.evaluation === null ? 'no_answer' : 'received',
      evidence: normalized.evidence,
      automaticResult: normalized.evaluation?.automaticResult ?? null,
      schemaVersion: DILIGENCE_CATALOG_VERSION,
      schemaSha256: normalized.schemaSha256,
      isTestData: normalized.isTestData,
    };
  } catch (error) {
    if (error instanceof InvalidAdataDiligenceData) return unavailableDiligenceReceipt('malformed', options.isTestData);
    throw error;
  }
}

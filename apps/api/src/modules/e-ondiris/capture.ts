import { checkBin } from '@imbc/contracts';
import {
  eOndirisScopeHash,
  parseEOndirisRows,
  type EOndirisIssue,
  type EOndirisNormalizedRecord,
} from './normalization.js';

export type EOndirisProvenance = 'synthetic' | 'recorded' | 'provider';
export interface EOndirisCaptureMetadata {
  /** Trusted connector observation time, stable across retries; never the worker execution time. */
  observedAt: string;
  bin: string;
  provenance: EOndirisProvenance;
  /** All rows observed for this BIN have been grouped before validation; never a page/one-row event. */
  coverage: 'all_observed_bin_rows';
}
export interface EOndirisCapture {
  provider: 'e-ondiris';
  bin: string;
  observedAt: Date;
  provenance: EOndirisProvenance;
  coverage: 'all_observed_bin_rows';
  scopeHash: string;
  records: readonly EOndirisNormalizedRecord[];
}
export type EOndirisCaptureResult =
  | { kind: 'received'; capture: EOndirisCapture }
  | { kind: 'quarantined'; issues: EOndirisIssue[] }
  | { kind: 'unavailable'; reason: 'access_not_configured' | 'rate_limited' | 'transport_error' | 'no_response' };

/** Local adapter boundary, not a claim that an upstream API/envelope exists. */
export interface EOndirisConnector {
  pull(bin: string, signal?: AbortSignal): Promise<EOndirisCaptureResult>;
}

function validateObservation(metadata: Pick<EOndirisCaptureMetadata, 'observedAt' | 'provenance'>): void {
  if (!['synthetic', 'recorded', 'provider'].includes(metadata.provenance))
    throw new Error('Invalid e-Ondiris capture provenance');
  if (
    typeof metadata.observedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(metadata.observedAt) ||
    !Number.isFinite(Date.parse(metadata.observedAt)) ||
    new Date(metadata.observedAt).toISOString() !== metadata.observedAt
  )
    throw new Error('Invalid e-Ondiris capture observation time');
}

export function validateEOndirisCapture(rawRows: unknown, metadata: EOndirisCaptureMetadata): EOndirisCaptureResult {
  if (typeof metadata.bin !== 'string' || !/^\d{12}$/.test(metadata.bin) || !checkBin(metadata.bin).valid)
    throw new Error('Invalid e-Ondiris capture scope');
  validateObservation(metadata);
  if (metadata.coverage !== 'all_observed_bin_rows') throw new Error('Incomplete e-Ondiris BIN capture');
  const parsed = parseEOndirisRows(rawRows, metadata.bin);
  if (parsed.kind === 'quarantined') return parsed;
  return {
    kind: 'received',
    capture: {
      provider: 'e-ondiris',
      bin: metadata.bin,
      observedAt: new Date(metadata.observedAt),
      provenance: metadata.provenance,
      coverage: metadata.coverage,
      scopeHash: eOndirisScopeHash(parsed.records),
      records: parsed.records,
    },
  };
}

/** Group a fully assembled observed feed before advancing any BIN watermark. Not an upstream wire envelope. */
export function validateEOndirisFeed(
  rawRows: unknown,
  metadata: Pick<EOndirisCaptureMetadata, 'observedAt' | 'provenance'> & { coverage: 'all_observed_feed_rows' },
  maxRows = 250_000,
): { kind: 'received'; captures: EOndirisCapture[] } | Extract<EOndirisCaptureResult, { kind: 'quarantined' }> {
  validateObservation(metadata);
  if (metadata.coverage !== 'all_observed_feed_rows') throw new Error('Incomplete e-Ondiris feed capture');
  if (!Array.isArray(rawRows))
    return { kind: 'quarantined', issues: [{ row: null, field: 'data', code: 'rows_required' }] };
  if (rawRows.length > maxRows)
    return { kind: 'quarantined', issues: [{ row: null, field: 'data', code: 'capture_too_large' }] };
  const groups = new Map<string, { rows: unknown[]; indexes: number[] }>();
  const issues: EOndirisIssue[] = [];
  Array.from(rawRows).forEach((raw: unknown, row) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push({ row, field: 'data', code: 'object_required' });
      return;
    }
    const value = 'bin_iin' in raw ? raw.bin_iin : undefined;
    if (typeof value !== 'string') {
      issues.push({ row, field: 'bin_iin', code: 'string_required' });
      return;
    }
    const bin = value.trim();
    if (!/^\d{12}$/.test(bin)) {
      issues.push({ row, field: 'bin_iin', code: 'identifier_format' });
      return;
    }
    if (!checkBin(bin).valid) {
      issues.push({ row, field: 'bin_iin', code: 'bin_check_digit' });
      return;
    }
    const group = groups.get(bin) ?? { rows: [], indexes: [] };
    group.rows.push(raw);
    group.indexes.push(row);
    groups.set(bin, group);
  });
  const captures: EOndirisCapture[] = [];
  for (const [bin, group] of groups) {
    const parsed = validateEOndirisCapture(group.rows, { ...metadata, bin, coverage: 'all_observed_bin_rows' });
    if (parsed.kind === 'received') captures.push(parsed.capture);
    else if (parsed.kind === 'quarantined')
      issues.push(
        ...parsed.issues.map((issue) => ({ ...issue, row: issue.row === null ? null : group.indexes[issue.row]! })),
      );
  }
  return issues.length > 0
    ? { kind: 'quarantined', issues }
    : { kind: 'received', captures: captures.sort((a, b) => a.bin.localeCompare(b.bin, 'en')) };
}

/** Explicit unavailable result has no finding, no rows, no accepted watermark. */
export class UnconfiguredEOndirisConnector implements EOndirisConnector {
  async pull(_bin: string): Promise<EOndirisCaptureResult> {
    return { kind: 'unavailable', reason: 'access_not_configured' };
  }
}

/** Test/recorded responses are supplied by an owner; this adapter performs no network calls. */
export class RecordedEOndirisConnector implements EOndirisConnector {
  constructor(
    private readonly load: (bin: string) => Promise<{ rows: unknown; metadata: EOndirisCaptureMetadata } | null>,
  ) {}
  async pull(bin: string, signal?: AbortSignal): Promise<EOndirisCaptureResult> {
    if (signal?.aborted) return { kind: 'unavailable', reason: 'transport_error' };
    let result: Awaited<ReturnType<typeof this.load>>;
    try {
      result = await this.load(bin);
    } catch {
      return { kind: 'unavailable', reason: 'transport_error' };
    }
    if (signal?.aborted) return { kind: 'unavailable', reason: 'transport_error' };
    if (result === null) return { kind: 'unavailable', reason: 'no_response' };
    if (result.metadata.bin !== bin) throw new Error('e-Ondiris connector returned a different scope');
    return validateEOndirisCapture(result.rows, result.metadata);
  }
}

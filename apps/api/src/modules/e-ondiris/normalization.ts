import { createHash } from 'node:crypto';
import { checkBin } from '@imbc/contracts';

/** Canonical v1.4 facts only. Transport/hidden fields are never retained or hashed. */
export interface EOndirisFacts {
  bin: string;
  registrationNumber: string;
  legalName: string | null;
  placeName: string | null;
  productionAddress: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  productName: string | null;
  productionCapacity: string | null;
  tnVedCode: string | null;
  kpvedCode: string | null;
  kpvedName: string | null;
  enstruCode: string | null;
  enstruName: string | null;
  inCountryValueShare: string | null;
  includedOn: string | null;
  active: boolean | null;
}

export interface EOndirisNormalizedRecord {
  facts: EOndirisFacts;
  contentHash: string;
}

export type EOndirisIssueCode =
  | 'object_required'
  | 'string_required'
  | 'identifier_format'
  | 'bin_check_digit'
  | 'decimal_format'
  | 'percentage_range'
  | 'date_format'
  | 'boolean_required'
  | 'scope_mismatch'
  | 'conflicting_registration'
  | 'rows_required'
  | 'capture_too_large';
/** Safe quarantine metadata: no rejected values, raw rows, company names, or contact details. */
export interface EOndirisIssue {
  row: number | null;
  field: string;
  code: EOndirisIssueCode;
}
export type EOndirisParseResult =
  { kind: 'valid'; records: EOndirisNormalizedRecord[] } | { kind: 'quarantined'; issues: EOndirisIssue[] };

const fields = {
  legalName: 'company_name',
  placeName: 'region_kato',
  productionAddress: 'production_address',
  website: 'website',
  phone: 'phone',
  email: 'email',
  productName: 'product_name',
  productionCapacity: 'production_capacity',
  kpvedCode: 'kpved_code',
  kpvedName: 'kpved_name',
  enstruCode: 'enstru_code',
  enstruName: 'enstru_name',
} as const;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Stable field ordering; never hash a caller's object insertion order. */
export function eOndirisContentHash(f: EOndirisFacts): string {
  return digest([
    'e-ondiris-facts-v1',
    f.bin,
    f.registrationNumber,
    f.legalName,
    f.placeName,
    f.productionAddress,
    f.website,
    f.phone,
    f.email,
    f.productName,
    f.productionCapacity,
    f.tnVedCode,
    f.kpvedCode,
    f.kpvedName,
    f.enstruCode,
    f.enstruName,
    f.inCountryValueShare,
    f.includedOn,
    f.active,
  ]);
}

export function eOndirisScopeHash(records: readonly EOndirisNormalizedRecord[]): string {
  return digest([
    'e-ondiris-scope-v1',
    [...records]
      .sort((a, b) => a.facts.registrationNumber.localeCompare(b.facts.registrationNumber, 'en'))
      .map((r) => [r.facts.registrationNumber, r.contentHash]),
  ]);
}

/** Only verified field names from E-Ondiris_Field_Reference.docx. No positional mappings. */
export function parseEOndirisRows(input: unknown, scopeBin: string, maxRows = 25_000): EOndirisParseResult {
  const issues: EOndirisIssue[] = [];
  if (!Array.isArray(input))
    return { kind: 'quarantined', issues: [{ row: null, field: 'data', code: 'rows_required' }] };
  if (input.length > maxRows)
    return { kind: 'quarantined', issues: [{ row: null, field: 'data', code: 'capture_too_large' }] };
  const records = new Map<string, EOndirisNormalizedRecord>();
  Array.from(input).forEach((raw: unknown, row) => {
    const startIssues = issues.length;
    const fail = (field: string, code: EOndirisIssueCode) => {
      issues.push({ row, field, code });
    };
    if (!object(raw)) {
      fail('data', 'object_required');
      return;
    }
    const optionalText = (field: string): string | null => {
      const value = raw[field];
      if (value === null || value === undefined) return null;
      if (typeof value !== 'string') {
        fail(field, 'string_required');
        return null;
      }
      return value.trim() || null;
    };
    const identifier = (field: string, pattern: RegExp, required: boolean): string | null => {
      const value = optionalText(field);
      if (value === null) {
        if (required && (raw[field] === null || raw[field] === undefined || typeof raw[field] === 'string'))
          fail(field, 'identifier_format');
        return null;
      }
      if (!pattern.test(value)) {
        fail(field, 'identifier_format');
        return null;
      }
      return value;
    };
    const bin = identifier('bin_iin', /^\d{12}$/, true);
    const registrationNumber = identifier('registration_number', /^\d+$/, true);
    if (bin !== null && !checkBin(bin).valid) fail('bin_iin', 'bin_check_digit');
    else if (bin !== null && bin !== scopeBin) fail('bin_iin', 'scope_mismatch');
    const texts = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, optionalText(field)])) as Pick<
      EOndirisFacts,
      keyof typeof fields
    >;
    const tnVedCode = identifier('tnved_code_10', /^\d{10}$/, false);
    const decimal = optionalText('dvc_percent');
    let inCountryValueShare: string | null = null;
    if (decimal !== null) {
      if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) fail('dvc_percent', 'decimal_format');
      else {
        const [whole = '', fraction = ''] = decimal.split('.');
        const significantWhole = whole.replace(/^0+/, '') || '0';
        // Avoid unbounded BigInt conversion for an invalid transport number.
        const hundredths =
          significantWhole.length > 3 ? 10_001n : BigInt(significantWhole) * 100n + BigInt(fraction.padEnd(2, '0'));
        if (hundredths > 10_000n) fail('dvc_percent', 'percentage_range');
        else inCountryValueShare = `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`;
      }
    }
    const includedOn = optionalText('registry_inclusion_date');
    if (
      includedOn !== null &&
      (includedOn.startsWith('0000-') ||
        !/^\d{4}-\d{2}-\d{2}$/.test(includedOn) ||
        !Number.isFinite(Date.parse(`${includedOn}T00:00:00.000Z`)) ||
        new Date(`${includedOn}T00:00:00.000Z`).toISOString().slice(0, 10) !== includedOn)
    )
      fail('registry_inclusion_date', 'date_format');
    const active = raw.is_active === null || raw.is_active === undefined ? null : raw.is_active;
    if (active !== null && typeof active !== 'boolean') fail('is_active', 'boolean_required');
    if (issues.length !== startIssues || bin === null || registrationNumber === null) return;
    const facts: EOndirisFacts = {
      bin,
      registrationNumber,
      ...texts,
      tnVedCode,
      inCountryValueShare,
      includedOn,
      active: active as boolean | null,
    };
    const normalized = { facts, contentHash: eOndirisContentHash(facts) };
    const previous = records.get(registrationNumber);
    if (previous && previous.contentHash !== normalized.contentHash)
      fail('registration_number', 'conflicting_registration');
    else records.set(registrationNumber, normalized);
  });
  return issues.length > 0
    ? { kind: 'quarantined', issues }
    : {
        kind: 'valid',
        records: [...records.values()].sort((a, b) =>
          a.facts.registrationNumber.localeCompare(b.facts.registrationNumber, 'en'),
        ),
      };
}

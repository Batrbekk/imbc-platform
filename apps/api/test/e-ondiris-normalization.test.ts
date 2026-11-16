import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  RecordedEOndirisConnector,
  UnconfiguredEOndirisConnector,
  validateEOndirisCapture,
  validateEOndirisFeed,
  type EOndirisCaptureMetadata,
} from '../src/modules/e-ondiris/capture.js';
import { eOndirisContentHash, eOndirisScopeHash, parseEOndirisRows } from '../src/modules/e-ondiris/normalization.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/e-ondiris/synthetic-capture.json', import.meta.url), 'utf8'),
) as { metadata: EOndirisCaptureMetadata; rows: Record<string, unknown>[] };
const row = () => structuredClone(fixture.rows[0]!);
const parse = (rows: unknown) => parseEOndirisRows(rows, fixture.metadata.bin);

describe('e-Ondiris canonical field projection', () => {
  it('preserves leading zeros, source spellings, place name and capacity units; normalizes decimal exactly', () => {
    const result = parse(fixture.rows);
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') throw new Error('Invalid fixture');
    expect(result.records[0]!.facts).toMatchObject({
      bin: '000000000010',
      registrationNumber: '000027',
      tnVedCode: '0101000000',
      productName: 'Синтетическая деталь',
      placeName: 'Synthetic place name',
      productionAddress: 'Synthetic local site 1',
      productionCapacity: '1 200 tonnes / year (source unit)',
      inCountryValueShare: '30.50',
    });
    expect(result.records[1]!.facts).toMatchObject({ website: null, inCountryValueShare: '0.00', active: false });
  });
  it('retains only the 18 canonical fields; excluded fields neither persist nor change content hash', () => {
    const first = parse([row()]);
    const changed = row();
    for (const field of [
      'product_code',
      'agsk3_code',
      'agsk3_name',
      'comment',
      'data_source',
      'ntin',
      'localization_level',
      'oked_codes',
      'oked_names',
    ])
      changed[field] = 'different excluded data';
    const second = parse([changed]);
    expect(first).toEqual(second);
    if (first.kind !== 'valid') throw new Error('Invalid fixture');
    expect(Object.keys(first.records[0]!.facts)).toHaveLength(18);
    expect(JSON.stringify(first)).not.toContain('Excluded');
  });
  it('content hashing is independent of property and input row order', () => {
    const forward = parse(fixture.rows),
      backward = parse([...fixture.rows].reverse());
    expect(forward).toEqual(backward);
    if (forward.kind !== 'valid') throw new Error('Invalid fixture');
    const facts = forward.records[0]!.facts;
    const reversed = Object.fromEntries(Object.entries(facts).reverse()) as typeof facts;
    expect(eOndirisContentHash(facts)).toBe(eOndirisContentHash(reversed));
    expect(eOndirisScopeHash(forward.records)).toBe(eOndirisScopeHash([...forward.records].reverse()));
  });
  it('equivalent decimal and outer whitespace produce the same normalized version', () => {
    const changed = row();
    changed.dvc_percent = '030.50';
    changed.product_name = `  ${String(changed.product_name)}  `;
    expect(parse([changed])).toEqual(parse([row()]));
  });
  it('retained fact changes create another hash without changing registry identity', () => {
    const changed = row();
    changed.production_capacity = '1 400 tonnes / year (source unit)';
    const before = parse([row()]),
      after = parse([changed]);
    if (before.kind !== 'valid' || after.kind !== 'valid') throw new Error('Invalid fixture');
    expect(after.records[0]!.contentHash).not.toBe(before.records[0]!.contentHash);
    expect(after.records[0]!.facts.registrationNumber).toBe(before.records[0]!.facts.registrationNumber);
  });
  it('collapses exact duplicate records but quarantines conflicting same-registration rows', () => {
    const exact = parse([row(), row()]);
    expect(exact.kind === 'valid' && exact.records.length).toBe(1);
    const changed = row();
    changed.is_active = false;
    expect(parse([row(), changed])).toMatchObject({
      kind: 'quarantined',
      issues: [{ code: 'conflicting_registration' }],
    });
  });
  it.each([
    ['bin_iin', 10, 'string_required'],
    ['bin_iin', '00000000001', 'identifier_format'],
    ['bin_iin', '000000000011', 'bin_check_digit'],
    ['bin_iin', '000 000000010', 'identifier_format'],
    ['bin_iin', '000000000000', 'scope_mismatch'],
    ['registration_number', 27, 'string_required'],
    ['registration_number', '27A', 'identifier_format'],
    ['registration_number', '', 'identifier_format'],
    ['tnved_code_10', 101000000, 'string_required'],
    ['tnved_code_10', '010100000', 'identifier_format'],
    ['kpved_code', 1100, 'string_required'],
    ['is_active', 'true', 'boolean_required'],
    ['dvc_percent', '1.234', 'decimal_format'],
    ['dvc_percent', '100.01', 'percentage_range'],
    ['dvc_percent', '-1', 'decimal_format'],
    ['dvc_percent', 'NaN', 'decimal_format'],
    ['dvc_percent', '1e2', 'decimal_format'],
    ['dvc_percent', '30,5', 'decimal_format'],
    ['dvc_percent', 30.5, 'string_required'],
    ['registry_inclusion_date', '2026-02-30', 'date_format'],
    ['registry_inclusion_date', '12.11.2026', 'date_format'],
    ['registry_inclusion_date', '2026-13-01', 'date_format'],
  ])('quarantines malformed %s without coercing/lossy rounding', (field, value, code) => {
    const raw = row();
    raw[field] = value;
    const result = parse([raw]);
    expect(result).toMatchObject({ kind: 'quarantined', issues: [{ row: 0, field, code }] });
    expect(JSON.stringify(result)).not.toContain('Synthetic Local Factory');
    expect(result).not.toHaveProperty('records');
  });
  it('a malformed row quarantines the entire observed BIN scope, including otherwise valid rows', () => {
    const bad = row();
    bad.registration_number = 42;
    expect(parse([fixture.rows[1], bad])).not.toHaveProperty('records');
  });
  it.each(['0', '0.00', '100', '100.00'])('accepts bounded percentage %s', (value) => {
    const raw = row();
    raw.dvc_percent = value;
    expect(parse([raw]).kind).toBe('valid');
  });
  it('accepts nullable source facts without fabricating a product name, date, status, or code', () => {
    const result = parse([{ bin_iin: fixture.metadata.bin, registration_number: '01' }]);
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') throw new Error('Invalid fixture');
    expect(result.records[0]!.facts).toMatchObject({
      productName: null,
      tnVedCode: null,
      active: null,
      includedOn: null,
    });
  });
  it('rejects a non-array or oversized capture instead of allocating per-row work', () => {
    expect(parse({})).toMatchObject({ kind: 'quarantined', issues: [{ code: 'rows_required' }] });
    expect(parseEOndirisRows(new Array(2), fixture.metadata.bin, 1)).toMatchObject({
      kind: 'quarantined',
      issues: [{ code: 'capture_too_large' }],
    });
    expect(parse(new Array(1))).toMatchObject({ kind: 'quarantined', issues: [{ code: 'object_required' }] });
  });
});

describe('e-Ondiris connector capture contract', () => {
  it('retains approved connector observation metadata across retries', () => {
    const a = validateEOndirisCapture(fixture.rows, fixture.metadata);
    const b = validateEOndirisCapture(fixture.rows, fixture.metadata);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      kind: 'received',
      capture: { observedAt: new Date(fixture.metadata.observedAt), provenance: 'synthetic' },
    });
  });
  it('rejects page/per-row capture metadata rather than replacing the whole-BIN watermark', () => {
    expect(() => validateEOndirisCapture(fixture.rows, { ...fixture.metadata, coverage: 'one_page' as never })).toThrow(
      'Incomplete',
    );
  });
  it('groups nonadjacent registrations for the same BIN before accepting any scope', () => {
    const rows = [fixture.rows[0], { ...fixture.rows[0], bin_iin: '000000000000' }, fixture.rows[1]];
    const result = validateEOndirisFeed(rows, { ...fixture.metadata, coverage: 'all_observed_feed_rows' });
    expect(result.kind).toBe('received');
    if (result.kind !== 'received') throw new Error('Invalid feed fixture');
    expect(result.captures.map((r) => [r.bin, r.records.length])).toEqual([
      ['000000000000', 1],
      ['000000000010', 2],
    ]);
  });
  it('quarantines a malformed feed with original row indexes and exposes no partially accepted BIN scopes', () => {
    const rows = [
      fixture.rows[0],
      { ...fixture.rows[0], bin_iin: 10 },
      { ...fixture.rows[1], tnved_code_10: 101000000 },
    ];
    const result = validateEOndirisFeed(rows, { ...fixture.metadata, coverage: 'all_observed_feed_rows' });
    expect(result).toMatchObject({
      kind: 'quarantined',
      issues: [
        { row: 1, field: 'bin_iin' },
        { row: 2, field: 'tnved_code_10' },
      ],
    });
    expect(result).not.toHaveProperty('captures');
  });
  it.each(['2026-02-30T10:30:00.000Z', '2026-11-14', '2026-11-14T10:30:00+06:00', 'not-a-time'])(
    'rejects unapproved/noncanonical observation time %s',
    (observedAt) => {
      expect(() => validateEOndirisCapture(fixture.rows, { ...fixture.metadata, observedAt })).toThrow(
        'observation time',
      );
    },
  );
  it('returns unavailable explicitly without a finding, empty-success scope or fabricated watermark', async () => {
    expect(await new UnconfiguredEOndirisConnector().pull('000000000010')).toEqual({
      kind: 'unavailable',
      reason: 'access_not_configured',
    });
    expect(await new RecordedEOndirisConnector(async () => null).pull('000000000010')).toEqual({
      kind: 'unavailable',
      reason: 'no_response',
    });
  });
  it('loads and validates a recorded response without a network request', async () => {
    const connector = new RecordedEOndirisConnector(async () => ({ rows: fixture.rows, metadata: fixture.metadata }));
    expect(await connector.pull(fixture.metadata.bin)).toMatchObject({ kind: 'received' });
    const controller = new AbortController();
    controller.abort();
    expect(await connector.pull(fixture.metadata.bin, controller.signal)).toMatchObject({ kind: 'unavailable' });
  });
});

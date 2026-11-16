import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  validateEOndirisCapture,
  type EOndirisCapture,
  type EOndirisCaptureMetadata,
} from '../src/modules/e-ondiris/capture.js';
import { EOndirisSnapshotStore, EOndirisStorageError } from '../src/modules/e-ondiris/ingestion.js';
import { eOndirisContentHash, eOndirisScopeHash } from '../src/modules/e-ondiris/normalization.js';

// Deliberately independent of TEST_DATABASE_URL and all profile/NDA/browser test ports.
const connectionString = process.env.EONDIRIS_TEST_DATABASE_URL;
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/e-ondiris/synthetic-capture.json', import.meta.url), 'utf8'),
) as { metadata: EOndirisCaptureMetadata; rows: Record<string, unknown>[] };
const bin = fixture.metadata.bin;
function capture(rows: unknown = fixture.rows, observedAt = fixture.metadata.observedAt): EOndirisCapture {
  const result = validateEOndirisCapture(rows, { ...fixture.metadata, observedAt });
  if (result.kind !== 'received') throw new Error('Invalid test fixture');
  return result.capture;
}
const rowsWithCapacity = (value: string) =>
  fixture.rows.map((r, i) => (i === 0 ? { ...r, production_capacity: value } : { ...r }));

describe.skipIf(!connectionString)('e-Ondiris immutable local copy: PostgreSQL 18', () => {
  let pool: pg.Pool;
  let store: EOndirisSnapshotStore;
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55435' ||
      url.pathname !== '/imbc_eondiris_test'
    )
      throw new Error('EONDIRIS_TEST_DATABASE_URL must target isolated localhost:55435/imbc_eondiris_test');
    pool = new pg.Pool({ connectionString, max: 6 });
    store = new EOndirisSnapshotStore(pool, { allowSynthetic: true });
  });
  beforeEach(async () => {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
    await pool.query(readFileSync(new URL('../src/modules/e-ondiris/storage-expand.sql', import.meta.url), 'utf8'));
    // The shared audit shape is enough to verify atomic journal integration; no profile graph is created here.
    await pool.query(`CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT uuidv7(), user_id uuid, organization_id uuid,
      action text NOT NULL, object_type text NOT NULL, object_id text, diff jsonb)`);
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('ingests all products for a BIN atomically and preserves the first observation time and canonical date', async () => {
    expect(await store.ingest(capture())).toMatchObject({
      kind: 'accepted',
      inserted: 2,
      changed: [
        { registrationNumber: '000027', beforeId: null },
        { registrationNumber: '000028', beforeId: null },
      ],
    });
    const current = await store.current(bin);
    expect(current).toHaveLength(2);
    expect(current[0]).toMatchObject({
      pulledAt: new Date(fixture.metadata.observedAt),
      facts: { includedOn: '2026-11-12', bin, tnVedCode: '0101000000', inCountryValueShare: '30.50' },
    });
    const audit = (await pool.query('SELECT * FROM audit_entries')).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      user_id: null,
      action: 'e_ondiris.scope.accepted',
      diff: { actor: 'system', provider: 'e-ondiris', provenance: 'synthetic' },
    });
    expect(JSON.stringify(audit)).not.toContain('Excluded');
    expect(
      (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', ['e_ondiris_record']))
        .rows,
    ).toHaveLength(22);
  });
  it('rejects synthetic captures by default before opening a transaction', async () => {
    await expect(new EOndirisSnapshotStore(pool).ingest(capture())).rejects.toThrow('Synthetic');
    expect(await store.current(bin)).toHaveLength(0);
  });
  it('same observation/hash is a no-op replay with stable IDs, timestamps, watermark, audit and outbox callback', async () => {
    const outbox = vi.fn(async () => {});
    await store.ingest(capture(), undefined, outbox);
    const first = await store.current(bin);
    expect(await store.ingest(capture(), undefined, outbox)).toEqual({ kind: 'replay', bin });
    expect(await store.current(bin)).toEqual(first);
    expect(outbox).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM audit_entries')).rows[0].count).toBe(1);
  });
  it('new observation with unchanged facts advances scope metadata without rewriting immutable timestamps or IDs', async () => {
    await store.ingest(capture());
    const before = await store.current(bin);
    expect(await store.ingest(capture(fixture.rows, '2026-11-15T10:30:00.000Z'))).toEqual({
      kind: 'accepted',
      bin,
      inserted: 0,
      changed: [],
    });
    expect(await store.current(bin)).toEqual(before);
    expect(
      (await pool.query('SELECT accepted_observed_at FROM e_ondiris_sync_scope')).rows[0].accepted_observed_at,
    ).toEqual(new Date('2026-11-15T10:30:00.000Z'));
  });
  it('equal observation with different whole-BIN hash conflicts without partially replacing another registration', async () => {
    await store.ingest(capture());
    const before = await store.current(bin);
    expect(await store.ingest(capture(rowsWithCapacity('Conflicting capacity')))).toEqual({ kind: 'conflict', bin });
    expect(await store.current(bin)).toEqual(before);
    expect((await pool.query('SELECT count(*)::int AS count FROM e_ondiris_record')).rows[0].count).toBe(2);
  });
  it('an old event after B cannot rewind current pointers or watermark', async () => {
    await store.ingest(capture());
    await store.ingest(capture(rowsWithCapacity('B capacity'), '2026-11-15T10:30:00.000Z'));
    const before = await store.current(bin);
    expect(await store.ingest(capture())).toEqual({ kind: 'stale', bin });
    expect(await store.current(bin)).toEqual(before);
  });
  it('A→B→A at newer approved observations reactivates the original immutable version and timestamp', async () => {
    await store.ingest(capture());
    const original = await store.current(bin);
    await store.ingest(capture(rowsWithCapacity('B capacity'), '2026-11-15T10:30:00.000Z'));
    expect((await store.current(bin))[0]!.id).not.toBe(original[0]!.id);
    expect(await store.ingest(capture(fixture.rows, '2026-11-16T10:30:00.000Z'))).toMatchObject({
      kind: 'accepted',
      inserted: 0,
      changed: [{ afterId: original[0]!.id }],
    });
    expect(await store.current(bin)).toEqual(original);
    expect((await pool.query('SELECT count(*)::int AS count FROM e_ondiris_record')).rows[0].count).toBe(3);
  });
  it('a missing registration or empty observed feed never deletes/deactivates accepted source facts', async () => {
    await store.ingest(capture());
    const before = await store.current(bin);
    await store.ingest(capture([fixture.rows[0]], '2026-11-15T10:30:00.000Z'));
    await store.ingest(capture([], '2026-11-16T10:30:00.000Z'));
    expect(await store.current(bin)).toEqual(before);
  });
  it('explicit inactive is a new source snapshot while a frozen ID still resolves its original active facts', async () => {
    await store.ingest(capture());
    const frozen = (await store.current(bin))[0]!;
    const changed = fixture.rows.map((r, i) => (i === 0 ? { ...r, is_active: false } : r));
    await store.ingest(capture(changed, '2026-11-15T10:30:00.000Z'));
    expect((await store.current(bin))[0]!.facts.active).toBe(false);
    expect(
      (await pool.query('SELECT active, is_current FROM e_ondiris_record WHERE id=$1', [frozen.id])).rows[0],
    ).toEqual({ active: true, is_current: false });
  });
  it('concurrent first arrivals produce one accepted whole-BIN scope and one replay', async () => {
    const results = await Promise.all([store.ingest(capture()), store.ingest(capture())]);
    expect(results.map((r) => r.kind).sort()).toEqual(['accepted', 'replay']);
    expect(await store.current(bin)).toHaveLength(2);
    expect((await pool.query('SELECT count(*)::int AS count FROM audit_entries')).rows[0].count).toBe(1);
  });
  it('concurrent unequal events converge on the newest approved observation', async () => {
    await Promise.all([
      store.ingest(capture()),
      store.ingest(capture(rowsWithCapacity('Newest capacity'), '2026-11-15T10:30:00.000Z')),
    ]);
    expect((await store.current(bin))[0]!.facts.productionCapacity).toBe('Newest capacity');
    expect(
      (await pool.query('SELECT accepted_observed_at FROM e_ondiris_sync_scope')).rows[0].accepted_observed_at,
    ).toEqual(new Date('2026-11-15T10:30:00.000Z'));
  });
  it('a callback/outbox failure rolls back snapshots, pointer, watermark and audit and exposes no raw row error', async () => {
    const result = store.ingest(capture(), undefined, async () => {
      throw new Error('Business values must not leak');
    });
    await expect(result).rejects.toBeInstanceOf(EOndirisStorageError);
    expect(await store.current(bin)).toHaveLength(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM e_ondiris_sync_scope')).rows[0].count).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS count FROM audit_entries')).rows[0].count).toBe(0);
  });
  it('immutable source facts, first observation timestamp, deletes and truncates are protected even from table owner', async () => {
    await store.ingest(capture());
    for (const sql of [
      "UPDATE e_ondiris_record SET product_name='Changed'",
      'UPDATE e_ondiris_record SET pulled_at=now()',
      'DELETE FROM e_ondiris_record',
      'TRUNCATE e_ondiris_record',
    ])
      await expect(pool.query(sql)).rejects.toMatchObject({ code: '23514' });
    expect(await store.current(bin)).toHaveLength(2);
  });
  it('rejects forged lossy normalized facts and mismatched hashes without touching current state', async () => {
    const forged = capture();
    forged.records[0]!.facts.inCountryValueShare = '1.234';
    forged.records[0]!.contentHash = eOndirisContentHash(forged.records[0]!.facts);
    forged.scopeHash = eOndirisScopeHash(forged.records);
    await expect(store.ingest(forged)).rejects.toThrow('Invalid normalized');
    expect(await store.current(bin)).toHaveLength(0);
  });
  it('does not mix synthetic and approved provider/recorded captures for a BIN', async () => {
    await store.ingest(capture());
    const recorded = capture(fixture.rows, '2026-11-15T10:30:00.000Z');
    recorded.provenance = 'recorded';
    expect(await store.ingest(recorded)).toEqual({ kind: 'provenance_conflict', bin });
  });
  it('maps 1001 registry rows in batches without loss or bind-parameter overflow', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      ...fixture.rows[0],
      registration_number: String(i).padStart(6, '0'),
    }));
    const result = await store.ingest(capture(rows));
    expect(result).toMatchObject({ kind: 'accepted', inserted: 1001 });
    expect(await store.current(bin)).toHaveLength(1001);
    expect(await store.ingest(capture(rows))).toEqual({ kind: 'replay', bin });
  });
  it('an invalid numeric BIN/TN row is quarantined before any scope can reach the database', async () => {
    const bad = { ...fixture.rows[0], bin_iin: 10, tnved_code_10: 101000000 };
    const result = validateEOndirisCapture([fixture.rows[1], bad], fixture.metadata);
    expect(result).toMatchObject({ kind: 'quarantined' });
    expect(result).not.toHaveProperty('capture');
    expect(await store.current(bin)).toHaveLength(0);
  });
});

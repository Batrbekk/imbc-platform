import type pg from 'pg';
import { checkBin } from '@imbc/contracts';
import type { EOndirisCapture } from './capture.js';
import { eOndirisContentHash, eOndirisScopeHash, parseEOndirisRows, type EOndirisFacts } from './normalization.js';

export interface EOndirisSnapshot {
  id: string;
  facts: EOndirisFacts;
  contentHash: string;
  pulledAt: Date;
  isCurrent: boolean;
}
export interface EOndirisActor {
  userId: string | null;
  organizationId: string | null;
}
export type EOndirisIngestionResult =
  | {
      kind: 'accepted';
      bin: string;
      changed: { registrationNumber: string; beforeId: string | null; afterId: string }[];
      inserted: number;
    }
  | { kind: 'replay' | 'stale' | 'conflict' | 'provenance_conflict'; bin: string };
type State = { accepted_observed_at: Date; accepted_scope_hash: string; provenance: string };

const columns = [
  'bin',
  'registration_number',
  'legal_name',
  'place_name',
  'production_address',
  'website',
  'phone',
  'email',
  'product_name',
  'production_capacity',
  'tn_ved_code',
  'kpved_code',
  'kpved_name',
  'enstru_code',
  'enstru_name',
  'in_country_value_share',
  'included_on',
  'active',
  'content_hash',
  'pulled_at',
  'is_current',
] as const;
function values(f: EOndirisFacts, hash: string, observedAt: Date): unknown[] {
  return [
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
    hash,
    observedAt,
    false,
  ];
}
type Stored = Record<(typeof columns)[number], unknown> & {
  id: string;
  bin: string;
  registration_number: string;
  content_hash: string;
  pulled_at: Date;
  is_current: boolean;
};
const facts = (r: Stored): EOndirisFacts => ({
  bin: r.bin,
  registrationNumber: r.registration_number,
  legalName: r.legal_name as string | null,
  placeName: r.place_name as string | null,
  productionAddress: r.production_address as string | null,
  website: r.website as string | null,
  phone: r.phone as string | null,
  email: r.email as string | null,
  productName: r.product_name as string | null,
  productionCapacity: r.production_capacity as string | null,
  tnVedCode: r.tn_ved_code as string | null,
  kpvedCode: r.kpved_code as string | null,
  kpvedName: r.kpved_name as string | null,
  enstruCode: r.enstru_code as string | null,
  enstruName: r.enstru_name as string | null,
  inCountryValueShare: r.in_country_value_share as string | null,
  includedOn:
    r.included_on instanceof Date ? r.included_on.toISOString().slice(0, 10) : (r.included_on as string | null),
  active: r.active as boolean | null,
});
const chunks = <T>(rows: readonly T[], size = 1000): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
};

export class EOndirisStorageError extends Error {
  constructor(readonly databaseCode: string | null) {
    super('e-Ondiris storage transaction failed');
    this.name = 'EOndirisStorageError';
  }
}

function validateNormalized(capture: EOndirisCapture): boolean {
  if (
    typeof capture.bin !== 'string' ||
    !/^\d{12}$/.test(capture.bin) ||
    !checkBin(capture.bin).valid ||
    !['synthetic', 'recorded', 'provider'].includes(capture.provenance)
  )
    return false;
  const parsed = parseEOndirisRows(
    capture.records.map(({ facts: f }) => ({
      bin_iin: f.bin,
      registration_number: f.registrationNumber,
      company_name: f.legalName,
      region_kato: f.placeName,
      production_address: f.productionAddress,
      website: f.website,
      phone: f.phone,
      email: f.email,
      product_name: f.productName,
      production_capacity: f.productionCapacity,
      tnved_code_10: f.tnVedCode,
      kpved_code: f.kpvedCode,
      kpved_name: f.kpvedName,
      enstru_code: f.enstruCode,
      enstru_name: f.enstruName,
      dvc_percent: f.inCountryValueShare,
      registry_inclusion_date: f.includedOn,
      is_active: f.active,
    })),
    capture.bin,
  );
  return (
    parsed.kind === 'valid' &&
    parsed.records.length === capture.records.length &&
    eOndirisScopeHash(parsed.records) === capture.scopeHash
  );
}

/** One accepted capture represents ALL observed rows for a BIN, never one page or one registration. */
export class EOndirisSnapshotStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly options: { allowSynthetic?: boolean } = {},
  ) {}

  async current(bin: string): Promise<EOndirisSnapshot[]> {
    const result = await this.pool.query<Stored>(
      'SELECT r.*, r.included_on::text AS included_on FROM e_ondiris_record r WHERE bin=$1 AND is_current ORDER BY registration_number',
      [bin],
    );
    return result.rows.map((r) => ({
      id: r.id,
      facts: facts(r),
      contentHash: r.content_hash,
      pulledAt: r.pulled_at,
      isCurrent: r.is_current,
    }));
  }

  /** Own transaction. The callback may atomically write an outbox, but ingestion never publishes or edits a profile. */
  async ingest(
    input: EOndirisCapture,
    actor: EOndirisActor = { userId: null, organizationId: null },
    accepted?: (client: pg.PoolClient, result: Extract<EOndirisIngestionResult, { kind: 'accepted' }>) => Promise<void>,
  ): Promise<EOndirisIngestionResult> {
    // The caller cannot alter a validated payload while this asynchronous transaction waits for a lock.
    const capture = structuredClone(input);
    if (capture.provenance === 'synthetic' && !this.options.allowSynthetic)
      throw new Error('Synthetic e-Ondiris capture is disabled');
    if (
      capture.provider !== 'e-ondiris' ||
      capture.coverage !== 'all_observed_bin_rows' ||
      !(capture.observedAt instanceof Date) ||
      !Number.isFinite(capture.observedAt.getTime()) ||
      capture.records.some((r) => r.facts.bin !== capture.bin || r.contentHash !== eOndirisContentHash(r.facts)) ||
      capture.scopeHash !== eOndirisScopeHash(capture.records) ||
      new Set(capture.records.map((r) => r.facts.registrationNumber)).size !== capture.records.length ||
      !validateNormalized(capture)
    )
      throw new Error('Invalid normalized e-Ondiris capture');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize a BIN including its first insert (a missing watermark has no row to lock).
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('e-ondiris:bin:' || $1, 0))", [capture.bin]);
      const state = (
        await client.query<State>('SELECT * FROM e_ondiris_sync_scope WHERE bin=$1 FOR UPDATE', [capture.bin])
      ).rows[0];
      let rejected: Exclude<EOndirisIngestionResult['kind'], 'accepted'> | null = null;
      if (state?.provenance !== undefined && state.provenance !== capture.provenance) rejected = 'provenance_conflict';
      else if (state && state.accepted_observed_at.getTime() > capture.observedAt.getTime()) rejected = 'stale';
      else if (state && state.accepted_observed_at.getTime() === capture.observedAt.getTime())
        rejected = state.accepted_scope_hash === capture.scopeHash ? 'replay' : 'conflict';
      if (rejected !== null) {
        await client.query('COMMIT');
        return { kind: rejected, bin: capture.bin };
      }
      const current = (
        await client.query<Stored>('SELECT * FROM e_ondiris_record WHERE bin=$1 AND is_current FOR UPDATE', [
          capture.bin,
        ])
      ).rows;
      const old = new Map(current.map((r) => [r.registration_number, r]));
      // Parameter count stays below PostgreSQL's 65,535 limit; neither N+1 reads nor per-row writes.
      let inserted = 0;
      for (const batch of chunks(capture.records)) {
        const params = batch.flatMap((r) => values(r.facts, r.contentHash, capture.observedAt));
        const tuples = batch
          .map((_, i) => `(${columns.map((__, j) => `$${i * columns.length + j + 1}`).join(',')})`)
          .join(',');
        const result = await client.query(
          `INSERT INTO e_ondiris_record (${columns.join(',')}) VALUES ${tuples}
          ON CONFLICT (bin, registration_number, content_hash) DO NOTHING`,
          params,
        );
        inserted += result.rowCount ?? 0;
      }
      const chosen = new Map<string, Stored>();
      for (const batch of chunks(capture.records)) {
        const keys = batch.map((r) => ({ registration: r.facts.registrationNumber, hash: r.contentHash }));
        const selected = await client.query<Stored>(
          `SELECT r.*, r.included_on::text AS included_on FROM e_ondiris_record r JOIN
          jsonb_to_recordset($2::jsonb) AS k(registration text, hash text)
          ON r.registration_number=k.registration AND r.content_hash=k.hash WHERE r.bin=$1`,
          [capture.bin, JSON.stringify(keys)],
        );
        for (const r of selected.rows) chosen.set(r.registration_number, r);
      }
      const changed = capture.records.flatMap((r) => {
        const next = chosen.get(r.facts.registrationNumber);
        if (!next) throw new Error('Missing immutable e-Ondiris version');
        const before = old.get(r.facts.registrationNumber);
        return before?.id === next.id
          ? []
          : [{ registrationNumber: r.facts.registrationNumber, beforeId: before?.id ?? null, afterId: next.id }];
      });
      for (const batch of chunks(changed)) {
        await client.query(
          'UPDATE e_ondiris_record SET is_current=false WHERE bin=$1 AND registration_number=ANY($2::text[]) AND is_current',
          [capture.bin, batch.map((r) => r.registrationNumber)],
        );
        await client.query('UPDATE e_ondiris_record SET is_current=true WHERE id=ANY($1::uuid[])', [
          batch.map((r) => r.afterId),
        ]);
      }
      // Missing records are retained. No completeness/absence inference, deletion, or invented inactive state.
      await client.query(
        `INSERT INTO e_ondiris_sync_scope(bin, accepted_observed_at, accepted_scope_hash, provenance) VALUES($1,$2,$3,$4)
        ON CONFLICT(bin) DO UPDATE SET accepted_observed_at=EXCLUDED.accepted_observed_at, accepted_scope_hash=EXCLUDED.accepted_scope_hash`,
        [capture.bin, capture.observedAt, capture.scopeHash, capture.provenance],
      );
      await client.query(
        `INSERT INTO audit_entries(user_id, organization_id, action, object_type, object_id, diff)
        VALUES($1,$2,'e_ondiris.scope.accepted','e_ondiris_sync_scope',$3,$4::jsonb)`,
        [
          actor.userId,
          actor.organizationId,
          capture.bin,
          JSON.stringify({
            actor: actor.userId ? 'user' : 'system',
            provider: 'e-ondiris',
            provenance: capture.provenance,
            before: state
              ? { observedAt: state.accepted_observed_at.toISOString(), scopeHash: state.accepted_scope_hash }
              : null,
            after: { observedAt: capture.observedAt.toISOString(), scopeHash: capture.scopeHash },
            changed,
            inserted,
          }),
        ],
      );
      const result: Extract<EOndirisIngestionResult, { kind: 'accepted' }> = {
        kind: 'accepted',
        bin: capture.bin,
        changed,
        inserted,
      };
      if (accepted) await accepted(client, result);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      // PostgreSQL error DETAIL can contain a business row. Never attach the raw error/cause.
      const code =
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[A-Z0-9]{5}$/.test(error.code)
          ? error.code
          : null;
      throw new EOndirisStorageError(code);
    } finally {
      client.release();
    }
  }
}

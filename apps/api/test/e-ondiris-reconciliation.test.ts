import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EOndirisSnapshot } from '../src/modules/e-ondiris/ingestion.js';
import { parseEOndirisRows } from '../src/modules/e-ondiris/normalization.js';
import {
  planEOndirisProducts,
  planEOndirisPrefill,
  adataLegalNameValue,
  type ExistingProductIdentity,
} from '../src/modules/e-ondiris/reconciliation.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/e-ondiris/synthetic-capture.json', import.meta.url), 'utf8'),
) as { rows: Record<string, unknown>[] };
const bin = '000000000010';
function snapshots(): EOndirisSnapshot[] {
  const parsed = parseEOndirisRows(fixture.rows, bin);
  if (parsed.kind !== 'valid') throw new Error('Invalid fixture');
  return parsed.records.map((r, i) => ({
    ...r,
    id: `snapshot-${i}`,
    pulledAt: new Date('2026-11-14T10:30:00.000Z'),
    isCurrent: true,
  }));
}
const manual = (overrides: Partial<ExistingProductIdentity> = {}): ExistingProductIdentity => ({
  identityId: 'manual-stable-identity',
  source: 'manual',
  registrationNumber: null,
  nameEn: 'Synthetic part',
  nameRu: '  СИНТЕТИЧЕСКАЯ   ДЕТАЛЬ  ',
  tnVedCode: '0101000000',
  productionSiteIdentityId: 'site-stable-identity',
  certificateIdentityIds: ['certificate-shared-1', 'certificate-shared-2'],
  manufacturerNote: 'Own local note',
  positionInList: 4,
  ...overrides,
});

describe('MAN-25 e-Ondiris source product reconciliation', () => {
  it('replaces a manual name+TN VED match with source facts while preserving identity/site/shared certificates/note/position', () => {
    const existing = [manual()];
    const before = structuredClone(existing);
    const plan = planEOndirisProducts(bin, existing, [snapshots()[0]!]);
    expect(plan).toMatchObject({
      kind: 'ready',
      untouchedIdentityIds: [],
      candidates: [
        {
          identityId: 'manual-stable-identity',
          replacedManual: true,
          productionSiteIdentityId: 'site-stable-identity',
          certificateIdentityIds: ['certificate-shared-1', 'certificate-shared-2'],
          manufacturerNote: 'Own local note',
          positionInList: 4,
          snapshot: { facts: { productName: 'Синтетическая деталь', inCountryValueShare: '30.50' } },
        },
      ],
    });
    expect(existing).toEqual(before);
  });
  it('matches the English alias with Unicode/case/whitespace equivalence without changing persisted source spelling', () => {
    const source = snapshots()[0]!;
    source.facts.productName = 'Ｓｙｎｔｈｅｔｉｃ  part';
    const plan = planEOndirisProducts(bin, [manual()], [source]);
    expect(plan).toMatchObject({
      kind: 'ready',
      candidates: [
        { identityId: 'manual-stable-identity', snapshot: { facts: { productName: 'Ｓｙｎｔｈｅｔｉｃ  part' } } },
      ],
    });
  });
  it('does not match by TN VED alone or name alone', () => {
    for (const existing of [manual({ nameEn: 'Different', nameRu: null }), manual({ tnVedCode: '0201000000' })])
      expect(planEOndirisProducts(bin, [existing], [snapshots()[0]!])).toMatchObject({
        kind: 'ready',
        untouchedIdentityIds: ['manual-stable-identity'],
        candidates: [{ identityId: null }],
      });
  });
  it('registry registration identity survives a source rename/code change and preserves local associations', () => {
    const existing = manual({
      source: 'e_ondiris',
      registrationNumber: '000027',
      nameEn: null,
      nameRu: 'Old name',
      tnVedCode: '9901000000',
    });
    expect(planEOndirisProducts(bin, [existing], [snapshots()[0]!])).toMatchObject({
      kind: 'ready',
      candidates: [
        {
          identityId: existing.identityId,
          replacedManual: false,
          productionSiteIdentityId: existing.productionSiteIdentityId,
        },
      ],
    });
  });
  it('retains multiple same-code registry records as distinct source facts', () => {
    const plan = planEOndirisProducts(bin, [], snapshots());
    expect(plan).toMatchObject({ kind: 'ready', candidates: [{ identityId: null }, { identityId: null }] });
    if (plan.kind !== 'ready') throw new Error('Unexpected ambiguity');
    expect(plan.candidates.map((r) => r.snapshot.facts.registrationNumber)).toEqual(['000027', '000028']);
    expect(plan.candidates.map((r) => r.positionInList)).toEqual([0, 1]);
  });
  it.each(['rename', 'code_change'] as const)(
    'blocks a registry %s colliding with a separate manual name+TN VED identity without a partial plan',
    (change) => {
      const registry = manual({
        identityId: 'registry-stable-identity',
        source: 'e_ondiris',
        registrationNumber: '000027',
        nameEn: null,
        nameRu: change === 'rename' ? 'Old registry name' : 'Синтетическая деталь',
        tnVedCode: change === 'code_change' ? '9901000000' : '0101000000',
      });
      const existing = [registry, manual()];
      const before = structuredClone(existing);
      const plan = planEOndirisProducts(bin, existing, [snapshots()[0]!]);
      expect(plan).toMatchObject({
        kind: 'ambiguous',
        issues: [
          {
            code: 'ambiguous_manual_match',
            registrationNumber: '000027',
            identityIds: ['registry-stable-identity', 'manual-stable-identity'],
          },
        ],
      });
      expect(plan).not.toHaveProperty('candidates');
      expect(existing).toEqual(before);
    },
  );
  it('never arbitrarily chooses between two manual matches', () => {
    const plan = planEOndirisProducts(bin, [manual(), manual({ identityId: 'another-manual' })], [snapshots()[0]!]);
    expect(plan).toMatchObject({
      kind: 'ambiguous',
      issues: [{ code: 'ambiguous_manual_match', identityIds: ['manual-stable-identity', 'another-manual'] }],
    });
    expect(plan).not.toHaveProperty('candidates');
  });
  it('one manual identity cannot be assigned to two same-name source registrations', () => {
    const source = snapshots();
    source[1]!.facts.productName = source[0]!.facts.productName;
    expect(planEOndirisProducts(bin, [manual()], source)).toMatchObject({
      kind: 'ambiguous',
      issues: [{ code: 'ambiguous_manual_match' }, { code: 'ambiguous_manual_match' }],
    });
  });
  it('fails deterministically on duplicated existing registry registrations, source registrations or stable identities', () => {
    expect(
      planEOndirisProducts(
        bin,
        [
          manual({ source: 'e_ondiris', registrationNumber: '000027' }),
          manual({ source: 'e_ondiris', registrationNumber: '000027', identityId: 'second' }),
        ],
        snapshots(),
      ),
    ).toMatchObject({ kind: 'ambiguous', issues: [{ code: 'duplicate_registration' }] });
    expect(planEOndirisProducts(bin, [], [snapshots()[0]!, snapshots()[0]!])).toMatchObject({
      kind: 'ambiguous',
      issues: [{ code: 'duplicate_registration' }],
    });
    expect(planEOndirisProducts(bin, [manual(), manual()], [])).toMatchObject({
      kind: 'ambiguous',
      issues: [{ code: 'duplicate_identity' }],
    });
  });
  it('rejects another BIN and does not create cross-organization source candidates', () => {
    expect(planEOndirisProducts('000000000000', [], snapshots())).toMatchObject({
      kind: 'ambiguous',
      issues: [{ code: 'scope_mismatch' }, { code: 'scope_mismatch' }],
    });
  });
  it('absence retains the registry product and an explicit inactive fact stays visible in a candidate', () => {
    const registry = manual({ source: 'e_ondiris', registrationNumber: '000027' });
    expect(planEOndirisProducts(bin, [registry], [])).toEqual({
      kind: 'ready',
      candidates: [],
      untouchedIdentityIds: [registry.identityId],
    });
    expect(planEOndirisProducts(bin, [], [snapshots()[1]!])).toMatchObject({
      kind: 'ready',
      candidates: [{ snapshot: { facts: { active: false } } }],
    });
  });
  it('registry rows with missing source fields remain readonly source facts without fabricated classification/name/capacity', () => {
    const source = snapshots()[0]!;
    source.facts.productName = null;
    source.facts.tnVedCode = null;
    source.facts.productionCapacity = null;
    expect(planEOndirisProducts(bin, [manual()], [source])).toMatchObject({
      kind: 'ready',
      candidates: [
        { identityId: null, snapshot: { facts: { productName: null, tnVedCode: null, productionCapacity: null } } },
      ],
    });
  });
});

describe('e-Ondiris profile source ownership planning', () => {
  it.each(['Own corrected contact', null])('preserves an explicit manufacturer edit/clear (%s)', (value) => {
    expect(planEOndirisPrefill({ value, owner: 'manufacturer' }, 'Source contact')).toEqual({
      value,
      owner: 'manufacturer',
    });
  });
  it.each(['adata', 'e_ondiris', 'empty'] as const)('can prefill/refresh source-owned %s defaults', (owner) => {
    expect(planEOndirisPrefill({ value: 'Old source value', owner }, 'New source value')).toEqual({
      value: 'New source value',
      owner: 'e_ondiris',
    });
  });
  it('a missing source value does not clear an existing default', () => {
    expect(planEOndirisPrefill({ value: 'Existing address', owner: 'adata' }, null)).toEqual({
      value: 'Existing address',
      owner: 'adata',
    });
  });
  it('MAN-06/09 keeps the exact Adata legal name and leaves missing legal information unknown', () => {
    expect(adataLegalNameValue('Adata name')).toEqual({
      kind: 'resolved',
      value: 'Adata name',
      source: 'adata',
    });
    expect(adataLegalNameValue(null)).toEqual({ kind: 'resolved', value: null, source: null });
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeAdataMain } from '../src/modules/profiles/main-source-materializer.js';
import {
  chooseMainContact,
  initialContactOwnership,
  planMainSiteRefresh,
  recordMainContactSave,
  recordMainSiteSave,
  refreshMainContact,
  validatedSourceContact,
  type MainSiteOwnership,
} from '../src/modules/profiles/main-source-ownership.js';

const source = initialContactOwnership('companyPhone', null, true);
const site = { identityId: 'site-1', address: 'Original factory', city: null, regionId: null };
const siteOwner: MainSiteOwnership = {
  identityId: site.identityId,
  addressOwner: 'e_ondiris',
  cityOwner: 'unclaimed',
  regionOwner: 'unclaimed',
  deleted: false,
};
const binding = { registrationNumber: '0001', identityId: site.identityId, snapshotId: 'snapshot-a' };

describe('MAN-06 per-field source contact ownership', () => {
  it('chooses one valid e-Ondiris value and records every agreeing immutable source version', () => {
    expect(
      chooseMainContact(
        'companyPhone',
        [
          { id: 'b', value: '+77001234567' },
          { id: 'a', value: '+7 700 123 45 67' },
          { id: 'invalid', value: '700' },
        ],
        { snapshotId: 'adata', values: ['+18005551234'] },
      ),
    ).toEqual({
      kind: 'value',
      value: '+77001234567',
      owner: 'e_ondiris',
      adataSnapshotId: null,
      eOndirisRecordIds: ['a', 'b'],
    });
  });
  it('uses Adata only after no valid e-Ondiris contact', () => {
    expect(
      chooseMainContact('contactEmail', [{ id: 'invalid', value: 'not-an-email' }], {
        snapshotId: 'adata',
        values: ['Office@synthetic.local'],
      }),
    ).toMatchObject({ kind: 'value', owner: 'adata', adataSnapshotId: 'adata', value: 'office@synthetic.local' });
  });
  it('conflicting valid e-Ondiris values do not fall through to Adata', () => {
    expect(
      chooseMainContact(
        'companyPhone',
        [
          { id: 'a', value: '+77001234567' },
          { id: 'b', value: '+77007654321' },
        ],
        { snapshotId: 'adata', values: ['+18005551234'] },
      ),
    ).toEqual({ kind: 'ambiguous' });
  });
  it('valid Adata ambiguity is preserved as an issue', () => {
    expect(
      chooseMainContact('contactEmail', [], {
        snapshotId: 'adata',
        values: ['a@synthetic.local', 'b@synthetic.local'],
      }),
    ).toEqual({ kind: 'ambiguous' });
  });
  it('invalid entries never become validated source defaults', () => {
    expect(validatedSourceContact('companyPhone', [null, '', 'bad', '1234'])).toEqual({
      kind: 'none',
      value: null,
      invalidCount: 2,
    });
  });
  it('unrelated save keeps a source-owned contact eligible for a later refresh', () => {
    const a = refreshMainContact(source, chooseMainContact('companyPhone', [{ id: 'a', value: '+77001234567' }], null));
    const saved = recordMainContactSave(a, a.value, a.value);
    expect(
      refreshMainContact(saved, chooseMainContact('companyPhone', [{ id: 'b', value: '+77007654321' }], null)),
    ).toMatchObject({ owner: 'e_ondiris', value: '+77007654321', eOndirisRecordIds: ['b'] });
  });
  it('an explicit clear stays manufacturer-owned across later source responses', () => {
    const a = refreshMainContact(source, chooseMainContact('companyPhone', [{ id: 'a', value: '+77001234567' }], null));
    const cleared = recordMainContactSave(a, a.value, null);
    expect(
      refreshMainContact(cleared, chooseMainContact('companyPhone', [{ id: 'b', value: '+77007654321' }], null)),
    ).toEqual({
      field: 'companyPhone',
      owner: 'manufacturer',
      value: null,
      adataSnapshotId: null,
      eOndirisRecordIds: [],
    });
  });
  it('correcting phone does not adopt an unchanged Adata email', () => {
    const phone = refreshMainContact(
      source,
      chooseMainContact('companyPhone', [], { snapshotId: 'a', values: ['+77001234567'] }),
    );
    const email = refreshMainContact(
      initialContactOwnership('contactEmail', null, true),
      chooseMainContact('contactEmail', [], { snapshotId: 'a', values: ['a@synthetic.local'] }),
    );
    expect(recordMainContactSave(phone, phone.value, '+18005551234').owner).toBe('manufacturer');
    expect(recordMainContactSave(email, email.value, email.value).owner).toBe('adata');
  });
  it('saved initial blank remains unclaimed, while legacy NULL is never guessed', () => {
    const initialBlank = recordMainContactSave(source, null, null);
    const legacyBlank = initialContactOwnership('companyPhone', null, false);
    const next = chooseMainContact('companyPhone', [{ id: 'a', value: '+77001234567' }], null);
    expect(refreshMainContact(initialBlank, next).value).toBe('+77001234567');
    expect(refreshMainContact(legacyBlank, next)).toMatchObject({ owner: 'legacy_unknown', value: null });
  });
  it('absence, unavailability and ambiguity preserve captured contacts', () => {
    const current = { ...source, owner: 'adata' as const, value: '+77001234567', adataSnapshotId: 'a' };
    for (const kind of ['none', 'unavailable', 'ambiguous'] as const)
      expect(refreshMainContact(current, { kind })).toEqual(current);
  });
  it('refuses a stale ownership baseline instead of interpreting a submitted NULL against newer values', () => {
    expect(() => recordMainContactSave({ ...source, value: '+77001234567' }, '+77007654321', null)).toThrow(
      'canonical content',
    );
  });
});

describe('MAN-08 durable site identity and field ownership', () => {
  it('a city correction leaves the address source-owned and stable across source relocation', () => {
    const corrected = { ...site, city: 'Manufacturer city' };
    const owners = recordMainSiteSave([site], [corrected], [siteOwner]);
    const plan = planMainSiteRefresh(
      [corrected],
      owners,
      [binding],
      [{ id: 'snapshot-b', registrationNumber: '0001', productionAddress: 'New factory' }],
      () => 'new-site',
    );
    expect(plan.sites).toEqual([{ ...corrected, address: 'New factory' }]);
    expect(plan.ownership[0]).toMatchObject({ addressOwner: 'e_ondiris', cityOwner: 'manufacturer' });
    expect(plan.bindings[0]).toMatchObject({ identityId: 'site-1', snapshotId: 'snapshot-b' });
  });
  it('explicit address NULL remains a correction while source bindings follow immutable versions', () => {
    const cleared = { ...site, address: null };
    const owners = recordMainSiteSave([site], [cleared], [siteOwner]);
    const plan = planMainSiteRefresh(
      [cleared],
      owners,
      [binding],
      [{ id: 'snapshot-b', registrationNumber: '0001', productionAddress: 'New factory' }],
      () => 'new-site',
    );
    expect(plan.sites).toEqual([cleared]);
    expect(plan.ownership[0]?.addressOwner).toBe('manufacturer');
    expect(plan.bindings[0]?.snapshotId).toBe('snapshot-b');
  });
  it('removed source site suppression survives a changed address and another pull', () => {
    const removed = recordMainSiteSave([site], [], [siteOwner]);
    const b = planMainSiteRefresh(
      [],
      removed,
      [binding],
      [{ id: 'snapshot-b', registrationNumber: '0001', productionAddress: 'New factory' }],
      () => 'must-not-add',
    );
    const c = planMainSiteRefresh(
      b.sites,
      b.ownership,
      b.bindings,
      [{ id: 'snapshot-c', registrationNumber: '0001', productionAddress: 'Another factory' }],
      () => 'must-not-add',
    );
    expect(c.sites).toEqual([]);
    expect(c.ownership[0]?.deleted).toBe(true);
  });
  it('absent registry rows do not delete sites or binding history', () => {
    expect(planMainSiteRefresh([site], [siteOwner], [binding], [], () => 'new').sites).toEqual([site]);
  });
  it('same exact source address shares one stable site without assigning a city or region', () => {
    const plan = planMainSiteRefresh(
      [],
      [],
      [],
      [
        { id: 'a', registrationNumber: '0001', productionAddress: 'Factory' },
        { id: 'b', registrationNumber: '0002', productionAddress: 'Factory' },
      ],
      () => 'new',
    );
    expect(plan.sites).toEqual([{ identityId: 'new', address: 'Factory', city: null, regionId: null }]);
    expect(plan.bindings.map((b) => b.identityId)).toEqual(['new', 'new']);
  });
  it('one registration changing address preserves its site identity', () => {
    const plan = planMainSiteRefresh(
      [site],
      [siteOwner],
      [binding],
      [{ id: 'b', registrationNumber: '0001', productionAddress: 'Factory B' }],
      () => 'new',
    );
    expect(plan.sites[0]).toMatchObject({ identityId: 'site-1', address: 'Factory B' });
  });
  it('conflicting relocations of a shared site remain flagged without choosing by source row order', () => {
    const bindings = [binding, { registrationNumber: '0002', identityId: 'site-1', snapshotId: 'a2' }];
    const plan = planMainSiteRefresh(
      [site],
      [siteOwner],
      bindings,
      [
        { id: 'b', registrationNumber: '0001', productionAddress: 'Factory B' },
        { id: 'b2', registrationNumber: '0002', productionAddress: 'Factory C' },
      ],
      () => 'new',
    );
    expect(plan.sites).toEqual([site]);
    expect(plan.issues).toEqual([{ code: 'source_site_ambiguous', registrationNumbers: ['0001', '0002'] }]);
  });
  it('a NULL-address peer retains its immutable binding and blocks relocation of their shared source site', () => {
    const bindings = [binding, { registrationNumber: '0002', identityId: 'site-1', snapshotId: 'a2' }];
    const plan = planMainSiteRefresh(
      [site],
      [siteOwner],
      bindings,
      [
        { id: 'b', registrationNumber: '0001', productionAddress: 'Factory B' },
        { id: 'b2', registrationNumber: '0002', productionAddress: null },
      ],
      () => 'must-not-split',
    );
    expect(plan.sites).toEqual([site]);
    expect(plan.bindings).toEqual(bindings);
    expect(plan.issues).toEqual([{ code: 'source_site_ambiguous', registrationNumbers: ['0001', '0002'] }]);
  });
  it('duplicate exact existing addresses block association rather than selecting the first site', () => {
    const plan = planMainSiteRefresh(
      [site, { ...site, identityId: 'site-2' }],
      [siteOwner],
      [],
      [{ id: 'b', registrationNumber: '0001', productionAddress: site.address }],
      () => 'new',
    );
    expect(plan.bindings).toEqual([]);
    expect(plan.issues).toHaveLength(1);
  });
  it('legacy address provenance stays unknown even when a source registration associates by exact address', () => {
    const initial = planMainSiteRefresh(
      [site],
      [],
      [],
      [{ id: 'a', registrationNumber: '0001', productionAddress: site.address }],
      () => 'new',
    );
    const next = planMainSiteRefresh(
      initial.sites,
      initial.ownership,
      initial.bindings,
      [{ id: 'b', registrationNumber: '0001', productionAddress: 'Factory B' }],
      () => 'new',
    );
    expect(next.sites).toEqual([site]);
    expect(next.ownership[0]?.addressOwner).toBe('legacy_unknown');
  });
});

describe('Adata Main allowed immutable capture boundary', () => {
  const sourceBin = '000000000000';
  const normalize = (value: Record<string, unknown>) =>
    normalizeAdataMain(
      { ...value, basic: { ...((value.basic as Record<string, unknown> | undefined) ?? {}), biin: sourceBin } },
      sourceBin,
    );
  it('allows a missing BIN only for an empty allowed Main response', () => {
    expect(normalizeAdataMain({}, sourceBin)).toMatchObject({
      legal: { legalName: null, oked: [], founders: [] },
      phones: [],
      emails: [],
    });
    expect(() => normalizeAdataMain({ basic: { name_ru: 'Unbound company' } }, sourceBin)).toThrow(
      'verified source identity',
    );
    expect(() => normalizeAdataMain({ kzCoContact: { emails: ['unbound@synthetic.local'] } }, sourceBin)).toThrow(
      'verified source identity',
    );
  });
  it('rejects another BIN, numeric BIN and malformed returned identity without repairing it', () => {
    for (const biin of ['240100000011', 0, '00000000000', '000000000001', ' 000000000000 '])
      expect(() => normalizeAdataMain({ basic: { biin, name_ru: 'Wrong source' } }, sourceBin)).toThrow(
        'returned identity',
      );
  });
  it('retains exact leading-zero/imported identifiers and rejects malformed requested identity', () => {
    expect(normalizeAdataMain({ basic: { biin: sourceBin, name_ru: 'Bound source' } }, sourceBin).legal.legalName).toBe(
      'Bound source',
    );
    expect(
      normalizeAdataMain({ basic: { biin: '000000000001', name_ru: 'Imported source' } }, '000000000001').legal
        .legalName,
    ).toBe('Imported source');
    expect(() => normalizeAdataMain({}, '00000000001')).toThrow('requested identity');
  });
  it('keeps full ordered legal lists and source text while excluding report and private metadata', () => {
    const longName = `Source ${'x'.repeat(1500)} 🏭`;
    const result = normalize({
      basic: {
        name_ru: longName,
        date_registration: '29.02.2020',
        legal_address: 'Source address',
        okeds: Array.from({ length: 75 }, (_, i) => ({
          i: `0${String(i).padStart(4, '0')}`,
          name_ru: `Source OKED ${i}`,
          hidden: 'private-capture-marker',
        })),
        director_iin: 'private-capture-marker',
      },
      founders: {
        founders_dtl: Array.from({ length: 75 }, (_, i) => ({
          name: `Founder ${i}`,
          shares: 'private-capture-marker',
        })),
      },
      report: { hidden: 'private-capture-marker' },
    });
    expect(result.legal.legalName).toBe(longName);
    expect(result.legal.stateRegisteredOn).toBe('2020-02-29');
    expect(result.legal.oked).toHaveLength(75);
    expect(result.legal.oked[0]?.code).toBe('00000');
    expect(result.legal.founders).toHaveLength(75);
    expect(Object.keys(result).sort()).toEqual(['emails', 'legal', 'phones']);
    expect(Object.keys(result.legal).sort()).toEqual([
      'directorFullName',
      'founders',
      'legalAddress',
      'legalForm',
      'legalName',
      'oked',
      'stateRegisteredOn',
    ]);
    expect(JSON.stringify(result)).not.toContain('private-capture-marker');
  });
  it('captures only distinct validated company contacts without inventing a national phone prefix', () => {
    expect(
      normalize({
        kzCoContact: {
          phones: [{ contact: '87001234567' }, { contact: '00 44 (1234) 567890' }, '+441234567890'],
          emails: [{ contact: 'invalid' }, { contact: 'SOURCE@synthetic.local' }, 'source@synthetic.local'],
        },
      }),
    ).toMatchObject({ phones: ['+441234567890'], emails: ['source@synthetic.local'] });
  });
  it('rejects conflicting labels for the same source OKED identity', () => {
    expect(() =>
      normalize({
        basic: { okeds: [{ i: '00001', name_ru: 'A' }], secondary_okeds: [{ i: '00001', name_ru: 'B' }] },
      }),
    ).toThrow('conflicting');
  });
  it('rejects unrepresentable source legal text instead of silently changing the recorded fact', () => {
    expect(() => normalize({ basic: { name_ru: 'Company\u0000name' } })).toThrow('representable');
    expect(() => normalize({ founders: { founders_dtl: [{ name: '\uD800' }] } })).toThrow('representable');
  });
});

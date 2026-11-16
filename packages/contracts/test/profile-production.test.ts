import { describe, expect, it } from 'vitest';
import { productionWriteSchema, productionUtilisationSchema, type ProductionWrite } from '../src/profile-production.js';

const ID = '89ab89ab-0123-4567-8901-abcdefabcdef';
const empty = (): ProductionWrite => ({ areaSqm: null, workshopCount: null, utilisationPercent: null,
  processEntryIds: [], photoIds: [], equipment: [] });
const equipment = () => ({ name: null, typeId: null, quantity: null, photoId: null, productIdentityIds: [] as string[] });
describe('MAN-26–32 optional production transport', () => {
  it('accepts an entirely empty section and unfinished equipment rows', () => {
    expect(productionWriteSchema.parse(empty())).toEqual(empty());
    expect(productionWriteSchema.parse({ ...empty(), equipment: [equipment()] }).equipment).toHaveLength(1);
  });
  it('normalizes exact area decimals, zero utilisation and blank draft names', () => {
    expect(productionWriteSchema.parse({ ...empty(), areaSqm: '0009007199254740993.00000000000000000100',
      utilisationPercent: '000.00', equipment: [{ ...equipment(), name: '  ' }] })).toMatchObject({
      areaSqm: '9007199254740993.000000000000000001', utilisationPercent: '0', equipment: [{ name: null }],
    });
    expect(productionUtilisationSchema.parse('100.000')).toBe('100');
    expect(productionUtilisationSchema.parse('099.9900')).toBe('99.99');
  });
  it.each(['100.01', '101', '1000', '-1', '0.001', '99.999', '1e1', '1,5', 50])(
    'rejects invalid or lossy utilisation %s', (value) => expect(productionUtilisationSchema.safeParse(value).success).toBe(false),
  );
  it.each([-1, 1.5, 2_147_483_648, '2'])(
    'rejects invalid counts %s', (value) => {
      expect(productionWriteSchema.safeParse({ ...empty(), workshopCount: value }).success).toBe(false);
      expect(productionWriteSchema.safeParse({ ...empty(), equipment: [{ ...equipment(), quantity: value }] }).success).toBe(false);
    },
  );
  it('rejects duplicated process/product selections and ordered photos after UUID normalization', () => {
    expect(productionWriteSchema.safeParse({ ...empty(), processEntryIds: [ID, ID.toUpperCase()] }).success).toBe(false);
    expect(productionWriteSchema.safeParse({ ...empty(), photoIds: [ID, ID.toUpperCase()] }).success).toBe(false);
    expect(productionWriteSchema.safeParse({ ...empty(), photoIds: [ID], equipment: [{ ...equipment(), photoId: ID.toUpperCase() },
      { ...equipment(), photoId: ID }] }).success).toBe(true);
    expect(productionWriteSchema.safeParse({ ...empty(), equipment: [{ ...equipment(), productIdentityIds: [ID, ID.toUpperCase()] }] }).success).toBe(false);
  });
  it('rejects forged row identities, year, storage fields and source facts', () => {
    for (const field of ['id', 'identityId', 'year', 'sectionRevisionId', 'storageKey', 'source'])
      expect(productionWriteSchema.safeParse({ ...empty(), equipment: [{ ...equipment(), [field]: ID }] }).success).toBe(false);
  });
  it('preserves equipment/photo order while canonicalizing unordered associations', () => {
    const lower = '00000000-0123-4567-8901-abcdefabcdef';
    const parsed = productionWriteSchema.parse({ ...empty(), photoIds: [ID, lower], processEntryIds: [ID.toUpperCase(), lower],
      equipment: [{ ...equipment(), name: 'First', productIdentityIds: [ID.toUpperCase(), lower] }, { ...equipment(), name: 'Second' }] });
    expect(parsed.photoIds).toEqual([ID, lower]);
    expect(parsed.processEntryIds).toEqual([lower, ID]);
    expect(parsed.equipment.map((row) => row.name)).toEqual(['First', 'Second']);
    expect(parsed.equipment[0]?.productIdentityIds).toEqual([lower, ID]);
  });
  it('allows more than a thousand ordered equipment drafts without a business count cap', () => {
    expect(productionWriteSchema.parse({ ...empty(), equipment: Array.from({ length: 1001 }, equipment) }).equipment).toHaveLength(1001);
  });
});

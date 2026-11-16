import { describe, expect, it } from 'vitest';
import { productCapacitySchema, productsWriteSchema, type ProductsWrite } from '../src/profile-products.js';

const ID = '89ab89ab-0123-4567-8901-abcdefabcdef';
const manual = () => ({ kind: 'manual' as const, identityId: ID, nameEn: null, nameRu: null,
  commodityTypeId: null, tnVedEntryId: null, kpvedEntryIds: [], capacityQuantity: null,
  capacityUnitId: null, productionSiteIdentityId: null, note: null, certificateIdentityIds: [] });
const input = (): ProductsWrite => ({ products: [manual()], unifiedRegisterExtractId: null });

describe('MAN-23–25 strict products transport', () => {
  it('normalizes blanks, UUID spelling and exact decimals without floating point', () => {
    const parsed = productsWriteSchema.parse({ products: [{ ...manual(), identityId: ID.toUpperCase(),
      nameEn: '  ', capacityQuantity: ' 0009007199254740993.00000000000000000100 ' }], unifiedRegisterExtractId: null });
    expect(parsed.products[0]).toMatchObject({ identityId: ID, nameEn: null, capacityQuantity: '9007199254740993.000000000000000001' });
    expect(productCapacitySchema.parse('000.000')).toBe('0');
    expect(productCapacitySchema.parse('')).toBeNull();
  });
  it.each([-1, 1.2, '-0', '+2', '1e6', '1,2', 'NaN', 'Infinity', '.2', '2.', '9'.repeat(2001)])(
    'rejects invalid capacity %s', (quantity) => expect(productCapacitySchema.safeParse(quantity).success).toBe(false),
  );
  it.each(['source', 'eOndirisRecordId', 'tnVedCode', 'commodityGroupId', 'inCountryValueShare', 'capacityText', 'unifiedRegisterActive'])(
    'rejects writable source/raw facts %s', (field) => {
      expect(productsWriteSchema.safeParse({ ...input(), products: [{ ...manual(), [field]: ID }] }).success).toBe(false);
    },
  );
  it('permits only local associations on a registry line', () => {
    const registry = { kind: 'registry', identityId: ID, productionSiteIdentityId: null, note: null, certificateIdentityIds: [] };
    expect(productsWriteSchema.safeParse({ products: [registry], unifiedRegisterExtractId: null }).success).toBe(true);
    expect(productsWriteSchema.safeParse({ products: [{ ...registry, nameEn: 'Tampered' }], unifiedRegisterExtractId: null }).success).toBe(false);
  });
  it('rejects duplicate stable identities and duplicate links after UUID normalization', () => {
    expect(productsWriteSchema.safeParse({ ...input(), products: [manual(), { ...manual(), identityId: ID.toUpperCase() }] }).success).toBe(false);
    expect(productsWriteSchema.safeParse({ ...input(), products: [{ ...manual(), kpvedEntryIds: [ID, ID.toUpperCase()] }] }).success).toBe(false);
    expect(productsWriteSchema.safeParse({ ...input(), products: [{ ...manual(), certificateIdentityIds: [ID, ID.toUpperCase()] }] }).success).toBe(false);
  });
  it('accepts empty drafts and more than a thousand product lines without an invented business limit', () => {
    expect(productsWriteSchema.parse({ products: [], unifiedRegisterExtractId: null }).products).toEqual([]);
    const products = Array.from({ length: 1001 }, (_, i) => ({ ...manual(), identityId: `89ab89ab-0123-4567-8901-${i.toString(16).padStart(12, '0')}` }));
    expect(productsWriteSchema.parse({ products, unifiedRegisterExtractId: null }).products).toHaveLength(1001);
  });
});

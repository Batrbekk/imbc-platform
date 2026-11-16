import { describe, expect, it } from 'vitest';
import { sanitizeAdataMainPrefill } from '../src/modules/adata/main-prefill-sanitizer.js';
import { normalizeAdataMain } from '../src/modules/profiles/main-source-materializer.js';

const bin = '000000000000';
describe('Stored Adata Main subset', () => {
  it('preserves complete checked legal lists and named contact fields, dropping unrelated report/person fields', () => {
    const rows = Array.from({ length: 75 }, (_, i) => ({ i: `0${String(i).padStart(4, '0')}`, name_ru: `Synthetic OKED ${i}`, detail: 'synthetic-private' }));
    const data = {
      basic: { biin: bin, name_ru: 'Synthetic legal name', fullname_director: 'Synthetic director', director_iin: 'synthetic-private', okeds: rows, employee_count: 42 },
      founders: { founders_dtl: rows.map((_, i) => ({ name: `Synthetic founder ${i}`, founder_uin: 'synthetic-private' })) },
      kzCoContact: { phones: ['+77001234567'], emails: [{ contact: 'synthetic@synthetic.local', personId: 'synthetic-private' }], websites: ['synthetic-private'] },
      taxDeductions: { details: ['synthetic-private'] }, note: 'synthetic-private', riskFactor: { company: { bankrupt: true } },
    };
    const value = sanitizeAdataMainPrefill(data, bin, 'synthetic-token');
    expect(Object.keys(value).sort()).toEqual(['basic', 'founders', 'kzCoContact']);
    expect(JSON.stringify(value)).not.toContain('synthetic-private');
    const normalized = normalizeAdataMain(value, bin);
    expect(normalized.legal).toMatchObject({ legalName: 'Synthetic legal name', directorFullName: 'Synthetic director' });
    expect(normalized.legal.oked).toHaveLength(75);
    expect(normalized.legal.founders).toHaveLength(75);
    expect(normalized.phones).toEqual(['+77001234567']);
    expect(normalized.emails).toEqual(['synthetic@synthetic.local']);
  });
  it('retains empty no-identity responses as unknown without inventing identity or clearing checked legal values', () => {
    for (const data of [{}, { basic: null, founders: null }]) {
      const value = sanitizeAdataMainPrefill(data, bin, 'synthetic-token');
      expect(value).toEqual({ basic: null, founders: null, kzCoContact: null });
      expect(normalizeAdataMain(value, bin).legal.legalName).toBeNull();
    }
  });
  it('rejects mismatched/numeric identities and unrepresentable/conflicting legal facts', () => {
    for (const data of [
      { basic: { biin: 0 } }, { basic: { biin: '000000000001' } },
      { basic: { biin: bin, name_ru: 'Synthetic\0name' } },
      { basic: { biin: bin }, founders: { founders_dtl: [{ name: 'Synthetic\uD800name' }] } },
      { basic: { biin: bin, okeds: [{ i: '00001', name_ru: 'A' }], secondary_okeds: [{ i: '00001', name_ru: 'B' }] } },
    ]) expect(() => sanitizeAdataMainPrefill(data, bin, 'synthetic-token')).toThrow();
  });
  it('ignores deeply nested unrelated report payloads and redacts tokens in allowed fields only', () => {
    let unrelated: unknown = null;
    for (let i = 0; i < 20_000; i++) unrelated = { unrelated };
    const value = sanitizeAdataMainPrefill({ basic: { biin: bin, name_ru: 'Synthetic echo synthetic-token' }, unrelated }, bin, 'synthetic-token');
    expect((value.basic as { name_ru: string }).name_ru).toBe('Synthetic echo [redacted]');
    expect(Object.hasOwn(value, 'unrelated')).toBe(false);
  });
});

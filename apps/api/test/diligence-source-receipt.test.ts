import { describe, expect, it } from 'vitest';
import { normalizedDiligenceReceipt, unavailableDiligenceReceipt } from '../src/modules/due-diligence/source-receipt.js';
import { parseAdataDiligenceJson } from '../src/modules/due-diligence/adata-normalizer.js';

const options = { bin: '000000000000', companyName: 'Synthetic company', isTestData: true };
const basic = { biin: options.bin };
describe('Normalized immutable DD packet', () => {
  it.each([{}, { basic: null, founders: null, kzCoContact: null }, { basic }, { basic, riskFactor: { company: { bankrupt: null } } }])('retains unknown/no-answer without an automatic replacement', data => {
    const receipt = normalizedDiligenceReceipt(data, options);
    expect(receipt).toMatchObject({ state: 'no_answer', automaticResult: null, isTestData: true });
  });
  it('distinguishes explicit false from a finding and stores only allowlisted normalized evidence', () => {
    const data = { basic: { ...basic, director_iin: 'synthetic-private' }, riskFactor: { company: { bankrupt: false } }, court_cases: [{ name: 'synthetic-private' }], contacts: { loginEmail: 'synthetic-private' } };
    expect(normalizedDiligenceReceipt(data, options)).toMatchObject({ state: 'received', automaticResult: 'green', evidence: [{ kind: 'boolean', value: false }] });
    expect(normalizedDiligenceReceipt({ ...data, riskFactor: { company: { bankrupt: true } } }, options)).toMatchObject({ state: 'received', automaticResult: 'red' });
    expect(JSON.stringify(normalizedDiligenceReceipt(data, options))).not.toContain('synthetic-private');
  });
  it('quarantines malformed normalized checks independently of valid Main identity', () => {
    const data = { basic: { ...basic, name_ru: 'Synthetic legal company' }, riskFactor: { company: { bankrupt: 'synthetic-private' } } };
    const receipt = normalizedDiligenceReceipt(data, options);
    expect(receipt).toMatchObject({ state: 'malformed', evidence: [], automaticResult: null });
    expect(JSON.stringify(receipt)).not.toContain('synthetic-private');
  });
  it('preserves the adapter numeric boundary through scoring and the immutable packet', () => {
    const number = '9'.repeat(10_000);
    const data = parseAdataDiligenceJson(`{"basic":{"biin":"${options.bin}"},"litigation":{"total_civil_count":${number},"total_criminal_count":${number},"total_administrative_count":${number},"total_appk_count":${number}}}`);
    const receipt = normalizedDiligenceReceipt(data, options);
    expect(receipt).toMatchObject({ state: 'received', automaticResult: 'amber' });
    expect(receipt.evidence[0]).toMatchObject({ civil: number, criminal: number, administrative: number, appk: number });
    const scientific = parseAdataDiligenceJson(`{"basic":{"biin":"${options.bin}"},"contract":{"total_count":1,"total_sum":${'9'.repeat(9994)}e1000}}`);
    expect(normalizedDiligenceReceipt(scientific, options)).toMatchObject({ state: 'received', automaticResult: 'amber' });
  });
  it('keeps all unavailable/module/config/quota failures distinct with explicit test provenance', () => {
    for (const state of ['unavailable', 'modules_not_connected', 'not_configured', 'quota_exhausted', 'malformed'] as const) {
      expect(unavailableDiligenceReceipt(state, false)).toMatchObject({ state, evidence: [], automaticResult: null, isTestData: false });
    }
    expect(() => unavailableDiligenceReceipt('unavailable', undefined as unknown as boolean)).toThrow('invalid_context');
  });
});

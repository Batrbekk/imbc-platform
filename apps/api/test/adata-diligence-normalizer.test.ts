import { describe, expect, it } from 'vitest';
import { DILIGENCE_CATALOG, diligenceDefinition } from '../src/modules/due-diligence/catalog.js';
import {
  ADATA_RATE76_BOOLEAN_BINDINGS,
  ADATA_RATE76_EXTRA_BOOLEAN_BINDINGS,
  exactAdataDecimal,
  InvalidAdataDiligenceData,
  normalizeAdataCompanyInfo,
  normalizeAdataTaxPayments,
  normalizeAdataTaxRegime,
  parseAdataDiligenceJson,
} from '../src/modules/due-diligence/adata-normalizer.js';
import { evaluateReceivedDiligence } from '../src/modules/due-diligence/scoring.js';

const options = { bin: '240100000011', companyName: 'Synthetic company', isTestData: true };
const basic = () => ({ basic: { biin: options.bin, fullname_director: 'Synthetic director' } });
function assign(data: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.'), leaf = parts.pop()!;
  let parent = data;
  for (const part of parts) {
    parent[part] ??= {};
    parent = parent[part] as Record<string, unknown>;
  }
  parent[leaf] = value;
}

describe('documented Adata diligence operation normalization', () => {
  it('binds each allowed field to an actual catalog row and keeps source periods separate', () => {
    const paths = new Set<string>();
    const data = basic();
    for (const [path, id] of ADATA_RATE76_BOOLEAN_BINDINGS) {
      expect(paths.has(path)).toBe(false); paths.add(path);
      expect(diligenceDefinition(id)).toBeDefined();
      assign(data, path, false);
    }
    const normalized = normalizeAdataCompanyInfo(data, options);
    expect(normalized.evidence).toHaveLength(ADATA_RATE76_BOOLEAN_BINDINGS.length);
    expect(normalized.evaluation?.checks.every(check => check.mark === 'clear')).toBe(true);
    expect(normalized.evaluation?.automaticResult).toBe('green');
    const customs = normalized.evidence.filter(check => check.catalogId === 'company_enterprise.02');
    expect(customs.map(check => check.period)).toEqual(['first half of the source current year', 'second half of the source current year']);
    expect(customs[0]!.checkName).not.toBe(customs[1]!.checkName);
    expect(() => evaluateReceivedDiligence([...customs, customs[0]!])).toThrow('duplicate_check');
  });

  it('does not convert missing modules, all no-answer checks or unknown BIN into green', () => {
    expect(normalizeAdataCompanyInfo({}, options).evaluation).toBeNull();
    expect(normalizeAdataCompanyInfo({ basic: null, kzCoContact: null, founders: null }, options).evaluation).toBeNull();
    expect(normalizeAdataCompanyInfo(basic(), options).evidence).toEqual([]);
    const data = basic(); assign(data, 'riskFactor.company.bankrupt', null);
    expect(normalizeAdataCompanyInfo(data, options)).toMatchObject({ evaluation: null, evidence: [{ kind: 'no_answer' }] });
    const partial = basic(); assign(partial, 'riskFactor.company.bankrupt', false);
    expect(normalizeAdataCompanyInfo(partial, options).evaluation?.automaticResult).toBe('green');
    expect(() => normalizeAdataCompanyInfo({ basic: { biin: '000000000000' }, riskFactor: { company: { bankrupt: true } } }, options)).toThrow('source_bin_mismatch');
  });

  it('ignores summary booleans, analytics, contact details, raw court and contract lists and unrelated fields', () => {
    const data = { ...basic(), basic: { ...basic().basic, company_problems: true, financial_problems: true, head_problems: true, director_iin: '800101300011' }, contacts: { phones: ['synthetic-secret'] }, trustworthyAnalytics: { negative: { factors: [{ name: 'unrelated', value: true }] } }, riskFactor: { company: { unrelated: true }, head: { unrelated: true } }, court_cases: [{ person: 'synthetic-secret' }], contract: { details: [{ supplier: 'synthetic-secret' }] }, extra: true };
    const normalized = normalizeAdataCompanyInfo(data, options);
    expect(normalized.evidence).toEqual([]);
    expect(JSON.stringify(normalized)).not.toContain('synthetic-secret');
    expect(JSON.stringify(normalized)).not.toContain('800101300011');
    expect(normalized.evaluation).toBeNull();
  });

  it('keeps the documented debtor register and sale ban separate from wanted-person and sale checks', () => {
    const data = basic();
    for (const [path] of ADATA_RATE76_EXTRA_BOOLEAN_BINDINGS) assign(data, path, true);
    const normalized = normalizeAdataCompanyInfo(data, options);
    expect(normalized.evidence.map(check => check.catalogId)).toEqual([null, null, null, null]);
    expect(normalized.evaluation!.automaticResult).toBe('red');
    expect(normalized.evaluation!.checks.every(check => check.mark === 'finding')).toBe(true);
    expect(normalized.evaluation!.checks.some(check => check.catalogId === 'director.17' || check.catalogId === 'director.11' || check.catalogId === 'company_enterprise.26')).toBe(false);
  });

  it('scores supplied canonical findings, keeps shown-only counters and exact director debt', () => {
    const data = basic();
    assign(data, 'riskFactor.company.bankrupt', true);
    assign(data, 'trustworthyExtended.large_taxpayer', true);
    assign(data, 'kzCoTrustworthyPlus.mass_address', '90071992547409930001');
    assign(data, 'riskFactor.head.tax_debt', '0.00000000000000000001');
    const result = normalizeAdataCompanyInfo(data, options).evaluation!;
    expect(result.automaticResult).toBe('red');
    expect(result.checks.find(check => check.catalogId === 'company_enterprise.01')).toMatchObject({ adataValue: '90071992547409930001', mark: 'shown_only', attention: true });
    expect(result.checks.find(check => check.catalogId === 'company_finance.01')).toMatchObject({ mark: 'shown_only', attention: true });
    expect(result.checks.find(check => check.catalogId === 'director.04')).toMatchObject({ subjectName: 'Synthetic director', adataValue: '0.00000000000000000001', mark: 'finding' });
    expect(new Set(result.checks.map(check => check.catalogId))).toEqual(new Set(['company_enterprise.08', 'company_enterprise.01', 'company_finance.01', 'director.04']));
  });

  it.each([
    ['Низкая', 'clear', 'green'], ['LOW', 'clear', 'green'], ['төмен', 'clear', 'green'],
    ['Средняя', 'shown_only', 'amber'], ['орташа', 'shown_only', 'amber'],
    ['Высокая', 'finding', 'red'], ['жоғары', 'finding', 'red'], ['Unrecognized returned degree', 'finding', 'red'],
  ])('preserves taxpayer degree %s and its explicit classification', (degree, mark, automaticResult) => {
    const data = basic(); assign(data, 'riskFactor.company.tax_risk_degree', degree);
    expect(normalizeAdataCompanyInfo(data, options).evaluation).toMatchObject({ automaticResult, checks: [{ adataValue: degree, mark }] });
  });

  it('retains all four court counts without copying court-case people or lists', () => {
    const data = { ...basic(), litigation: { total_civil_count: 0, total_criminal_count: null, total_administrative_count: '0000', total_appk_count: '9007199254740993', court_cases: [{ names: 'synthetic-private' }] } };
    const normalized = normalizeAdataCompanyInfo(data, options);
    expect(JSON.parse(normalized.evaluation!.checks[0]!.adataValue!)).toEqual({ civil: '0', criminal: null, administrative: '0000', appk: '9007199254740993' });
    expect(normalized.evaluation!.checks[0]!).toMatchObject({ mark: 'shown_only', attention: true });
    expect(JSON.stringify(normalized)).not.toContain('synthetic-private');
  });

  it('preserves aggregate contract totals and partial missing count without inferring zero', () => {
    const full = normalizeAdataCompanyInfo({ ...basic(), contract: { total_count: '0002', total_sum: '9007199254740993.0010', details: [{ names: 'synthetic-private' }] } }, options);
    expect(JSON.parse(full.evaluation!.checks[0]!.adataValue!)).toEqual({ count: '0002', sum: '9007199254740993.0010' });
    expect(full.evaluation!.automaticResult).toBe('amber');
    expect(JSON.stringify(full)).not.toContain('synthetic-private');
    const partial = normalizeAdataCompanyInfo({ ...basic(), contract: { total_count: null, total_sum: '1.000' } }, options);
    expect(partial.evaluation!.checks[0]!).toMatchObject({ mark: 'shown_only', attention: false });
    expect(JSON.parse(partial.evaluation!.checks[0]!.adataValue!)).toEqual({ count: null, sum: '1.000' });
    const none = normalizeAdataCompanyInfo({ ...basic(), contract: { total_count: null, total_sum: null } }, options);
    expect(none.evaluation).toBeNull();
  });

  it('preserves numeric JSON lexemes, including huge integers and tiny/scientific decimals', () => {
    const data = parseAdataDiligenceJson('{"count":90071992547409930001,"amount":9007199254740993.0010,"tiny":1e-20,"plain":1.000,"flag":false}') as Record<string, unknown>;
    expect(data).toEqual({ count: '90071992547409930001', amount: '9007199254740993.0010', tiny: '1e-20', plain: '1.000', flag: false });
    expect(exactAdataDecimal(data.tiny)).toBe('0.00000000000000000001');
    expect(exactAdataDecimal('1.2300e+3')).toBe('1230.0');
    expect(exactAdataDecimal('-0e-2')).toBe('-0.00');
    expect(() => exactAdataDecimal(9007199254740993)).toThrow('number_precision_unavailable');
    expect(() => exactAdataDecimal(0.1)).toThrow('number_precision_unavailable');
    expect(() => exactAdataDecimal('1e9999')).toThrow('decimal_exponent_limit');
  });

  it('normalizes only rate120 years and exact tax/payroll/combined totals; latest zero is critical', () => {
    const raw = parseAdataDiligenceJson('{"details":[{"year":2025,"amount":0,"amount_other":0,"amount_fot":0},{"year":2023,"amount":0},{"year":2024,"amount":1e-20,"amount_fot":null,"amount_other":1e-20}]}');
    const normalized = normalizeAdataTaxPayments(raw, options);
    expect(normalized.operations).toEqual([120]);
    expect(normalized.evaluation!.automaticResult).toBe('red');
    expect(normalized.evaluation!.checks.map(check => JSON.parse(check.adataValue!))).toEqual([
      { year: 2025, tax: '0', payroll: '0', total: '0' }, { year: 2023, tax: null, payroll: null, total: '0' }, { year: 2024, tax: '0.00000000000000000001', payroll: null, total: '0.00000000000000000001' },
    ]);
    expect(normalized.evaluation!.checks.map(check => check.mark)).toEqual(['finding', 'shown_only', 'shown_only']);
    const partial = normalizeAdataTaxPayments({ details: [{ year: 2025, amount_other: '1.00' }] }, options);
    expect(JSON.parse(partial.evaluation!.checks[0]!.adataValue!)).toEqual({ year: 2025, tax: '1.00', payroll: null, total: null });
    expect(partial.evaluation!.checks[0]!.mark).toBe('shown_only');
    const company = normalizeAdataCompanyInfo({ ...basic(), taxDeductions: { details: [{ year: 2025, amount: 0 }] } }, options);
    expect(company.evidence).toEqual([]);
  });

  it('keeps rate119 tax regime separate from payroll/statistics and no-response', () => {
    const normalized = normalizeAdataTaxRegime({ tax_mode: 'Synthetic returned regime', statistics: [{ year: 2025, workers_count: 0, tax_in: 0 }], oked: 'irrelevant' }, options);
    expect(normalized.evaluation!.checks).toHaveLength(1);
    expect(normalized.evaluation!.checks[0]!).toMatchObject({ adataValue: 'Synthetic returned regime', mark: 'shown_only', attention: false });
    expect(normalizeAdataTaxRegime({ tax_mode: null }, options).evaluation).toBeNull();
    expect(normalizeAdataTaxRegime({}, options).evidence).toEqual([]);
  });

  it.each([{ year: 2026 }, { year: 2026, amount: null, amount_fot: null, amount_other: null }])('keeps a tax year with no returned sums as no-answer, without replacing a business result', row => {
    const normalized = normalizeAdataTaxPayments({ details: [row] }, options);
    expect(normalized.evaluation).toBeNull();
    expect(normalized.evidence).toMatchObject([{ kind: 'tax_payment', year: 2026, tax: null, payroll: null, total: null, checkName: 'Tax payments — 2026' }]);
    expect(evaluateReceivedDiligence(normalized.evidence).checks).toMatchObject([{ checkName: 'Tax payments — 2026', adataValue: null, mark: 'no_answer', attention: false }]);
  });

  it.each([
    ['riskFactor.company.bankrupt', 'yes', 'invalid_boolean'],
    ['kzCoTrustworthyPlus.mass_address', -1, 'invalid_count'],
    ['riskFactor.head.tax_debt', '-0.001', 'negative_debt'],
    ['riskFactor.company.tax_risk_degree', 'raw\0private', 'invalid_text'],
  ])('quarantines invalid %s without placing its raw value in the error', (path, value, reason) => {
    const data = basic(); assign(data, path, value);
    try { normalizeAdataCompanyInfo(data, options); expect.fail('Expected invalid provider evidence'); }
    catch (error) { expect(error).toBeInstanceOf(InvalidAdataDiligenceData); expect((error as Error).message).toBe(reason); }
  });

  it('does not manufacture a director name or repeated/invalid tax year', () => {
    const data = { basic: { biin: options.bin }, riskFactor: { head: { terrorist: true } } };
    expect(() => normalizeAdataCompanyInfo(data, options)).toThrow('invalid_text');
    expect(() => normalizeAdataTaxPayments({ details: [{ year: 2025 }, { year: '2025' }] }, options)).toThrow('duplicate_check');
    expect(() => normalizeAdataTaxPayments({ details: [{ year: null }] }, options)).toThrow('invalid_tax_year');
    expect(() => normalizeAdataTaxPayments({ details: [{ year: 10000 }] }, options)).toThrow('invalid_tax_year');
    expect(() => normalizeAdataCompanyInfo(basic(), { ...options, isTestData: undefined as unknown as boolean })).toThrow('invalid_context');
    expect(DILIGENCE_CATALOG).toHaveLength(116);
  });
});

import { diligenceDefinition, type DiligenceGroup } from './catalog.js';
import { InvalidAdataJson, parseAdataJson } from '../adata/numeric-json.js';
import { evaluateReceivedDiligence, InvalidDiligenceEvidence, type DiligenceEvaluation, type DiligenceEvidence } from './scoring.js';

/** Reviewed operation schemas in Abay's pinned snapshot; no provider requests are made here. */
export const ADATA_DILIGENCE_SCHEMA_SHA256 = '81d7dc7228398f4737b4ad1749c559f73a25f4ecd6aecbbcbc9ed22e28efb7ce';
export class InvalidAdataDiligenceData extends Error {
  constructor(readonly reason: string) { super(reason); this.name = 'InvalidAdataDiligenceData'; }
}
const invalid = (reason: string): never => { throw new InvalidAdataDiligenceData(reason); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 10_000 || /[\u0000\uD800-\uDFFF]/u.test(value)) return invalid('invalid_text');
  return value;
}
function at(data: unknown, path: string): unknown {
  let value = data;
  for (const part of path.split('.')) {
    if (!object(value) || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

/** Preserve JSON number lexemes before JS can round money or large counters. No raw body is retained. */
export function parseAdataDiligenceJson(body: string): unknown {
  try {
    return parseAdataJson(body);
  } catch (error) {
    if (error instanceof InvalidAdataJson) return invalid(error.reason);
    throw error;
  }
}

/** Exact decimal expansion, including scientific JSON notation. Parsed fractional JS numbers are refused. */
export function exactAdataDecimal(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalid('number_precision_unavailable');
    return String(value);
  }
  if (typeof value !== 'string' || value.length > 10_000) return invalid('invalid_decimal');
  if (/^[+-]?\d+(?:\.\d+)?$/.test(value)) return value;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d{1,4})$/.exec(value);
  if (!match) return invalid('invalid_decimal');
  const exponent = Number(match[4]);
  if (Math.abs(exponent) > 1000) return invalid('decimal_exponent_limit');
  const digits = match[2]! + (match[3] ?? ''), point = match[2]!.length + exponent;
  return match[1]! + (point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point));
}
function counter(value: unknown): string | null {
  const decimal = exactAdataDecimal(value);
  if (decimal === null) return null;
  const match = /^\+?(\d+)(?:\.0+)?$/.exec(decimal);
  if (!match) return invalid('invalid_count');
  return match[1]!;
}
const positive = (value: string): boolean => /[1-9]/.test(value.replace(/^[+-]/, '').replace('.', ''));

type Binding = readonly [path: string, catalogId: string, period?: string];
/** Explicit allowlist. Summary flags, analytics scores, contacts and related-person lists are excluded. */
export const ADATA_RATE76_BOOLEAN_BINDINGS: readonly Binding[] = [
  ['kzCoTrustworthyPlus.first_half_custom_inspection', 'company_enterprise.02', 'first half of the source current year'],
  ['kzCoTrustworthyPlus.second_half_custom_inspection', 'company_enterprise.02', 'second half of the source current year'],
  ['kzCoTrustworthyPlus.first_half_control_supervision', 'company_enterprise.03', 'first half of the source current year'],
  ['kzCoTrustworthyPlus.second_half_control_supervision', 'company_enterprise.03', 'second half of the source current year'],
  ['riskFactor.company.bankrupt', 'company_enterprise.08'],
  ['trustworthyExtended.wrong_address', 'company_enterprise.11'],
  ['trustworthyExtended.esf_bounded', 'company_enterprise.14'],
  ['trustworthyExtended.tax_arrears_150', 'company_enterprise.15'],
  ['trustworthyExtended.force_entered', 'company_enterprise.16'],
  ['trustworthyExtended.finished', 'company_enterprise.17'],
  ['trustworthyExtended.rehabilitation', 'company_enterprise.18'],
  ['riskFactor.company.liquidating_taxpayer', 'company_enterprise.19'],
  ['riskFactor.company.seized_bank_account', 'company_enterprise.20'],
  ['riskFactor.company.seized_property', 'company_enterprise.21'],
  ['trustworthyExtended.restriction_on_leaving', 'company_enterprise.22'],
  ['riskFactor.company.ban_registration_actions_legal_ent', 'company_enterprise.23'],
  ['riskFactor.company.ban_notarius_actions', 'company_enterprise.24'],
  ['trustworthyExtended.transport_arrest', 'company_enterprise.25'],
  ['kzCoTrustworthyPlus.in_seized_property_sales_registry', 'company_enterprise.27'],
  ['kzCoTrustworthyPlus.rehabilitation_proceedings', 'company_enterprise.28'],
  ['kzCoTrustworthyPlus.creditor_meeting_announcements_for_rehab', 'company_enterprise.29'],
  ['kzCoTrustworthyPlus.creditors_meeting_in_bankruptcy', 'company_enterprise.30'],
  ['riskFactor.company.bankruptcy_decision', 'company_enterprise.31'],
  ['riskFactor.company.bankruptcy_liquidation', 'company_enterprise.32'],
  ['riskFactor.company.bankruptcy_rehabilitation', 'company_enterprise.33'],
  ['riskFactor.company.bankruptcy_recovery_terminations', 'company_enterprise.34'],
  ['trustworthyExtended.large_taxpayer', 'company_finance.01'],
  ['riskFactor.company.enforcement_debt', 'company_finance.02'],
  ['riskFactor.company.irresponsible_taxpayer', 'company_finance.03'],
  ['riskFactor.company.ban_leaving', 'company_finance.04'],
  ['basic.unreliable_zakup', 'company_procurement.04'],
  ['riskFactorExtended.company.zakup.unreliable_suppliers_register.samruk', 'company_procurement.07'],
  ['riskFactor.head.enforcement_debt', 'director.02'],
  ['riskFactor.head.ban_leaving', 'director.03'],
  ['riskFactor.head.seized_bank_account', 'director.05'],
  ['riskFactor.head.seized_property', 'director.06'],
  ['riskFactor.head.ban_registration_actions_physical_ent', 'director.08'],
  ['riskFactor.head.ban_notarius_actions', 'director.09'],
  ['riskFactor.head.pedophile', 'director.12'],
  ['riskFactor.head.terrorist', 'director.13'],
  ['riskFactor.head.missing', 'director.15'],
  ['riskFactor.head.citizen_hiding_from_investigation', 'director.16'],
  ['riskFactor.head.alimony_payer', 'director.18'],
  ['kzCoTrustworthyPlus.same_director_problem_company', 'director.23'],
];

/** A debtor-register entry does not establish that the person is wanted. Keep that distinction. */
export const ADATA_RATE76_EXTRA_BOOLEAN_BINDINGS = [
  ['riskFactor.head.debtor_for_executive_documents', 'director', 'Debtor under an enforcement document'],
  ['riskFactor.head.terrorism_involved', 'director', 'On the list of persons involved in terrorist activity'],
  ['riskFactor.company.ban_seized_property_actions', 'company_enterprise', 'Ban on sale of arrested property'],
  ['riskFactor.head.ban_seized_property_actions', 'director', 'Ban on sale of arrested property'],
] as const;

export interface AdataDiligenceContext { bin: string; companyName: string; isTestData: boolean }
export interface NormalizedAdataDiligence {
  evidence: DiligenceEvidence[];
  evaluation: DiligenceEvaluation | null;
  isTestData: boolean;
  schemaSha256: typeof ADATA_DILIGENCE_SCHEMA_SHA256;
  operations: readonly number[];
}
function context(options: AdataDiligenceContext): void {
  if (!/^[0-9]{12}$/.test(options.bin) || typeof options.isTestData !== 'boolean') return invalid('invalid_context');
  text(options.companyName);
}
function checkContext(data: Record<string, unknown>, options: AdataDiligenceContext, catalogId: string | null, group: DiligenceGroup, checkName: string, sourceOrder: number, period?: string) {
  const subjectName = group === 'director' ? text(at(data, 'basic.fullname_director')) : options.companyName;
  return { group, subjectIndex: 0, subjectName, catalogId, checkName, sourceOrder, ...(period ? { period } : {}) };
}
function result(evidence: DiligenceEvidence[], options: AdataDiligenceContext, operations: readonly number[]): NormalizedAdataDiligence {
  let evaluated: DiligenceEvaluation | null;
  try { evaluated = evidence.length ? evaluateReceivedDiligence(evidence) : null; }
  catch (error) { if (error instanceof InvalidDiligenceEvidence) return invalid(error.reason); throw error; }
  return { evidence, evaluation: evaluated?.checks.some(check => check.mark !== 'no_answer') ? evaluated : null, isTestData: options.isTestData, schemaSha256: ADATA_DILIGENCE_SCHEMA_SHA256, operations };
}

/** Rate76 full company info. A missing module is absent; an explicit null check is no-answer. */
export function normalizeAdataCompanyInfo(data: unknown, options: AdataDiligenceContext): NormalizedAdataDiligence {
  context(options);
  if (!object(data)) return invalid('invalid_company_info');
  if (Object.values(data).every(value => value === null)) return result([], options, [76]);
  if (at(data, 'basic.biin') !== options.bin) return invalid('source_bin_mismatch');
  const evidence: DiligenceEvidence[] = [];
  for (const [path, catalogId, period] of ADATA_RATE76_BOOLEAN_BINDINGS) {
    const value = at(data, path);
    if (value === undefined) continue;
    const definition = diligenceDefinition(catalogId)!;
    const row = checkContext(data, options, catalogId, definition.group, definition.title + (period ? ` — ${period}` : ''), evidence.length, period);
    if (value === null) evidence.push({ ...row, kind: 'no_answer' });
    else if (typeof value === 'boolean') evidence.push({ ...row, kind: 'boolean', value });
    else return invalid('invalid_boolean');
  }
  for (const [path, group, checkName] of ADATA_RATE76_EXTRA_BOOLEAN_BINDINGS) {
    const value = at(data, path);
    if (value === undefined) continue;
    const row = checkContext(data, options, null, group, checkName, evidence.length);
    if (value === null) evidence.push({ ...row, kind: 'no_answer' });
    else if (typeof value === 'boolean') evidence.push({ ...row, kind: 'boolean', value });
    else return invalid('invalid_boolean');
  }
  const addCounter = (path: string, id: string, scored: boolean) => {
    const raw = at(data, path);
    if (raw === undefined) return;
    const definition = diligenceDefinition(id)!, value = counter(raw);
    const row = checkContext(data, options, id, definition.group, definition.title, evidence.length);
    if (value === null) evidence.push({ ...row, kind: 'no_answer' });
    else evidence.push(scored ? { ...row, kind: 'boolean', value: positive(value), recordedValue: value } : { ...row, kind: 'count', value });
  };
  addCounter('kzCoTrustworthyPlus.mass_address', 'company_enterprise.01', false);
  addCounter('trustworthyExtended.sanction_count', 'company_enterprise.35', true);
  const debt = at(data, 'riskFactor.head.tax_debt');
  if (debt !== undefined) {
    const amount = exactAdataDecimal(debt), definition = diligenceDefinition('director.04')!;
    const row = checkContext(data, options, definition.id, 'director', definition.title, evidence.length);
    if (amount === null) evidence.push({ ...row, kind: 'no_answer' });
    else if (amount.startsWith('-') && positive(amount)) return invalid('negative_debt');
    else evidence.push({ ...row, kind: 'boolean', value: positive(amount), recordedValue: amount });
  }
  const degree = at(data, 'riskFactor.company.tax_risk_degree');
  if (degree !== undefined) {
    const row = checkContext(data, options, null, 'company_finance', 'Taxpayer risk degree', evidence.length);
    if (degree === null) evidence.push({ ...row, kind: 'no_answer' });
    else {
      const recordedValue = text(degree), key = recordedValue.trim().toLowerCase();
      const low = ['low', 'низкая', 'низкий', 'төмен'], medium = ['medium', 'средняя', 'средний', 'орташа'];
      const high = ['high', 'высокая', 'высокий', 'жоғары'];
      evidence.push({ ...row, kind: 'risk_degree', value: low.includes(key) ? 'low' : medium.includes(key) ? 'medium' : high.includes(key) ? 'high' : key, recordedValue });
    }
  }
  for (const [path, id] of [['litigation', 'company_enterprise.36'], ['riskFactor.head.litigation', 'director.01']] as const) {
    const court = at(data, path);
    if (court === undefined || court === null) continue;
    if (!object(court)) return invalid('invalid_court_counts');
    const definition = diligenceDefinition(id)!;
    const row = checkContext(data, options, id, definition.group, definition.title, evidence.length);
    // The nested court component follows documented rate12, including its APPK count.
    evidence.push({ ...row, kind: 'court_counts', civil: counter(court.total_civil_count), criminal: counter(court.total_criminal_count), administrative: counter(court.total_administrative_count), appk: counter(court.total_appk_count) });
  }
  const contract = at(data, 'contract');
  if (contract !== undefined && contract !== null) {
    if (!object(contract)) return invalid('invalid_contract_totals');
    if (Object.hasOwn(contract, 'total_count') || Object.hasOwn(contract, 'total_sum')) {
      const definition = diligenceDefinition('company_procurement.09')!;
      evidence.push({ ...checkContext(data, options, definition.id, definition.group, definition.title, evidence.length), kind: 'contracts', count: counter(contract.total_count), sum: exactAdataDecimal(contract.total_sum) });
    }
  }
  return result(evidence, options, [76]);
}

/** Rate120 only: never infer payroll or combined totals from rate3 tax deductions. */
export function normalizeAdataTaxPayments(data: unknown, options: AdataDiligenceContext): NormalizedAdataDiligence {
  context(options);
  if (!object(data)) return invalid('invalid_tax_payments');
  if (!Object.hasOwn(data, 'details') || data.details === null) return result([], options, [120]);
  if (!Array.isArray(data.details) || data.details.length > 1000) return invalid('invalid_tax_years');
  const evidence: DiligenceEvidence[] = data.details.map((raw: unknown, sourceOrder: number) => {
    if (!object(raw)) return invalid('invalid_tax_row');
    const yearString = counter(raw.year);
    if (yearString === null || !/^\d{1,4}$/.test(yearString) || Number(yearString) < 1) return invalid('invalid_tax_year');
    return { group: 'company_tax', subjectIndex: 0, subjectName: options.companyName, catalogId: null, checkName: `Tax payments — ${yearString}`, sourceOrder, kind: 'tax_payment', year: Number(yearString), tax: exactAdataDecimal(raw.amount_other), payroll: exactAdataDecimal(raw.amount_fot), total: exactAdataDecimal(raw.amount) };
  });
  return result(evidence, options, [120]);
}

/** Rate119 only. No worker/network/module entitlement is implied by an adapter existing. */
export function normalizeAdataTaxRegime(data: unknown, options: AdataDiligenceContext): NormalizedAdataDiligence {
  context(options);
  if (!object(data)) return invalid('invalid_tax_regime');
  if (!Object.hasOwn(data, 'tax_mode')) return result([], options, [119]);
  const row = { group: 'company_tax' as const, subjectIndex: 0, subjectName: options.companyName, catalogId: null, checkName: 'Tax regime', sourceOrder: 0 };
  return result([data.tax_mode === null ? { ...row, kind: 'no_answer' } : { ...row, kind: 'tax_regime', value: text(data.tax_mode) }], options, [119]);
}

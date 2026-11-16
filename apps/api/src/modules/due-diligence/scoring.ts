import {
  DILIGENCE_CATALOG_VERSION,
  DILIGENCE_GROUPS,
  diligenceDefinition,
  diligenceDefinitionByTitle,
  isDiligenceShownOnlyTitle,
  type DiligenceDefinition,
  type DiligenceGroup,
} from './catalog.js';

export type DiligenceMark = 'clear' | 'finding' | 'shown_only' | 'no_answer';
export type DiligenceResult = 'green' | 'amber' | 'red';
interface EvidenceContext {
  group: DiligenceGroup;
  /** Per group, not a deduplication key for a person's name or identity. */
  subjectIndex: number;
  subjectName: string;
  sourceOrder: number;
  catalogId: string | null;
  checkName: string;
  /** The source's own period label, when one catalog rule has separate period checks. */
  period?: string;
}
export type DiligenceEvidence = EvidenceContext &
  (
    | { kind: 'boolean'; value: boolean; recordedValue?: string }
    | { kind: 'no_answer' }
    | { kind: 'count'; value: string }
    | {
        kind: 'court_counts';
        civil: string | null;
        criminal: string | null;
        administrative: string | null;
        appk: string | null;
      }
    | { kind: 'contracts'; count: string | null; sum: string | null }
    | { kind: 'tax_payment'; year: number; tax: string | null; payroll: string | null; total: string | null }
    | { kind: 'tax_regime'; value: string }
    | { kind: 'risk_degree'; value: string; recordedValue?: string }
  );
export interface EvaluatedDiligenceCheck {
  group: DiligenceGroup;
  subjectName: string;
  checkName: string;
  catalogId: string | null;
  adataValue: string | null;
  mark: DiligenceMark;
  attention: boolean;
  position: number;
}
export interface DiligenceGroupSummary {
  group: DiligenceGroup;
  checks: number;
  findings: number;
  attention: number;
  noAnswer: number;
}
export interface DiligenceEvaluation {
  catalogVersion: typeof DILIGENCE_CATALOG_VERSION;
  automaticResult: DiligenceResult;
  checks: EvaluatedDiligenceCheck[];
  groups: DiligenceGroupSummary[];
}

/** Invalid/misbound normalized evidence is quarantined by the connector, never scored as yes/no. */
export class InvalidDiligenceEvidence extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'InvalidDiligenceEvidence';
  }
}
const invalid = (reason: string): never => {
  throw new InvalidDiligenceEvidence(reason);
};
function sourceText(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 10_000 ||
    value.includes('\0') ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  )
    return invalid('invalid_source_text');
  // Spelling and significant source spacing remain intact in the stored value/history.
  return value;
}
function count(value: string): boolean {
  if (typeof value !== 'string' || value.length > 1000 || !/^\d+$/u.test(value)) return invalid('invalid_count');
  return /[1-9]/u.test(value);
}
function decimal(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 1000 || !/^[+-]?\d+(?:\.\d+)?$/u.test(value))
    return invalid('invalid_decimal');
  return value;
}
function definitionFor(line: DiligenceEvidence): DiligenceDefinition | undefined {
  const row =
    line.catalogId === null
      ? diligenceDefinitionByTitle(line.group, line.checkName)
      : diligenceDefinition(line.catalogId);
  if (line.catalogId !== null && !row) return invalid('unknown_catalog_id');
  const table = line.group === 'beneficiary' ? 'founder' : line.group;
  if (row && row.group !== table) return invalid('catalog_group_mismatch');
  return row;
}
type ScoredValue = Pick<EvaluatedDiligenceCheck, 'adataValue' | 'mark' | 'attention'>;
const noAnswer = (): ScoredValue => ({ adataValue: null, mark: 'no_answer', attention: false });
const shown = (adataValue: string, attention: boolean): ScoredValue => ({ adataValue, mark: 'shown_only', attention });
/** IMBC-14: an attention-bearing no/zero is clear; unconditionally displayed tax facts use shown(). */
const attentionValue = (adataValue: string, positive: boolean): ScoredValue =>
  positive ? shown(adataValue, true) : { adataValue, mark: 'clear', attention: false };
function score(
  line: DiligenceEvidence,
  definition: DiligenceDefinition | undefined,
  latestTaxYear: number | undefined,
): ScoredValue {
  if (line.kind === 'no_answer') return noAnswer();
  if (line.kind === 'boolean') {
    if (typeof line.value !== 'boolean') return invalid('invalid_boolean');
    const value = line.recordedValue === undefined ? String(line.value) : sourceText(line.recordedValue);
    // IMBC-10: newly added yes/no checks are scored, except exact known shown-only titles.
    if (definition?.policy === 'shown_only' || isDiligenceShownOnlyTitle(line.checkName))
      return attentionValue(value, line.value);
    return { adataValue: value, mark: line.value ? 'finding' : 'clear', attention: false };
  }
  if (line.kind === 'risk_degree') {
    if (definition || !['company_enterprise', 'company_finance'].includes(line.group))
      return invalid('risk_degree_group_mismatch');
    const value = sourceText(line.value),
      degree = value.trim().toLowerCase();
    return {
      adataValue: line.recordedValue === undefined ? value : sourceText(line.recordedValue),
      mark: degree === 'low' ? 'clear' : degree === 'medium' ? 'shown_only' : 'finding',
      attention: degree === 'medium',
    };
  }
  if (line.kind === 'tax_payment') {
    if (line.group !== 'company_tax') return invalid('tax_group_mismatch');
    const tax = decimal(line.tax),
      payroll = decimal(line.payroll),
      total = decimal(line.total);
    if (tax === null && payroll === null && total === null) return noAnswer();
    const adataValue = JSON.stringify({ year: line.year, tax, payroll, total });
    if (line.year !== latestTaxYear) return shown(adataValue, false);
    // A returned partial year remains a row with its exact available amounts. It is not a
    // no-response row, and a missing total cannot be inferred from tax/payroll or scored zero.
    if (total === null) return shown(adataValue, false);
    return { adataValue, mark: /[1-9]/u.test(total) ? 'clear' : 'finding', attention: false };
  }
  if (line.kind === 'tax_regime') {
    if (line.group !== 'company_tax') return invalid('tax_group_mismatch');
    return shown(sourceText(line.value), false);
  }
  if (definition?.policy !== 'shown_only' && !isDiligenceShownOnlyTitle(line.checkName))
    return invalid('non_boolean_scored_line');
  if (line.kind === 'count') return attentionValue(line.value, count(line.value));
  if (line.kind === 'court_counts') {
    if (definition?.title !== 'Participation in court cases' && line.checkName !== 'Participation in court cases')
      return invalid('court_count_catalog_mismatch');
    const counts = { civil: line.civil, criminal: line.criminal, administrative: line.administrative, appk: line.appk };
    const values = Object.values(counts).filter((value): value is string => value !== null);
    if (!values.length) return noAnswer();
    const positives = values.map(count);
    return attentionValue(JSON.stringify(counts), positives.some(Boolean));
  }
  if (line.kind === 'contracts') {
    if (definition?.title !== 'Concluded contracts' && line.checkName !== 'Concluded contracts')
      return invalid('contract_catalog_mismatch');
    const sum = decimal(line.sum);
    if (line.count === null)
      return sum === null ? noAnswer() : shown(JSON.stringify({ count: null, sum }), false);
    const positive = count(line.count);
    return attentionValue(JSON.stringify({ count: line.count, sum }), positive);
  }
  return invalid('unsupported_evidence_kind');
}

/** Only already normalized check evidence. No network, raw report traversal, database or provider secret. */
export function evaluateReceivedDiligence(evidence: readonly DiligenceEvidence[]): DiligenceEvaluation {
  if (!Array.isArray(evidence)) return invalid('invalid_evidence_list');
  const latestYears = new Map<number, number>();
  const observedTaxYears = new Set<string>();
  const subjects = new Map<string, string>();
  const lineKeys = new Set<string>();
  const prepared = evidence.map((line, index) => {
    if (
      !line ||
      !DILIGENCE_GROUPS.includes(line.group) ||
      !Number.isInteger(line.subjectIndex) ||
      line.subjectIndex < 0 ||
      !Number.isInteger(line.sourceOrder) ||
      line.sourceOrder < 0
    )
      return invalid('invalid_evidence_context');
    if (line.group.startsWith('company_') && line.subjectIndex !== 0) return invalid('multiple_company_subjects');
    sourceText(line.subjectName);
    sourceText(line.checkName);
    if (line.period !== undefined) sourceText(line.period);
    const subjectKey = `${line.group}:${line.subjectIndex}`;
    if (subjects.has(subjectKey) && subjects.get(subjectKey) !== line.subjectName)
      return invalid('subject_name_conflict');
    subjects.set(subjectKey, line.subjectName);
    const definition = definitionFor(line);
    const lineKey = JSON.stringify([
      subjectKey,
      definition?.id ?? line.checkName,
      line.kind === 'tax_payment' ? line.year : null,
      line.period ?? null,
    ]);
    if (lineKeys.has(lineKey)) return invalid('duplicate_check');
    lineKeys.add(lineKey);
    if (line.kind === 'tax_payment') {
      if (line.group !== 'company_tax' || !Number.isInteger(line.year) || line.year < 1 || line.year > 9999)
        return invalid('invalid_tax_year');
      const key = `${line.subjectIndex}:${line.year}`;
      if (observedTaxYears.has(key)) return invalid('duplicate_tax_year');
      observedTaxYears.add(key);
      latestYears.set(line.subjectIndex, Math.max(latestYears.get(line.subjectIndex) ?? 0, line.year));
    }
    return { line, definition, index };
  });
  prepared.sort(
    (a, b) =>
      DILIGENCE_GROUPS.indexOf(a.line.group) - DILIGENCE_GROUPS.indexOf(b.line.group) ||
      a.line.subjectIndex - b.line.subjectIndex ||
      (a.definition?.position ?? 1000 + a.line.sourceOrder) - (b.definition?.position ?? 1000 + b.line.sourceOrder) ||
      a.index - b.index,
  );
  const checks = prepared.map(({ line, definition }, position): EvaluatedDiligenceCheck => ({
    group: line.group,
    subjectName: line.subjectName,
    checkName: line.checkName,
    catalogId: definition?.id ?? null,
    ...score(line, definition, latestYears.get(line.subjectIndex)),
    position,
  }));
  const groups = DILIGENCE_GROUPS.flatMap((group): DiligenceGroupSummary[] => {
    const rows = checks.filter((row) => row.group === group);
    return rows.length
      ? [
          {
            group,
            checks: rows.length,
            findings: rows.filter((row) => row.mark === 'finding').length,
            attention: rows.filter((row) => row.attention).length,
            noAnswer: rows.filter((row) => row.mark === 'no_answer').length,
          },
        ]
      : [];
  });
  return {
    catalogVersion: DILIGENCE_CATALOG_VERSION,
    automaticResult: checks.some((row) => row.mark === 'finding')
      ? 'red'
      : checks.some((row) => row.attention)
        ? 'amber'
        : 'green',
    checks,
    groups,
  };
}

export type DiligenceConnectorRun =
  | { state: 'received'; isTestData: boolean; evidence: readonly DiligenceEvidence[] }
  | { state: 'unavailable' | 'modules_not_connected' | 'waiting'; isTestData: boolean };
export type DiligenceConnectorEvaluation =
  | { state: 'received'; isTestData: boolean; evaluation: DiligenceEvaluation }
  | { state: 'unavailable' | 'modules_not_connected' | 'waiting'; isTestData: boolean; evaluation: null };
/** A transport/module failure produces no automatic result and cannot replace a current DD record with green. */
export function evaluateDiligenceConnector(run: DiligenceConnectorRun): DiligenceConnectorEvaluation {
  if (typeof run.isTestData !== 'boolean') return invalid('missing_test_data_flag');
  if (run.state === 'received')
    return { state: run.state, isTestData: run.isTestData, evaluation: evaluateReceivedDiligence(run.evidence) };
  if (!['unavailable', 'modules_not_connected', 'waiting'].includes(run.state))
    return invalid('invalid_connector_state');
  return { state: run.state, isTestData: run.isTestData, evaluation: null };
}

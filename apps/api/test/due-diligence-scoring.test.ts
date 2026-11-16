import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DILIGENCE_CATALOG, DILIGENCE_GROUPS, type DiligenceGroup } from '../src/modules/due-diligence/catalog.js';
import { MockDiligenceConnector } from '../src/modules/due-diligence/mocks.js';
import {
  evaluateDiligenceConnector,
  evaluateReceivedDiligence,
  InvalidDiligenceEvidence,
  type DiligenceEvidence,
} from '../src/modules/due-diligence/scoring.js';

const definition = (title: string, group: DiligenceGroup = 'company_enterprise') =>
  DILIGENCE_CATALOG.find((row) => row.group === group && row.title === title)!;
const boolean = (title: string, value: boolean, group: DiligenceGroup = 'company_enterprise'): DiligenceEvidence => ({
  group,
  subjectIndex: 0,
  subjectName: 'Synthetic subject',
  sourceOrder: 0,
  catalogId: definition(title, group).id,
  checkName: title,
  kind: 'boolean',
  value,
});
const extra = (name: string, group: DiligenceGroup = 'company_finance') => ({
  group,
  subjectIndex: 0,
  subjectName: 'Synthetic subject',
  sourceOrder: 0,
  catalogId: null,
  checkName: name,
});
const tax = (year: number, total: string | null): DiligenceEvidence => ({
  ...extra('Tax payments', 'company_tax'),
  sourceOrder: year,
  kind: 'tax_payment',
  year,
  tax: '001.2300',
  payroll: null,
  total,
});

describe('IMBC-10/11/14 canonical diligence data and scoring', () => {
  it('matches every ordered title and policy in the current canonical specification, including all founder checks', () => {
    const text = readFileSync(
      new URL('../../../docs/analyst/2026-11-13/specification-v1.4.md', import.meta.url),
      'utf8',
    )
      .split('### 6.5 Due diligence')[1]!
      .split('### 6.6 External checks')[0]!;
    const headings: Record<string, string> = {
      '**Company. Enterprise.**': 'company_enterprise',
      '**Company. Finance.**': 'company_finance',
      '**Company. Procurement.**': 'company_procurement',
      '**Director.**': 'director',
      '**Founder, and each beneficiary.**': 'founder',
    };
    let group: string | null = null;
    const expected: { group: string; title: string; policy: string }[] = [];
    for (const line of text.split('\n')) {
      if (headings[line]) group = headings[line]!;
      else if (line.startsWith('**Company. Tax payments.**')) group = null;
      else if (group && line.startsWith('| ')) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim());
        if (cells[1] === 'Scored' || cells[1] === 'Shown only')
          expected.push({ group, title: cells[0]!, policy: cells[1] === 'Scored' ? 'scored' : 'shown_only' });
      }
    }
    expect(DILIGENCE_CATALOG.map(({ group, title, policy }) => ({ group, title, policy }))).toEqual(expected);
    expect(expected).toHaveLength(116);
    expect(expected.filter((row) => row.policy === 'shown_only')).toHaveLength(15);
    expect(DILIGENCE_GROUPS.map((group) => DILIGENCE_CATALOG.filter((row) => row.group === group).length)).toEqual([
      41, 5, 13, 0, 23, 34, 0,
    ]);
  });
  it('a received no-response row is retained without a finding and omitted checks do not become clear rows', () => {
    const line = { ...boolean('Bankrupt', true), kind: 'no_answer' as const };
    const result = evaluateReceivedDiligence([line]);
    expect(result.automaticResult).toBe('green');
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ mark: 'no_answer', adataValue: null, attention: false });
    expect(result.groups).toEqual([{ group: 'company_enterprise', checks: 1, findings: 0, attention: 0, noAnswer: 1 }]);
  });
  it('implements the report sample: mass address plus director/founder court remarks are amber, not findings', () => {
    const evidence: DiligenceEvidence[] = [
      boolean('Mass registration address', true),
      { ...boolean('Participation in court cases', false), kind: 'no_answer' },
      boolean('Bankrupt', false),
      {
        ...boolean('Participation in court cases', false, 'director'),
        kind: 'court_counts',
        civil: '2',
        criminal: '0',
        administrative: null,
        appk: '0',
      },
      {
        ...boolean('Participation in court cases', false, 'founder'),
        kind: 'court_counts',
        civil: '0',
        criminal: '0',
        administrative: '1',
        appk: '0',
      },
    ];
    const result = evaluateReceivedDiligence(evidence);
    expect(result.automaticResult).toBe('amber');
    expect(result.checks.filter((row) => row.attention)).toHaveLength(3);
    expect(result.checks.filter((row) => row.mark === 'finding')).toHaveLength(0);
    expect(result.checks.find((row) => row.group === 'director')!.adataValue).toContain('"civil":"2"');
    expect(
      evaluateReceivedDiligence([...evidence, boolean('Tax and customs arrears', true, 'company_finance')])
        .automaticResult,
    ).toBe('red');
  });
  it('marks every attention-bearing false/zero as clear, while positive values remain shown only', () => {
    const rows: DiligenceEvidence[] = [
      boolean('Mass registration address', false),
      { ...boolean('Administrative fines', false), kind: 'count', value: '000' },
      {
        ...boolean('Participation in court cases', false, 'director'),
        kind: 'court_counts',
        civil: '0',
        criminal: '000',
        administrative: '0',
        appk: '0',
      },
      { ...boolean('Concluded contracts', false, 'company_procurement'), kind: 'contracts', count: '0', sum: '0.000' },
    ];
    const cleared = evaluateReceivedDiligence(rows);
    expect(cleared.automaticResult).toBe('green');
    expect(cleared.checks.every((row) => row.mark === 'clear' && !row.attention)).toBe(true);
    const positive: DiligenceEvidence[] = [
      boolean('Mass registration address', true),
      { ...boolean('Administrative fines', false), kind: 'count', value: '1' },
      {
        ...boolean('Participation in court cases', false, 'director'),
        kind: 'court_counts',
        civil: '0',
        criminal: '0',
        administrative: '0',
        appk: '1',
      },
      { ...boolean('Concluded contracts', false, 'company_procurement'), kind: 'contracts', count: '1', sum: '100.00' },
    ];
    const attention = evaluateReceivedDiligence(positive);
    expect(attention.automaticResult).toBe('amber');
    expect(attention.checks.every((row) => row.mark === 'shown_only' && row.attention)).toBe(true);
  });
  it('keeps the same person in director, founder and beneficiary tables without name-based deduplication', () => {
    const line = boolean('Participation in court cases', true, 'founder');
    const result = evaluateReceivedDiligence([
      { ...line, group: 'beneficiary' },
      { ...line, subjectIndex: 1 },
      boolean('Participation in court cases', true, 'director'),
      line,
    ]);
    expect(result.checks.map((row) => row.group)).toEqual(['director', 'founder', 'founder', 'beneficiary']);
    expect(result.checks.every((row) => row.subjectName === 'Synthetic subject')).toBe(true);
    expect(result.checks.map((row) => row.position)).toEqual([0, 1, 2, 3]);
  });
  it('uses all four court counts, including APPK, and retains zero/unknown values exactly', () => {
    const base = boolean('Participation in court cases', false, 'director');
    const line: DiligenceEvidence = {
      ...base,
      kind: 'court_counts',
      civil: null,
      criminal: '000',
      administrative: '0',
      appk: '9007199254740993',
    };
    const result = evaluateReceivedDiligence([line]);
    expect(result.automaticResult).toBe('amber');
    expect(JSON.parse(result.checks[0]!.adataValue!)).toEqual({
      civil: null,
      criminal: '000',
      administrative: '0',
      appk: '9007199254740993',
    });
    expect(evaluateReceivedDiligence([{ ...line, appk: '000' }]).automaticResult).toBe('green');
  });
  it('scores a newly added boolean and applies known shown-only titles in any provider group', () => {
    const newCheck: DiligenceEvidence = { ...extra('New provider check'), kind: 'boolean', value: true };
    expect(evaluateReceivedDiligence([newCheck]).automaticResult).toBe('red');
    const shown: DiligenceEvidence = { ...extra('  Mass   registration address  '), kind: 'boolean', value: true };
    expect(evaluateReceivedDiligence([shown]).checks[0]).toMatchObject({
      catalogId: null,
      mark: 'shown_only',
      attention: true,
    });
    expect(evaluateReceivedDiligence([{ ...newCheck, value: false }]).automaticResult).toBe('green');
  });
  it('orders canonical checks independently of response key order and keeps actual inspection-period titles', () => {
    const inspection = DILIGENCE_CATALOG.find((row) => row.title.startsWith('On the list of labour inspections'))!;
    const result = evaluateReceivedDiligence([
      boolean('Bankrupt', false),
      { ...boolean(inspection.title, true), checkName: 'Labour inspections for 2027 H1' },
      boolean('Mass registration address', false),
    ]);
    expect(result.checks.map((row) => row.catalogId)).toEqual([
      definition('Mass registration address').id,
      inspection.id,
      definition('Bankrupt').id,
    ]);
    expect(result.checks[1]!.checkName).toBe('Labour inspections for 2027 H1');
  });
  it('keeps contract aggregate count/sum without a contract-by-contract list or precision loss', () => {
    const line: DiligenceEvidence = {
      ...boolean('Concluded contracts', false, 'company_procurement'),
      kind: 'contracts',
      count: '0002',
      sum: '12345678901234567890.4500',
    };
    const result = evaluateReceivedDiligence([line]);
    expect(result.automaticResult).toBe('amber');
    expect(JSON.parse(result.checks[0]!.adataValue!)).toEqual({ count: '0002', sum: '12345678901234567890.4500' });
    expect(evaluateReceivedDiligence([{ ...line, count: '0' }]).automaticResult).toBe('green');
  });
  it('scores zero only in the numerically latest tax year, including a partial current year', () => {
    const rows = [tax(2026, '+000.0000'), tax(2024, '100.000'), tax(2025, '200.000')];
    const result = evaluateReceivedDiligence(rows);
    expect(result.automaticResult).toBe('red');
    expect(result.checks.filter((row) => row.mark === 'finding')).toHaveLength(1);
    expect(JSON.parse(result.checks.find((row) => row.mark === 'finding')!.adataValue!).year).toBe(2026);
    expect(
      evaluateReceivedDiligence([tax(2024, '0'), tax(2026, '0.000000000001'), tax(2025, '0')]).automaticResult,
    ).toBe('green');
    expect(evaluateReceivedDiligence([tax(2026, '-0.000')]).automaticResult).toBe('red');
  });
  it('retains returned partial tax-year fields and missing total without inferring zero or an answer', () => {
    const result = evaluateReceivedDiligence([
      tax(2025, '0'),
      tax(2026, null),
      { ...extra('Tax regime', 'company_tax'), kind: 'tax_regime', value: 'Recorded regime' },
    ]);
    expect(result.automaticResult).toBe('green');
    expect(result.checks).toHaveLength(3);
    expect(
      JSON.parse(
        result.checks.find((row) => row.checkName === 'Tax payments' && JSON.parse(row.adataValue!).year === 2026)!
          .adataValue!,
      ),
    ).toEqual({ year: 2026, tax: '001.2300', payroll: null, total: null });
    expect(result.checks.every((row) => row.mark === 'shown_only' && !row.attention)).toBe(true);
  });
  it.each([
    ['low', 'green', 'clear'],
    ['medium', 'amber', 'shown_only'],
    ['high', 'red', 'finding'],
    ['unexpected degree', 'red', 'finding'],
  ] as const)(
    'handles taxpayer degree %s and keeps the source spelling for history',
    (value, automaticResult, mark) => {
      const result = evaluateReceivedDiligence([
        { ...extra('Taxpayer risk degree'), kind: 'risk_degree', value, recordedValue: 'Исходная степень' },
      ]);
      expect(result.automaticResult).toBe(automaticResult);
      expect(result.checks[0]).toMatchObject({ mark, adataValue: 'Исходная степень' });
    },
  );
  it('rejects duplicate/misbound checks and unsafe normalized values instead of silently scoring them', () => {
    const line = boolean('Bankrupt', false);
    for (const rows of [
      [line, line],
      [{ ...line, group: 'director' }],
      [{ ...line, catalogId: 'unknown.id' }],
      [{ ...line, value: 'false' }],
      [{ ...line, checkName: 'unsafe\0title' }],
      [tax(2026, '1e10')],
      [tax(2026, '0'), tax(2026, '1')],
      [{ ...line, kind: 'count', value: '1' }],
      [{ ...line, subjectIndex: 1 }],
    ])
      expect(() => evaluateReceivedDiligence(rows as DiligenceEvidence[])).toThrow(InvalidDiligenceEvidence);
  });
  it.each(['unavailable', 'modules_not_connected', 'waiting'] as const)(
    'transport state %s produces no green record or findings',
    (state) => {
      expect(evaluateDiligenceConnector({ state, isTestData: false })).toEqual({
        state,
        isTestData: false,
        evaluation: null,
      });
    },
  );
  it.each(['green', 'amber', 'red', 'unavailable'] as const)(
    'mock %s is explicitly test data for either swappable connector',
    async (fixture) => {
      for (const code of ['accounting', 'legal_entity_registry'] as const) {
        const connector = new MockDiligenceConnector(code, fixture);
        const result = evaluateDiligenceConnector(await connector.run('160940010447'));
        expect(connector.isMock).toBe(true);
        expect(result.isTestData).toBe(true);
        if (fixture === 'unavailable') expect(result.evaluation).toBeNull();
        else expect(result.evaluation!.automaticResult).toBe(fixture);
        await expect(connector.run('invalid-bin')).rejects.toBeInstanceOf(InvalidDiligenceEvidence);
      }
    },
  );
});

import { describe, expect, it } from 'vitest';
import {
  lpsCompanyWriteSchema,
  lpsContactPhoneSchema,
  lpsContactWriteSchema,
  lpsEntryWriteSchema,
  lpsInvestmentSchema,
  lpsQuerySchema,
  parseLpsLaunch,
} from '../src/lps.js';

const id = '019a09ca-8650-7000-8000-000000000001';
describe('LPS nullable business facts', () => {
  it('preserves decimal precision and distinguishes zero from unknown', () => {
    expect(lpsInvestmentSchema.parse('000123456789123456789.001200')).toBe('123456789123456789.001200');
    expect(lpsInvestmentSchema.parse('0.00')).toBe('0.00');
    expect(lpsInvestmentSchema.parse('')).toBeNull();
    expect(lpsInvestmentSchema.parse(null)).toBeNull();
    for (const value of [0.1, '-1', '1e3', 'NaN', '1.'])
      expect(lpsInvestmentSchema.safeParse(value).success).toBe(false);
  });
  it('retains launch period precision with chronological range bounds', () => {
    expect(parseLpsLaunch('2027')).toEqual({
      kind: 'known',
      canonical: '2027',
      earliestQuarter: 8108,
      latestQuarter: 8111,
    });
    expect(parseLpsLaunch(' q4 2027/q1 2028 ')).toEqual({
      kind: 'known',
      canonical: 'Q4 2027 / Q1 2028',
      earliestQuarter: 8111,
      latestQuarter: 8112,
    });
    expect(parseLpsLaunch('TBD')?.kind).toBe('tbd');
    expect(parseLpsLaunch(null)?.kind).toBe('missing');
    for (const value of ['0000', 'Q0 2027', 'Q5 2027', 'Q2 2028 / Q4 2027', '2027-01-01', '2027 / 2028'])
      expect(parseLpsLaunch(value)).toBeNull();
  });
  it('normalizes methods without changing extension zeros or guessing a country', () => {
    expect(lpsContactPhoneSchema.parse('+7 (701) 234-56-78 ext 0004')).toBe('+77012345678 ext. 0004');
    expect(lpsContactPhoneSchema.safeParse('7012345678').success).toBe(false);
    expect(
      lpsContactWriteSchema.parse({ fullName: null, roleTitle: null, emails: [' BOX@EXAMPLE.LOCAL '], phones: [] })
        .emails,
    ).toEqual(['box@example.local']);
    expect(
      lpsContactWriteSchema.safeParse({ fullName: null, roleTitle: 'Director', emails: [], phones: [] }).success,
    ).toBe(false);
    expect(
      lpsContactWriteSchema.safeParse({
        fullName: null,
        roleTitle: null,
        emails: ['box@example.local', 'BOX@example.local'],
        phones: [],
      }).success,
    ).toBe(false);
  });
  it('requires only company, scope, status and preserves optional nulls', () => {
    const parsed = lpsEntryWriteSchema.parse({ companyId: id, scopeDescription: '  maintenance  ', statusId: id });
    expect(parsed).toMatchObject({
      scopeDescription: 'maintenance',
      plannedLaunch: null,
      investmentUsd: null,
      newJobs: null,
      lastUpdatedOn: null,
      contacts: [],
      locations: [],
    });
    expect(parsed.sourceTypeId).toBeUndefined();
    expect(lpsCompanyWriteSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(
      lpsEntryWriteSchema.safeParse({
        companyId: id,
        scopeDescription: 'scope',
        statusId: id,
        newJobs: 0,
        lastUpdatedOn: '2026-02-29',
      }).success,
    ).toBe(false);
    expect(
      lpsEntryWriteSchema.safeParse({ companyId: id, scopeDescription: 'scope', statusId: id, migrationKey: 'forged' })
        .success,
    ).toBe(false);
  });
  it('rejects duplicate paired locations and stealing a child by duplicate identity', () => {
    const base = { companyId: id, scopeDescription: 'scope', statusId: id };
    expect(
      lpsEntryWriteSchema.safeParse({
        ...base,
        locations: [
          { city: 'City', regionId: null },
          { city: ' City ', regionId: null },
        ],
      }).success,
    ).toBe(false);
    expect(
      lpsEntryWriteSchema.safeParse({
        ...base,
        contacts: [
          { id, fullName: 'A', roleTitle: null, emails: [], phones: [] },
          { id, fullName: 'B', roleTitle: null, emails: [], phones: [] },
        ],
      }).success,
    ).toBe(false);
  });
  it('parses repeatable URL filters and rejects unsupported filters or invalid bounds', () => {
    expect(
      lpsQuerySchema.parse({ countryIds: [id, 'unknown'], cities: 'Town', offset: '50', limit: '20' }),
    ).toMatchObject({ countryIds: [id, 'unknown'], cities: ['Town'], offset: 50, limit: 20 });
    expect(lpsQuerySchema.safeParse({ lastUpdatedFrom: '2026-11-02', lastUpdatedTo: '2026-11-01' }).success).toBe(
      false,
    );
    expect(lpsQuerySchema.safeParse({ bin: '123456789012' }).success).toBe(false);
  });
});

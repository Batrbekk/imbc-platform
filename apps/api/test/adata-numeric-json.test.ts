import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AdataClient } from '../src/modules/adata/adata.client.js';
import { InvalidAdataJson, parseAdataJson } from '../src/modules/adata/numeric-json.js';
import { companyInfoMatchesBin } from '../src/modules/adata/company-info.js';
import { parseAdataDiligenceJson } from '../src/modules/due-diligence/adata-normalizer.js';

describe('Lossless Adata transport', () => {
  it('preserves literal JSON money/counters through the actual HTTP client', async () => {
    const fetch: typeof globalThis.fetch = async () => new Response('{"message":"ready","data":{"basic":{"biin":"000000000000"},"contract":{"total_count":90071992547409930001,"total_sum":9007199254740993.0010},"tiny":1e-20,"zero":-0.00,"flag":false}}');
    const client = new AdataClient({ baseUrl: 'http://127.0.0.1:1', token: 'synthetic', requestTimeoutMs: 1000, fetch });
    expect(await client.checkCompanyInfo('synthetic-poll')).toEqual({ ready: true, data: { basic: { biin: '000000000000' }, contract: { total_count: '90071992547409930001', total_sum: '9007199254740993.0010' }, tiny: '1e-20', zero: '-0.00', flag: false } });
  });
  it('never repairs a numeric identity into the accepted requested string', () => {
    for (const parse of [parseAdataJson, parseAdataDiligenceJson]) {
      const value = parse('{"basic":{"biin":990100000001},"contract":{"total_sum":1.000}}') as { basic: { biin: unknown }; contract: { total_sum: unknown } };
      expect(typeof value.basic.biin).toBe('number');
      expect(companyInfoMatchesBin(value, '990100000001')).toBe(false);
      expect(value.contract.total_sum).toBe('1.000');
    }
  });
  it('fails closed if the runtime cannot provide the original number lexeme', () => {
    const original = JSON.parse;
    JSON.parse = ((body: string, reviver?: (key: string, value: unknown) => unknown) => original(body, reviver ? (key, value) => reviver(key, value) : undefined)) as typeof JSON.parse;
    try { expect(() => parseAdataJson('{"amount":9007199254740993.0010}')).toThrow('number_lexeme_unavailable'); }
    finally { JSON.parse = original; }
  });
  it('bounds bytes and excludes the private source body from every parse error representation', () => {
    const privateBody = 'synthetic-private-body';
    for (const body of [`{"amount":${privateBody}`, `"${'x'.repeat(5 * 1024 * 1024)}"`]) {
      try { parseAdataJson(body); expect.fail('Expected invalid source JSON'); }
      catch (error) {
        expect(error).toBeInstanceOf(InvalidAdataJson);
        expect(Object.hasOwn(error as object, 'cause')).toBe(false);
        for (const value of [String(error), JSON.stringify(error), inspect(error, { depth: 5, showHidden: true })]) expect(value).not.toContain(privateBody);
      }
    }
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ADATA_ALLOWANCE_RESET_DAY, allowancePeriodStart, reserveAllowance } from '../src/modules/adata/allowance.js';

describe('Квота Adata: период (IMBC-07)', () => {
  it('границы периода по Алматы (IMBC-07, DATA-08)', () => {
    expect(ADATA_ALLOWANCE_RESET_DAY).toBe(4);
    for (const [at, period] of [
      ['2026-12-03T18:59:59Z', '2026-11-04'],
      ['2026-12-03T19:00:00Z', '2026-12-04'],
      ['2026-11-12T08:00:00Z', '2026-11-04'],
      ['2027-01-03T12:00:00Z', '2026-12-04'],
      ['2027-01-04T00:00:00Z', '2027-01-04'],
      ['2026-03-01T00:00:00Z', '2026-02-04'],
    ] as const)
      expect(allowancePeriodStart(new Date(at)), at).toBe(period);
  });

  it('лимит 0 и меньше — false без обращения к БД', async () => {
    const execute = vi.fn();
    expect(await reserveAllowance({ execute }, '2026-11-04', 0)).toBe(false);
    expect(await reserveAllowance({ execute }, '2026-11-04', -1)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});

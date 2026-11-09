import { describe, expect, it } from 'vitest';
import {
  catalogFilterSchema,
  catalogFilterToSearchParams,
  checkBin,
  computeBinCheckDigit,
  normalizeCompanyName,
  POLICY_MATRIX,
  ROLES,
} from '../src/index.js';

describe('БИН (MAN-02, MIG-05)', () => {
  it('принимает БИН с верным контрольным разрядом', () => {
    const first11 = '98054000038';
    const digit = computeBinCheckDigit(first11);
    expect(digit).not.toBeNull();
    expect(checkBin(`${first11}${digit}`)).toEqual({ valid: true, bin: `${first11}${digit}` });
  });

  it('отклоняет неверный контрольный разряд', () => {
    const first11 = '98054000038';
    const wrong = ((computeBinCheckDigit(first11) ?? 0) + 1) % 10;
    expect(checkBin(`${first11}${wrong}`)).toEqual({ valid: false, reason: 'check_digit' });
  });

  it('отклоняет не 12 цифр', () => {
    expect(checkBin('12345')).toEqual({ valid: false, reason: 'format' });
    expect(checkBin('12345678901a')).toEqual({ valid: false, reason: 'format' });
  });
});

describe('нормализация имён (OPR-07)', () => {
  it('«ҚазМұнайГаз» совпадает с «КазМунайГаз»', () => {
    expect(normalizeCompanyName('ҚазМұнайГаз')).toBe(normalizeCompanyName('КазМунайГаз'));
  });

  it('отбрасывает ОПФ и кавычки', () => {
    expect(normalizeCompanyName('ТОО «Ақ Бұлақ Машинери»')).toBe('ак булак машинери');
    expect(normalizeCompanyName('«Kazakh Valves» LLP')).toBe('kazakh valves');
  });
});

describe('фильтры каталога (OPR-02…05)', () => {
  it('парсит списки из query string и обратно', () => {
    const parsed = catalogFilterSchema.parse({ group: 'A,C', surveyed: 'true', tnved: '8481', page: '2' });
    expect(parsed.group).toEqual(['A', 'C']);
    expect(parsed.surveyed).toBe(true);
    expect(parsed.page).toBe(2);
    expect(catalogFilterToSearchParams({ group: parsed.group, tnved: parsed.tnved }).toString()).toBe(
      'group=A%2CC&tnved=8481',
    );
  });

  it('отклоняет неизвестную товарную группу', () => {
    expect(() => catalogFilterSchema.parse({ group: 'Z' })).toThrow();
  });
});

describe('PolicyMatrix (GEN-03, GEN-04, GEN-13…15)', () => {
  it('у каждой роли есть запись', () => {
    for (const role of ROLES) expect(POLICY_MATRIX[role]).toBeDefined();
  });

  it('администратор не читает содержимое профилей и записи IMBC (D-51, ADM-06)', () => {
    expect(POLICY_MATRIX.administrator['profile.read']).toBeUndefined();
    expect(POLICY_MATRIX.administrator['imbc_records.read']).toBeUndefined();
    expect(POLICY_MATRIX.administrator['audit.read']).toBe('account_events');
  });

  it('директор только читает (GEN-04)', () => {
    const writes = Object.keys(POLICY_MATRIX.director).filter((a) =>
      /\.(edit|manage|verify|validate|write|send|answer|reply|take|assign|run|invite)$/.test(a),
    );
    expect(writes).toEqual([]);
  });

  it('наблюдатель не выгружает, не подписывается и не пишет (GEN-15)', () => {
    expect(Object.keys(POLICY_MATRIX.spectator).sort()).toEqual(['catalog.search', 'dashboard.read']);
  });

  it('оператор видит только видимые профили и не видит прогноз (OPR-01, D-24)', () => {
    expect(POLICY_MATRIX.operator['catalog.search']).toBe('visible');
    expect(POLICY_MATRIX.operator['forecast.read']).toBeUndefined();
  });

  it('ни одна роль не имеет всех прав (GEN-03)', () => {
    const allActions = new Set(Object.values(POLICY_MATRIX).flatMap((r) => Object.keys(r)));
    for (const role of ROLES) expect(Object.keys(POLICY_MATRIX[role]).length).toBeLessThan(allActions.size);
  });
});

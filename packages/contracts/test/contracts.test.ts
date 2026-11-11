import { describe, expect, it } from 'vitest';
import {
  type Action,
  can,
  catalogFilterSchema,
  catalogFilterToSearchParams,
  checkBin,
  computeBinCheckDigit,
  normalizeCompanyName,
  POLICY_MATRIX,
  ORGANIZATION_TYPES,
  ROLES,
  UPDATE_STATUSES,
} from '../src/index.js';

describe('перечисления v1.3 (раздел 3.1, UPD-06)', () => {
  it('observer вместо spectator, unresponsive вместо inactive', () => {
    expect(ROLES).toEqual(['manufacturer', 'expert', 'administrator', 'director', 'operator', 'observer']);
    expect(ORGANIZATION_TYPES).toEqual(['manufacturer', 'operator', 'observer', 'imbc']);
    expect(UPDATE_STATUSES).toEqual(['active', 'outdated', 'unresponsive']);
  });
});

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

describe('PolicyMatrix (раздел 4 v1.3; GEN-03, GEN-04, GEN-10, GEN-13)', () => {
  const row = (action: Action) => Object.fromEntries(ROLES.map((r) => [r, can(r, action)]));

  it('у каждой роли есть запись', () => {
    for (const role of ROLES) expect(POLICY_MATRIX[role]).toBeDefined();
  });

  it('наблюдатель: дашборд, список и тир — и больше ничего (GEN-13)', () => {
    expect(POLICY_MATRIX.observer).toEqual({
      'catalog.search': 'visible',
      'dashboard.read': 'visible',
      'tier.read': 'visible',
    });
  });

  it.each([
    'catalog.export',
    'subscriptions.manage',
    'pull_api.use',
    'forecast.read',
    'focal_point.read',
    'tier.read_products',
    'operator_marks.write',
    'operator_notes.read',
    'operator_notes.write',
    'imbc_request.send',
    'operator_request.send',
    'profile.read',
  ] as const)('наблюдателю запрещено %s (GEN-13)', (action) => expect(can('observer', action)).toBeNull());

  it('строка «Tier, AGAR, and CDP» (IMBC-22)', () => {
    expect(row('tier.read')).toEqual({
      manufacturer: 'own',
      expert: 'all',
      administrator: null,
      director: 'all',
      operator: 'visible',
      observer: 'visible',
    });
    expect(row('tier.read_products')).toEqual({
      manufacturer: 'own',
      expert: 'all',
      administrator: null,
      director: 'all',
      operator: 'visible',
      observer: null,
    });
    expect(row('tier.request')).toEqual({
      manufacturer: 'own',
      expert: null,
      administrator: null,
      director: null,
      operator: null,
      observer: null,
    });
    expect(row('tier.edit')).toEqual({
      manufacturer: null,
      expert: 'all',
      administrator: null,
      director: null,
      operator: null,
      observer: null,
    });
  });

  it('focal point: оператор видит, наблюдатель и администратор — нет (GEN-13, OPR-09)', () => {
    expect(row('focal_point.read')).toEqual({
      manufacturer: 'own',
      expert: 'all',
      administrator: null,
      director: 'all',
      operator: 'visible',
      observer: null,
    });
  });

  it('прогноз, STR и KTRE: производитель после NDA, IMBC читает, оператор и наблюдатель — нет (раздел 4)', () => {
    expect(row('forecast.read')).toEqual({
      manufacturer: 'after_nda',
      expert: 'all',
      administrator: 'all',
      director: 'all',
      operator: null,
      observer: null,
    });
  });

  it('администратор не читает содержимое профилей и записи IMBC (ADM-06)', () => {
    expect(POLICY_MATRIX.administrator['profile.read']).toBeUndefined();
    expect(POLICY_MATRIX.administrator['imbc_records.read']).toBeUndefined();
    expect(POLICY_MATRIX.administrator['audit.read']).toBe('account_events');
  });

  it('директор только читает (GEN-04)', () => {
    const writes = Object.keys(POLICY_MATRIX.director).filter((a) =>
      /\.(edit|manage|verify|validate|write|send|answer|reply|take|assign|run|invite|request)$/.test(a),
    );
    expect(writes).toEqual([]);
  });

  it('оператор видит только видимые профили и не видит прогноз (OPR-01)', () => {
    expect(POLICY_MATRIX.operator['catalog.search']).toBe('visible');
    expect(POLICY_MATRIX.operator['forecast.read']).toBeUndefined();
  });

  it('ни одна роль не имеет всех прав (GEN-03)', () => {
    const allActions = new Set(Object.values(POLICY_MATRIX).flatMap((r) => Object.keys(r)));
    for (const role of ROLES) expect(Object.keys(POLICY_MATRIX[role]).length).toBeLessThan(allActions.size);
  });
});

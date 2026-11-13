import { describe, expect, it } from 'vitest';
import {
  ADMIN_PROBLEM_CODES,
  type Action,
  can,
  catalogFilterSchema,
  catalogFilterToSearchParams,
  catalogItemSchema,
  changeEmailSchema,
  changeRoleSchema,
  checkBin,
  CLOSED_DICTIONARIES,
  COMMODITY_GROUPS,
  companyCardDataSchema,
  companyPageSchema,
  computeBinCheckDigit,
  CONTACT_ROLES,
  createOrganizationSchema,
  DATA_CLASSES,
  dashboardSchema,
  DICTIONARY_CODE_PATTERNS,
  DICTIONARY_CODES,
  DICTIONARY_PARENT,
  entryDisplayName,
  FILE_PURPOSES,
  FILE_SCAN_STATES,
  MANDATORY_DICTIONARIES,
  MANUFACTURER_FILE_PURPOSES,
  imbcMailboxSchema,
  INVITABLE_ROLES,
  inviteAccountSchema,
  loginEmailSchema,
  registrationRequestSchema,
  LEGAL_PLACEHOLDER_MARKER,
  registrationTermsReadSchema,
  registrationTermsSchema,
  normalizeCompanyName,
  POLICY_MATRIX,
  type PolicyMatrix,
  ORGANIZATION_TYPES,
  ownAdataReadSchema,
  ownProfileSchema,
  PREFILL_FIELDS,
  PROFILE_TIERS,
  REFERENCE_DATA_STATUSES,
  referenceFileSchema,
  ROLES,
  UPDATE_STATUSES,
} from '../src/index.js';

describe('перечисления v1.3 (раздел 3.1, UPD-06)', () => {
  it('observer вместо spectator, unresponsive вместо inactive', () => {
    expect(ROLES).toEqual(['manufacturer', 'expert', 'administrator', 'director', 'operator', 'observer']);
    expect(ORGANIZATION_TYPES).toEqual(['manufacturer', 'operator', 'observer', 'imbc']);
    expect(UPDATE_STATUSES).toEqual(['active', 'outdated', 'unresponsive']);
  });

  it('тир профиля — tier_1 и tier_2; tier 3 принадлежит продукту (IMBC-19, IMBC-20, IMBC-21)', () => {
    expect(PROFILE_TIERS).toEqual(['tier_1', 'tier_2']);
  });
});

describe('файлы и справочники (DBML, ADM-08, DATA-05, DATA-07)', () => {
  it('FILE_PURPOSES, DATA_CLASSES, FILE_SCAN_STATES — значения DBML; MANUFACTURER_FILE_PURPOSES — подмножество FILE_PURPOSES; DICTIONARY_CODES — двенадцать кодов ADM-08', () => {
    // DBML `file_purpose`, порядок тот же.
    expect(FILE_PURPOSES).toEqual([
      'organisation_chart',
      'cv',
      'unified_register_extract',
      'conformity_certificate',
      'production_photo',
      'certificate_file',
      'document_file',
      'site_survey_report',
      'due_diligence_report',
      'enhanced_due_diligence_report',
      'operator_visit_file',
      'technical_requirements',
      'agar_cdp_report',
      'organisation_chart_sample',
      'export',
    ]);
    expect(DATA_CLASSES).toEqual([
      'a_register',
      'b_manufacturer',
      'c_imbc',
      'd_operator',
      'e_administration',
      'f_forecast',
    ]);
    // DBML `scan_state`; в БД тип называется file_scan_state, пока скелетный scan_state не удалён (NFR-06).
    expect(FILE_SCAN_STATES).toEqual(['pending', 'passed', 'rejected']);

    // Файлы секций профиля — те назначения, на которые ссылаются таблицы профиля DBML.
    expect(MANUFACTURER_FILE_PURPOSES).toEqual([
      'organisation_chart',
      'cv',
      'unified_register_extract',
      'conformity_certificate',
      'production_photo',
      'certificate_file',
      'document_file',
    ]);
    for (const purpose of MANUFACTURER_FILE_PURPOSES) expect(FILE_PURPOSES).toContain(purpose);
    expect(new Set(MANUFACTURER_FILE_PURPOSES).size).toBe(MANUFACTURER_FILE_PURPOSES.length);

    // ADM-08: regions, legal forms, OKED, TN VED, KPVED, commodity groups, commodity types, processes,
    // equipment types, contact roles, certificate types, and document types; коды — из DBML `dictionary.code`.
    expect(DICTIONARY_CODES).toEqual([
      'region',
      'legal_form',
      'oked',
      'tn_ved',
      'kpved',
      'commodity_group',
      'commodity_type',
      'process',
      'equipment_type',
      'contact_role',
      'certificate_type',
      'document_type',
    ]);
  });
});

describe('файлы справочников: схема, шаблоны кодов, показ названия (ADM-08, DATA-03)', () => {
  const file = (entry: unknown) => ({
    dictionary: 'tn_ved',
    status: 'provisional',
    source: 'тест',
    entries: [entry],
  });

  it('referenceFileSchema: код-число отклоняется, без названий — отклоняется, неизвестный справочник — отклоняется (DATA-03)', () => {
    const ok = referenceFileSchema.safeParse(file({ code: '0101210000', names: { ru: 'Лошади' } }));
    expect(ok.success).toBe(true);
    // Значения по умолчанию: без родителя, без разрешения вводить название, порядок 0.
    expect(ok.success && ok.data.entries[0]).toEqual({
      code: '0101210000',
      parent: null,
      names: { ru: 'Лошади' },
      customNameAllowed: false,
      sortOrder: 0,
    });

    // Код — только строка: число теряет ведущие нули.
    expect(referenceFileSchema.safeParse(file({ code: 101210000, names: { ru: 'x' } })).success).toBe(false);
    // Хотя бы одно название, и не пустое.
    expect(referenceFileSchema.safeParse(file({ code: '0101210000', names: {} })).success).toBe(false);
    expect(referenceFileSchema.safeParse(file({ code: '0101210000', names: { ru: '  ' } })).success).toBe(false);
    // Язык вне kk, ru, en и лишние поля отклоняются.
    expect(referenceFileSchema.safeParse(file({ code: 'X', names: { ru: 'x', de: 'x' } })).success).toBe(false);
    expect(referenceFileSchema.safeParse(file({ code: 'X', names: { ru: 'x' }, extra: 1 })).success).toBe(false);
    // Неизвестный справочник, неизвестный статус и пустой список.
    expect(
      referenceFileSchema.safeParse({ ...file({ code: 'X', names: { ru: 'x' } }), dictionary: 'country' }).success,
    ).toBe(false);
    expect(referenceFileSchema.safeParse({ ...file({ code: 'X', names: { ru: 'x' } }), status: 'draft' }).success).toBe(
      false,
    );
    expect(referenceFileSchema.safeParse({ ...file({}), entries: [] }).success).toBe(false);
    expect(REFERENCE_DATA_STATUSES).toEqual(['specification', 'imbc', 'provisional']);
  });

  it('entryDisplayName: язык → kk → ru → en → код', () => {
    const all = { kk: 'Қазақша', ru: 'Русский', en: 'English' };
    expect(entryDisplayName(all, 'en', 'X')).toBe('English');
    expect(entryDisplayName(all, 'ru', 'X')).toBe('Русский');
    expect(entryDisplayName({ ru: 'Русский', en: 'English' }, 'en', 'X')).toBe('English');
    // Нет названия на языке пользователя — kk, затем ru, затем en.
    expect(entryDisplayName({ kk: 'Қазақша', ru: 'Русский' }, 'en', 'X')).toBe('Қазақша');
    expect(entryDisplayName({ ru: 'Русский', en: 'English' }, 'kk', 'X')).toBe('Русский');
    expect(entryDisplayName({ en: 'English' }, 'kk', 'X')).toBe('English');
    // Пустое и null — не название.
    expect(entryDisplayName({ kk: null, ru: '', en: 'English' }, 'ru', 'X')).toBe('English');
    // Названий нет — код как есть, ведущие нули на месте.
    expect(entryDisplayName({}, 'ru', '0101210000')).toBe('0101210000');
    expect(entryDisplayName({ kk: null, ru: null, en: null }, 'kk', 'ISO 9001')).toBe('ISO 9001');
  });

  it('закрытые справочники = COMMODITY_GROUPS и CONTACT_ROLES; шаблон tn_ved принимает 0101210000 и отклоняет 101210000', () => {
    expect(CLOSED_DICTIONARIES).toEqual(['commodity_group', 'contact_role']);
    expect(MANDATORY_DICTIONARIES).toEqual(['certificate_type', 'document_type']);
    expect(DICTIONARY_PARENT).toEqual({ commodity_type: 'commodity_group' });

    // Коды закрытых справочников задаёт спецификация (MAN-23, MAN-13): шаблон принимает ровно их.
    for (const group of COMMODITY_GROUPS) expect(DICTIONARY_CODE_PATTERNS.commodity_group.test(group)).toBe(true);
    for (const bad of ['F', 'a', 'AB', '', ' A'])
      expect(DICTIONARY_CODE_PATTERNS.commodity_group.test(bad), bad).toBe(false);
    for (const role of CONTACT_ROLES) expect(DICTIONARY_CODE_PATTERNS.contact_role.test(role)).toBe(true);

    // Шаблон есть у каждого справочника.
    for (const code of DICTIONARY_CODES) expect(DICTIONARY_CODE_PATTERNS[code]).toBeInstanceOf(RegExp);
    // MAN-25: ТН ВЭД — десять цифр, ведущий ноль не теряется.
    expect(DICTIONARY_CODE_PATTERNS.tn_ved.test('0101210000')).toBe(true);
    expect(DICTIONARY_CODE_PATTERNS.tn_ved.test('101210000')).toBe(false);
    expect(DICTIONARY_CODE_PATTERNS.tn_ved.test('01012100001')).toBe(false);
    expect(DICTIONARY_CODE_PATTERNS.oked.test('01110')).toBe(true);
    expect(DICTIONARY_CODE_PATTERNS.oked.test('1110')).toBe(false);
    for (const good of ['25.11.23', '01', '01.1', '28.13.14'])
      expect(DICTIONARY_CODE_PATTERNS.kpved.test(good)).toBe(true);
    for (const bad of ['1.1', '25.', '25.11.', '25-11'])
      expect(DICTIONARY_CODE_PATTERNS.kpved.test(bad), bad).toBe(false);

    // Остальные: буквы, цифры, пробел и ._-/, 1–64 символа, без пробела по краям.
    for (const good of ['KZ-AKT', 'ISO 9001', 'Extract from e-Ondiris', 'registration_certificate', 'A/B.c-d_e', 'Ж'])
      expect(DICTIONARY_CODE_PATTERNS.certificate_type.test(good), good).toBe(true);
    for (const bad of ['', ' ISO', 'ISO ', 'a;b', 'a,b', 'a\nb', 'x'.repeat(65)])
      expect(DICTIONARY_CODE_PATTERNS.certificate_type.test(bad), JSON.stringify(bad)).toBe(false);
    expect(DICTIONARY_CODE_PATTERNS.region.test('x'.repeat(64))).toBe(true);
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

describe('регистрация производителя (MAN-01, FC-02, GEN-01)', () => {
  const valid = {
    companyName: 'ТОО «Тест»',
    bin: '980540000381',
    email: 'Info@Company.local',
    heardAboutUs: 'Выставка',
    acceptPlatformTerms: true,
    acceptPersonalData: true,
    ndaVersion: 1,
  };

  it('регистрация: без любого согласия, без ответа «Как вы узнали», с acceptTerms или password — отклоняется (MAN-01)', () => {
    expect(registrationRequestSchema.parse(valid)).toEqual({ ...valid, email: 'info@company.local', locale: 'kk' });
    for (const key of ['acceptPlatformTerms', 'acceptPersonalData', 'ndaVersion', 'heardAboutUs'] as const) {
      const { [key]: _omitted, ...rest } = valid;
      expect(registrationRequestSchema.safeParse(rest).success, key).toBe(false);
    }
    for (const over of [
      { acceptPlatformTerms: false },
      { acceptPersonalData: false },
      { ndaVersion: 0 },
      { ndaVersion: 1.5 },
      { heardAboutUs: '   ' },
      { heardAboutUs: null },
      { heardAboutUs: 'x'.repeat(501) },
      { acceptTerms: true },
      { password: 'Secret-123' },
    ])
      expect(registrationRequestSchema.safeParse({ ...valid, ...over }).success, JSON.stringify(over)).toBe(false);
    expect(registrationRequestSchema.parse({ ...valid, heardAboutUs: '  Выставка  ' }).heardAboutUs).toBe('Выставка');
  });

  it('почта логина в нижнем регистре, больше 254 — отклоняется', () => {
    expect(loginEmailSchema.parse('  Admin@IMBC.Local ')).toBe('admin@imbc.local');
    const long = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.local`;
    expect(long.length).toBeGreaterThan(254);
    expect(loginEmailSchema.safeParse(long).success).toBe(false);
    expect(loginEmailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('текст условий регистрации — только номер и текст текущей версии NDA (FC-02)', () => {
    expect(registrationTermsSchema.parse({ nda: { version: 1, body: 'Текст' } })).toEqual({
      nda: { version: 1, body: 'Текст' },
    });
    expect(registrationTermsSchema.safeParse({ nda: { version: 1, body: '' } }).success).toBe(false);
    expect(registrationTermsSchema.safeParse({ nda: { version: 1, body: 'Текст', id: 'x' } }).success).toBe(false);
  });

  it('маркер временного текста: три начальные фразы с длинным тире; дефис или другие слова — не заглушка (FC-02)', () => {
    for (const text of ['PLACEHOLDER — NOT A LEGAL TEXT.', 'ВРЕМЕННЫЙ ТЕКСТ — НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ.', 'УАҚЫТША МӘТІН — ЗАҢДЫҚ ҚҰЖАТ ЕМЕС.'])
      expect(text, text).toMatch(LEGAL_PLACEHOLDER_MARKER);
    for (const text of ['PLACEHOLDER - NOT A LEGAL TEXT.', 'ВРЕМЕННЫЙ ТЕКСТ – НЕ ДОКУМЕНТ.', 'Настоящий текст соглашения.', ' PLACEHOLDER — с пробелом впереди.'])
      expect(text, text).not.toMatch(LEGAL_PLACEHOLDER_MARKER);
  });

  it('форма читает текст условий нестрого: новое поле API не мешает, неверная форма ответа — отказ (FC-02, NFR-06)', () => {
    expect(registrationTermsReadSchema.parse({ nda: { version: 2, body: 'Текст', publishedAt: 'x' }, extra: 1 })).toEqual({
      nda: { version: 2, body: 'Текст' },
    });
    for (const body of [{}, { nda: { body: 'Текст' } }, { nda: { version: 0, body: 'Текст' } }, { nda: { version: 1, body: '' } }])
      expect(registrationTermsReadSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });
});

describe('организации и приглашения администратора (ADM-01, ADM-03, GEN-05)', () => {
  it('INVITABLE_ROLES: производителя нет, у IMBC три роли (раздел 3.1)', () => {
    expect(Object.keys(INVITABLE_ROLES).sort()).toEqual(['imbc', 'observer', 'operator']);
    expect(INVITABLE_ROLES.imbc).toEqual(['expert', 'administrator', 'director']);
    expect(INVITABLE_ROLES.operator).toEqual(['operator']);
    expect(INVITABLE_ROLES.observer).toEqual(['observer']);
    expect(Object.values(INVITABLE_ROLES).flat()).not.toContain('manufacturer');
  });

  it('наблюдатель с отметкой major — отклоняется (GEN-05)', () => {
    expect(createOrganizationSchema.parse({ name: '  Оператор  ', type: 'operator', isMajorOperator: true })).toEqual({
      name: 'Оператор',
      type: 'operator',
      isMajorOperator: true,
    });
    expect(createOrganizationSchema.parse({ name: 'Наблюдатель', type: 'observer' }).isMajorOperator).toBe(false);
    const major = createOrganizationSchema.safeParse({ name: 'Наблюдатель', type: 'observer', isMajorOperator: true });
    expect(major.success).toBe(false);
    expect(major.error?.issues.map((i) => i.path.join('.'))).toEqual(['isMajorOperator']);
    for (const type of ['manufacturer', 'imbc'])
      expect(createOrganizationSchema.safeParse({ name: 'Организация', type }).success, type).toBe(false);
    expect(
      createOrganizationSchema.safeParse({ name: 'Организация', type: 'operator', bin: '980540000381' }).success,
    ).toBe(false);
  });

  it('коды ошибок маршрутов администратора — без повторов, snake_case (ADMIN_PROBLEM_CODES)', () => {
    expect(new Set(ADMIN_PROBLEM_CODES).size).toBe(ADMIN_PROBLEM_CODES.length);
    for (const code of ADMIN_PROBLEM_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
    expect(ADMIN_PROBLEM_CODES).toContain('organization_not_invitable');
  });

  it('приглашение и ящик IMBC: почта в нижнем регистре, лишний ключ — отказ (ADM-01, раздел 8.2)', () => {
    const invite = {
      email: ' New@Operator.Local ',
      fullName: ' Имя Фамилия ',
      organizationId: '00000000-0000-4000-8000-000000000001',
      role: 'operator',
    };
    expect(inviteAccountSchema.parse(invite)).toEqual({
      ...invite,
      email: 'new@operator.local',
      fullName: 'Имя Фамилия',
    });
    expect(inviteAccountSchema.safeParse({ ...invite, locale: 'ru' }).success).toBe(false);
    expect(inviteAccountSchema.safeParse({ ...invite, organizationId: 'x' }).success).toBe(false);
    expect(imbcMailboxSchema.parse({ email: ' Mail@IMBC.Local ' })).toEqual({ email: 'mail@imbc.local' });
    expect(imbcMailboxSchema.parse({ email: null })).toEqual({ email: null });
    expect(imbcMailboxSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(imbcMailboxSchema.safeParse({}).success).toBe(false);
  });

  it('changeEmailSchema приводит к нижнему регистру', () => {
    expect(changeEmailSchema.parse({ email: ' New.Login@Maker.Local ' })).toEqual({ email: 'new.login@maker.local' });
    expect(changeEmailSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(changeEmailSchema.safeParse({ email: 'a@maker.local', emailVerified: true }).success).toBe(false);
  });

  it('changeRoleSchema — роль из ROLES, лишний ключ — отказ; коды действий над аккаунтом в контракте (AUTH-06, ADM-05)', () => {
    expect(changeRoleSchema.parse({ role: 'director' })).toEqual({ role: 'director' });
    expect(changeRoleSchema.safeParse({ role: 'boss' }).success).toBe(false);
    expect(
      changeRoleSchema.safeParse({ role: 'expert', organizationId: '00000000-0000-4000-8000-000000000001' }).success,
    ).toBe(false);
    for (const code of ['self_action', 'role_fixed', 'not_manufacturer_account'])
      expect(ADMIN_PROBLEM_CODES, code).toContain(code);
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

  it('фильтр tier: список в адресе, OR внутри фильтра (OPR-02, OPR-04, OPR-05)', () => {
    expect(catalogFilterSchema.parse({ tier: 'tier_1,tier_2' }).tier).toEqual(['tier_1', 'tier_2']);
    expect(catalogFilterSchema.parse({ tier: 'tier_2' }).tier).toEqual(['tier_2']);
    expect(catalogFilterToSearchParams({ tier: ['tier_2'] }).toString()).toBe('tier=tier_2');
  });

  it('неизвестный тир отклоняется, пустое значение — без фильтра', () => {
    expect(() => catalogFilterSchema.parse({ tier: 'tier_3' })).toThrow();
    expect(() => catalogFilterSchema.parse({ tier: 'tier_1,tier_3' })).toThrow();
    expect(catalogFilterSchema.parse({ tier: '' }).tier).toBeUndefined();
    expect(catalogFilterSchema.parse({}).tier).toBeUndefined();
  });
});

describe('строка результата каталога (OPR-06)', () => {
  const item = {
    profileId: '00000000-0000-4000-8000-000000000001',
    bin: '240100000001',
    nameEn: 'Test LLP',
    nameRu: 'ТОО «Тест»',
    region: 'KZ-ATY',
    commodityGroups: ['A'],
    mainTnved: null,
    certificateTypes: [],
    siteSurveyed: true,
    verifiedAt: null,
    pendingChanges: false,
    worksWithCount: 0,
  };

  it('строка результата несёт тир и статус unresponsive (OPR-06, UPD-06)', () => {
    const parsed = catalogItemSchema.parse({ ...item, tier: 'tier_2', updateStatus: 'unresponsive' });
    expect(parsed.tier).toBe('tier_2');
    expect(parsed.updateStatus).toBe('unresponsive');
  });

  it('отклоняет строку без тира и прежний статус inactive', () => {
    expect(() => catalogItemSchema.parse({ ...item, updateStatus: 'active' })).toThrow();
    expect(() => catalogItemSchema.parse({ ...item, tier: 'tier_3', updateStatus: 'active' })).toThrow();
    expect(() => catalogItemSchema.parse({ ...item, tier: 'tier_1', updateStatus: 'inactive' })).toThrow();
  });
});

describe('страница компании (OPR-09, OPR-10, GEN-13)', () => {
  const page = {
    profileId: '00000000-0000-4000-8000-000000000001',
    bin: '240100000001',
    nameEn: 'Test LLP',
    nameRu: 'ТОО «Тест»',
    region: 'KZ-ATY',
    commodityGroups: ['A'],
    tnvedCodes: ['7308909809'],
    mainTnved: '7308909809',
    headcountTotal: 240,
    certificates: [{ type: 'ISO 9001', validUntil: '2027-11-12' }],
    siteSurveyed: true,
    tier: 'tier_2',
    unifiedRegister: false,
    worksWithCount: 1,
    updateStatus: 'active',
    pendingChanges: false,
    verifiedAt: '2026-11-03T10:00:00.000Z',
    companyPhone: '+7 700 000 00 01',
    companyEmail: 'info@company1.demo.local',
  };

  it('страница компании: focalPoint необязателен, card без полей отклоняется', () => {
    const observer = companyPageSchema.parse(page);
    expect('focalPoint' in observer).toBe(false);
    const focalPoint = { fullName: 'Айгерим Сапарова', position: 'Директор', email: 'f@x.local', phone: '+7' };
    expect(companyPageSchema.parse({ ...page, focalPoint }).focalPoint).toEqual(focalPoint);
    expect(companyPageSchema.parse({ ...page, focalPoint: null }).focalPoint).toBeNull();
    expect(companyCardDataSchema.safeParse({ demo: true }).success).toBe(false);
    expect(companyCardDataSchema.safeParse({ companyPhone: null, companyEmail: null, focalPoint: null }).success).toBe(
      true,
    );
  });
});

describe('свой профиль производителя (MAN-41, MAN-46, IMBC-22)', () => {
  const verified = {
    profileId: '00000000-0000-4000-8000-000000000001',
    organizationName: 'ТОО «Тест»',
    bin: '240100000001',
    status: 'verified',
    hasPendingChanges: false,
    updateStatus: 'active',
    tier: 'tier_2',
    completenessPct: 100,
    registeredAt: '2026-10-01T10:00:00.000Z',
    verifiedAt: '2026-11-03T10:00:00.000Z',
  };

  it('свой профиль: updateStatus и tier null до верификации', () => {
    expect(ownProfileSchema.parse(verified)).toEqual(verified);
    const draft = { ...verified, status: 'draft', updateStatus: null, tier: null, completenessPct: 40, verifiedAt: null };
    expect(ownProfileSchema.parse(draft)).toEqual(draft);
    expect(ownProfileSchema.safeParse({ ...verified, tier: 'tier_3' }).success).toBe(false);
    expect(ownProfileSchema.safeParse({ ...verified, completenessPct: 101 }).success).toBe(false);
  });
});

describe('чтение Adata для производителя (MAN-06, MAN-07, IMBC-07)', () => {
  const received = {
    state: 'received',
    requestedAt: '2026-11-12T10:00:00.000Z',
    readAt: '2026-11-12T10:01:00.000Z',
    fields: [
      {
        field: 'activity',
        source: 'adata',
        readAt: '2026-11-12T10:01:00.000Z',
        items: [{ value: '25110', label: 'Производство строительных металлических конструкций' }],
      },
    ],
  };

  it('данные Adata: лишний ключ ответа отклоняется (strict), пустой items отклоняется', () => {
    expect(ownAdataReadSchema.safeParse(received).success).toBe(true);
    expect(ownAdataReadSchema.safeParse({ ...received, value: {} }).success).toBe(false);
    const empty = { ...received, fields: [{ ...received.fields[0], items: [] }] };
    expect(ownAdataReadSchema.safeParse(empty).success).toBe(false);
  });

  it('девять полей Adata в порядке показа (MAN-06, MAN-07)', () => {
    expect(PREFILL_FIELDS).toEqual([
      'legal_name',
      'activity',
      'company_phone',
      'company_email',
      'legal_address',
      'director_full_name',
      'state_registered_on',
      'legal_form',
      'shareholders',
    ]);
  });
});

describe('дашборд (OPR-31…35)', () => {
  const dashboard = {
    total: 5,
    byRegion: [{ region: 'KZ-AKM', count: 1 }],
    byCommodityGroup: [{ group: 'A', count: 2 }],
    siteSurveyed: 2,
    unifiedRegister: 1,
    updateStatus: { active: 2, outdated: 1, unresponsive: 2 },
    tier: { tier_1: 3, tier_2: 2 },
    generatedAt: '2026-11-11T10:00:00.000Z',
  };

  it('счётчики по тирам (OPR-32, IMBC-22)', () => {
    expect(dashboardSchema.parse(dashboard).tier).toEqual({ tier_1: 3, tier_2: 2 });
    const { tier: _tier, ...withoutTier } = dashboard;
    expect(() => dashboardSchema.parse(withoutTier)).toThrow();
  });

  it('счётчики по статусу актуальности включают все три статуса (OPR-33, UPD-06)', () => {
    expect(dashboardSchema.parse(dashboard).updateStatus).toEqual({ active: 2, outdated: 1, unresponsive: 2 });
  });

  it('отклоняет прежнюю форму со статусом inactive', () => {
    expect(() =>
      dashboardSchema.parse({ ...dashboard, updateStatus: { active: 2, outdated: 1, inactive: 2 } }),
    ).toThrow();
  });
});

describe('PolicyMatrix (раздел 4 v1.3; GEN-03, GEN-04, GEN-10, GEN-13)', () => {
  const row = (action: Action) => Object.fromEntries(ROLES.map((r) => [r, can(r, action)]));

  // Раздел 4 v1.3, выписанный построчно: любое право, добавленное или снятое в матрице
  // без правки этой таблицы, роняет тест (GEN-10).
  const SECTION_4: PolicyMatrix = {
    manufacturer: {
      'profile.read': 'own', // Own profile: edit
      'profile.edit': 'own',
      'operator_request.reply': 'own', // Operator request: reply
      'forecast.read': 'after_nda', // Demand forecast, STR, and KTRE: once verified, current NDA
      'tier.read': 'own', // Tier, AGAR, and CDP: request own
      'tier.read_products': 'own',
      'tier.request': 'own',
      'focal_point.read': 'own',
    },
    expert: {
      'profile.read': 'all', // Own profile: view
      'profile.verify': 'all', // Verify profiles, sections, documents
      'review.take': 'all', // Assign reviews: take
      'imbc_records.read': 'all', // Site survey, due diligence, IMBC notes: edit
      'imbc_records.edit': 'all',
      'external_checks.run': 'all', // External checks: run and view
      'external_checks.read': 'all',
      'works_with.validate': 'all', // Validate works-with and visit marks; see who works with whom
      'works_with.read_who': 'all',
      'catalog.search': 'all', // Search and company page: all profiles
      'catalog.export': 'all', // Export search results
      'operator_notes.read': 'all', // Operator notes: view
      'imbc_request.answer': 'all', // IMBC request: answer
      'imbc_request.read': 'all',
      'operator_request.read': 'all', // Operator request: view
      'forecast.read': 'all', // Demand forecast, STR, and KTRE: view
      'tier.read': 'all', // Tier, AGAR, and CDP: edit
      'tier.read_products': 'all',
      'tier.edit': 'all',
      'focal_point.read': 'all',
    },
    administrator: {
      'review.assign': 'all', // Assign reviews: assign
      'accounts.manage': 'all', // Accounts of all organisations
      'reference.manage': 'all', // Reference lists, NDA versions, organisation-chart sample
      'reference.read': 'all',
      'forecast.manage': 'all', // Import and publish forecast; STR and KTRE files
      'forecast.read': 'all', // Demand forecast, STR, and KTRE: view
      'migration.invite': 'all', // Invite migrated manufacturers
      'pull_api.manage': 'all', // Pull API: issue and revoke
      'audit.read': 'account_events', // Audit log: account events only
    },
    director: {
      'profile.read': 'all', // Own profile: view
      'imbc_records.read': 'all', // Site survey, due diligence, IMBC notes: view
      'external_checks.read': 'all', // External checks: view
      'works_with.read_who': 'all', // See which operators work with whom: view
      'reference.read': 'all', // Reference lists: view
      'forecast.read': 'all', // Forecast; STR and KTRE: view
      'catalog.search': 'all', // Search and company page: all profiles
      'dashboard.read': 'all', // Dashboard
      'catalog.export': 'all', // Export search results
      'operator_notes.read': 'all', // Operator notes: view
      'imbc_request.read': 'all', // IMBC request: view
      'operator_request.read': 'all', // Operator request: view
      'audit.read': 'all', // Audit log: all
      'tier.read': 'all', // Tier, AGAR, and CDP: view
      'tier.read_products': 'all',
      'focal_point.read': 'all',
    },
    operator: {
      'catalog.search': 'visible', // Search and company page: visible verified only
      'dashboard.read': 'visible', // Dashboard
      'catalog.export': 'visible', // Export search results
      'subscriptions.manage': 'own', // Export subscriptions: own only
      'pull_api.use': 'own', // Pull API: own organisation
      'operator_marks.write': 'own', // Works-with mark, visit mark: own organisation
      'operator_notes.read': 'own', // Operator notes: own organisation
      'operator_notes.write': 'own',
      'imbc_request.send': 'own', // IMBC request: send
      'operator_request.send': 'visible', // Operator request: send
      'tier.read': 'visible', // Tier, and which products are tier 3
      'tier.read_products': 'visible',
      'focal_point.read': 'visible',
    },
    observer: {
      'catalog.search': 'visible', // Search and company page: visible verified only, without the focal point
      'dashboard.read': 'visible', // Dashboard
      'tier.read': 'visible', // Tier, AGAR, and CDP: tier only
    },
  };

  it('матрица целиком совпадает с разделом 4 (GEN-10)', () => {
    // Сначала имена: опечатка в таблице даёт понятное сообщение, а не только разницу матриц.
    const known = new Set(Object.values(POLICY_MATRIX).flatMap((r) => Object.keys(r)));
    for (const action of Object.values(SECTION_4).flatMap((r) => Object.keys(r) as Action[]))
      expect(known, action).toContain(action);
    expect(POLICY_MATRIX).toEqual(SECTION_4);
  });

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

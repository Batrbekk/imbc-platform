import { describe, expect, it } from 'vitest';
import { extractPrefill, type PrefillRow } from '../src/modules/adata/company-info.js';
import { ADATA_FIXTURE } from './support/adata-stub.js';

const fixture = () => structuredClone(ADATA_FIXTURE.data) as Record<string, Record<string, unknown> | null>;
const rows = (data: unknown, field: PrefillRow['field']) => extractPrefill(data).filter((r) => r.field === field);
const values = (data: unknown, field: PrefillRow['field']) => rows(data, field).map((r) => r.value);

describe('Разбор «Полной информации» Adata (MAN-06, MAN-07)', () => {
  it('фикстура → девять полей по таблице', () => {
    expect(extractPrefill(ADATA_FIXTURE.data)).toEqual([
      { field: 'legal_name', position: 0, value: 'ТОО «Тест Adata»', label: null },
      {
        field: 'activity',
        position: 0,
        value: '25110',
        label: 'Производство строительных металлических конструкций',
      },
      { field: 'activity', position: 1, value: '28220', label: 'Производство подъемно-транспортного оборудования' },
      { field: 'activity', position: 2, value: '46690', label: 'Оптовая торговля прочими машинами и оборудованием' },
      { field: 'company_phone', position: 0, value: '+7 727 000 00 01', label: null },
      { field: 'company_email', position: 0, value: 'info@adata-test.local', label: null },
      { field: 'legal_address', position: 0, value: 'Казахстан, г. Алматы, ул. Тестовая, д. 1', label: null },
      { field: 'director_full_name', position: 0, value: 'Тестов Тест Тестович', label: null },
      { field: 'state_registered_on', position: 0, value: '2016-09-29', label: null },
      { field: 'legal_form', position: 0, value: 'Товарищество с ограниченной ответственностью', label: null },
      { field: 'shareholders', position: 0, value: 'Тестова Айгуль', label: null },
      { field: 'shareholders', position: 1, value: 'ТОО «Тест Холдинг»', label: null },
    ]);
  });

  it('численность и ИИН директора не предзаполняются (MAN-17)', () => {
    const text = JSON.stringify(extractPrefill(ADATA_FIXTURE.data));
    expect(text).not.toContain('800101300011');
    expect(extractPrefill(ADATA_FIXTURE.data).some((r) => r.value === '42')).toBe(false);
  });

  it('учредители — только имена (MAN-21)', () => {
    const shareholders = rows(ADATA_FIXTURE.data, 'shareholders');
    expect(shareholders.map((r) => r.value)).toEqual(['Тестова Айгуль', 'ТОО «Тест Холдинг»']);
    const text = JSON.stringify(shareholders);
    for (const copied of ['850202400022', '100140000033', '2018-03-15', 'is_company'])
      expect(text).not.toContain(copied);
  });

  it('ОКЭД: okeds, затем secondary без повтора кода (MAN-10, DATA-03)', () => {
    expect(values(ADATA_FIXTURE.data, 'activity')).toEqual(['25110', '28220', '46690']);

    // Код — текст: ведущий ноль не теряется, число становится строкой.
    const data = fixture();
    data.basic!.okeds = [{ i: '01110', name_ru: 'Выращивание зерновых' }, { i: 25110 }, { name_ru: 'без кода' }];
    data.basic!.secondary_okeds = [{ i: ' 01110 ', name_ru: 'повтор' }, 'мусор', null];
    expect(rows(data, 'activity')).toEqual([
      { field: 'activity', position: 0, value: '01110', label: 'Выращивание зерновых' },
      { field: 'activity', position: 1, value: '25110', label: null },
    ]);

    // Оба списка пусты — basic.oked без названия.
    data.basic!.okeds = [];
    data.basic!.secondary_okeds = null;
    expect(rows(data, 'activity')).toEqual([{ field: 'activity', position: 0, value: '25110', label: null }]);
  });

  it('дата: три формата → ISO, иное — нет строки (MAN-09)', () => {
    const date = (value: unknown) => {
      const data = fixture();
      data.basic!.date_registration = value;
      return values(data, 'state_registered_on');
    };
    expect(date('2016-09-29')).toEqual(['2016-09-29']);
    expect(date('2016-09-29T00:00:00.000Z')).toEqual(['2016-09-29']);
    expect(date('29.09.2016')).toEqual(['2016-09-29']);
    for (const other of ['2016/09/29', '29.09.16', '2016-02-30', '31.04.2016', '2016-13-01', '', null, 20160929, {}])
      expect(date(other)).toEqual([]);
  });

  it('название, адрес: казахский вариант, когда нет русского; строки обрезаются, пустые и дубли отбрасываются', () => {
    const data = fixture();
    data.basic!.name_ru = '  ';
    data.basic!.legal_address = null;
    data.kzCoContact!.phones = [
      { contact: ' +7 727 000 00 02 ' },
      { contact: '+7 727 000 00 02' },
      { contact: 7270000003 },
    ];
    expect(values(data, 'legal_name')).toEqual(['«Тест Adata» ЖШС']);
    expect(values(data, 'legal_address')).toEqual(['Қазақстан, Алматы қ., Тестовая к-сі, 1 үй']);
    expect(values(data, 'company_phone')).toEqual(['+7 727 000 00 02', '7270000003']);
  });

  it('не больше 50 строк на поле', () => {
    const data = fixture();
    data.founders!.founders_dtl = Array.from({ length: 70 }, (_, i) => ({ name: `Учредитель ${i}` }));
    const shareholders = rows(data, 'shareholders');
    expect(shareholders).toHaveLength(50);
    expect(shareholders.at(-1)).toEqual({ field: 'shareholders', position: 49, value: 'Учредитель 49', label: null });
  });

  it('unknown_bin — пустой список', () => {
    expect(extractPrefill({ basic: null, kzCoContact: null, founders: null })).toEqual([]);
    expect(extractPrefill({})).toEqual([]);
  });

  it('блок не объект — поле пропущено, без исключения', () => {
    for (const odd of ['строка', 42, [], true]) {
      const data = { ...fixture(), basic: odd, kzCoContact: odd, founders: odd };
      expect(extractPrefill(data)).toEqual([]);
    }
    const data = { ...fixture(), founders: { founders_dtl: 'не список' }, kzCoContact: { phones: {}, emails: null } };
    expect(extractPrefill(data).map((r) => r.field)).not.toContain('shareholders');
    expect(values(data, 'company_phone')).toEqual([]);
    for (const odd of [null, undefined, 'x', 1, []]) expect(extractPrefill(odd)).toEqual([]);
  });

  // Ключ, которого нет в ответе, не обнуляет свой блок: остальные поля блока остаются (MAN-07).
  const AFFECTS: Record<string, PrefillRow['field'][]> = {
    'basic.name_ru': ['legal_name'],
    'basic.name_kz': ['legal_name'],
    'basic.legal_address': ['legal_address'],
    'basic.legal_address_kz': ['legal_address'],
    'basic.oked': ['activity'],
    'basic.okeds': ['activity'],
    'basic.secondary_okeds': ['activity'],
    'basic.fullname_director': ['director_full_name'],
    'basic.date_registration': ['state_registered_on'],
    'basic.legal_form': ['legal_form'],
    'kzCoContact.phones': ['company_phone'],
    'kzCoContact.emails': ['company_email'],
    'founders.founders_dtl': ['shareholders'],
  };
  const full = extractPrefill(ADATA_FIXTURE.data);
  const keys = (['basic', 'kzCoContact', 'founders'] as const).flatMap((b) =>
    Object.keys(ADATA_FIXTURE.data[b] as object).map((k) => `${b}.${k}`),
  );
  it.each(keys)('без ключа %s — остальные поля на месте', (path) => {
    const [block, key] = path.split('.') as [string, string];
    const data = fixture();
    delete data[block]![key];
    const affected = AFFECTS[path] ?? [];
    expect(extractPrefill(data).filter((r) => !affected.includes(r.field))).toEqual(
      full.filter((r) => !affected.includes(r.field)),
    );
  });

  it('NUL и одиночный суррогат не попадают в строку; значение длиннее 1000 символов отбрасывается', () => {
    const data = fixture();
    data.basic!.name_ru = 'ТОО\u0000 «Тест»\ud800';
    data.basic!.fullname_director = '\u0000\udc00';
    data.basic!.legal_address = 'а'.repeat(1001);
    data.basic!.legal_address_kz = 'ә'.repeat(1000);
    const result = extractPrefill(data);
    expect(values(data, 'legal_name')).toEqual(['ТОО «Тест»\ufffd']);
    expect(values(data, 'director_full_name')).toEqual(['\ufffd']);
    expect(values(data, 'legal_address')).toEqual(['ә'.repeat(1000)]);
    for (const r of result) {
      expect(r.value.includes('\u0000')).toBe(false);
      expect(/[\ud800-\udfff]/.test(r.value.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''))).toBe(false);
    }
    data.basic!.legal_address_kz = 'ә'.repeat(1001);
    expect(values(data, 'legal_address')).toEqual([]);
  });
});

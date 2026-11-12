/**
 * Разбор `data` «Полной информации» Adata (rate 76) в девять предзаполняемых значений (MAN-06, MAN-07).
 * Чистые функции. Блок, которого нет, который равен null или имеет другой тип, пропускает свои поля
 * без исключения: форма ответа сверяется на реальном ответе при ручной проверке.
 * Не предзаполняются: численность (MAN-17), ИИН директора и всё остальное — остаются в value попытки.
 */
import { PREFILL_FIELDS, type PrefillField } from '@imbc/contracts';
import { z } from 'zod';
import { pgSafeText } from './adata.client.js';

const block = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape).nullable().optional().catch(null);
/** В zod 4 ключ z.unknown() обязателен: без optional() нехватка одного ключа обнулила бы весь блок. */
const key = () => z.unknown().optional();

export const companyInfoDataSchema = z.looseObject({
  basic: block({
    name_ru: key(),
    name_kz: key(),
    legal_address: key(),
    legal_address_kz: key(),
    oked: key(),
    okeds: key(),
    secondary_okeds: key(),
    fullname_director: key(),
    date_registration: key(),
    legal_form: key(),
  }),
  kzCoContact: block({ phones: key(), emails: key() }),
  founders: block({ founders_dtl: key() }),
});

export type PrefillRow = { field: PrefillField; position: number; value: string; label: string | null };

/** Не больше 50 строк на поле. */
const MAX_ROWS = 50;

type Item = { value: string; label: string | null };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Длиннее одно значение не предзаполняется; исходный ответ хранит его целиком. */
const MAX_VALUE_LENGTH = 1_000;

/** Строка после trim или число как строка, без NUL и одиночных суррогатов (jsonb, text); пустое, длинное и прочее — null. */
function text(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = pgSafeText(v).trim();
  return s === '' || s.length > MAX_VALUE_LENGTH ? null : s;
}

/** `YYYY-MM-DD`, `YYYY-MM-DDT…` (часть даты), `DD.MM.YYYY` → `YYYY-MM-DD`; иное или несуществующая дата — null. */
function registrationDate(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s);
  const dotted = iso ? null : /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  const ymd = iso ? [iso[1]!, iso[2]!, iso[3]!] : dotted ? [dotted[3]!, dotted[2]!, dotted[1]!] : null;
  if (!ymd) return null;
  const [y, mo, d] = ymd as [string, string, string];
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  const value = `${y}-${mo}-${d}`;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

/** Элемент списка контактов: `{ contact }`, допускается и голая строка. */
const contact = (item: unknown) => text(isObject(item) ? item.contact : item);

function okedItems(basic: Record<string, unknown>): Item[] {
  const items = [...list(basic.okeds), ...list(basic.secondary_okeds)].flatMap((o): Item[] => {
    if (!isObject(o)) return [];
    // Код ОКЭД — текст (DATA-03).
    const value = text(o.i);
    return value === null ? [] : [{ value, label: text(o.name_ru) }];
  });
  if (items.length > 0) return items;
  const oked = text(basic.oked);
  return oked === null ? [] : [{ value: oked, label: null }];
}

const one = (v: string | null): Item[] => (v === null ? [] : [{ value: v, label: null }]);

export function extractPrefill(data: unknown): PrefillRow[] {
  const parsed = companyInfoDataSchema.safeParse(data);
  if (!parsed.success) return [];
  const basic = parsed.data.basic ?? null;
  const contacts = parsed.data.kzCoContact ?? null;
  const founders = parsed.data.founders ?? null;

  const fields: Record<PrefillField, Item[]> = {
    // Как записал источник, без перевода.
    legal_name: basic ? one(text(basic.name_ru) ?? text(basic.name_kz)) : [],
    activity: basic ? okedItems(basic) : [],
    // Формат телефона не нормализуется.
    company_phone: contacts ? list(contacts.phones).flatMap((p) => one(contact(p))) : [],
    // Контактный email компании, не логин (MAN-06).
    company_email: contacts ? list(contacts.emails).flatMap((e) => one(contact(e))) : [],
    legal_address: basic ? one(text(basic.legal_address) ?? text(basic.legal_address_kz)) : [],
    director_full_name: basic ? one(text(basic.fullname_director)) : [],
    state_registered_on: basic ? one(registrationDate(basic.date_registration)) : [],
    // Как есть; сопоставление со списком LLP/LLC/JSC (MAN-09) — позже.
    legal_form: basic ? one(text(basic.legal_form)) : [],
    // Только имя: долей и гражданства в ответе нет (MAN-21).
    shareholders: founders ? list(founders.founders_dtl).flatMap((f) => (isObject(f) ? one(text(f.name)) : [])) : [],
  };

  const rows: PrefillRow[] = [];
  for (const field of PREFILL_FIELDS) {
    const seen = new Set<string>();
    for (const item of fields[field]) {
      if (seen.has(item.value)) continue;
      if (seen.size === MAX_ROWS) break;
      rows.push({ field, position: seen.size, value: item.value, label: item.label });
      seen.add(item.value);
    }
  }
  return rows;
}

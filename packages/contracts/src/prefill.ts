import { z } from 'zod';

/** Источник предзаполненного значения (MAN-06…MAN-08). e-Ondiris в срезе не пишется. */
export const PREFILL_SOURCES = ['adata', 'e_ondiris'] as const;
/** Девять значений, которые возвращает Adata: пять из MAN-07 и четыре общих с e-Ondiris (MAN-06). Порядок — порядок показа. */
export const PREFILL_FIELDS = [
  'legal_name',
  'activity',
  'company_phone',
  'company_email',
  'legal_address',
  'director_full_name',
  'state_registered_on',
  'legal_form',
  'shareholders',
] as const;
export type PrefillField = (typeof PREFILL_FIELDS)[number];
/** Состояние чтения для производителя. */
export const ADATA_READ_STATES = [
  'not_requested',
  'waiting',
  'received',
  'unavailable',
  'not_configured',
  'quota_exhausted',
] as const;

export const prefilledItemSchema = z.object({
  /** prefilled_value.value */
  value: z.string(),
  /** prefilled_value.label (название ОКЭД), иначе null */
  label: z.string().nullable(),
});

export const prefilledFieldSchema = z.object({
  /** prefilled_value.field */
  field: z.enum(PREFILL_FIELDS),
  /** prefilled_value.source */
  source: z.enum(PREFILL_SOURCES),
  /** prefilled_value.read_at, ISO */
  readAt: z.string(),
  /** Строки по position. */
  items: z.array(prefilledItemSchema).min(1),
});

/** Чтение Adata своего профиля (MAN-07, IMBC-07). Только организация сеанса (GEN-11). */
export const ownAdataReadSchema = z
  .object({
    /** external_check_attempt.state через external_check.latest_attempt_id */
    state: z.enum(ADATA_READ_STATES),
    /** external_check_attempt.requested_at */
    requestedAt: z.string().nullable(),
    /** external_check_attempt.completed_at, только при received */
    readAt: z.string().nullable(),
    /** Только при received; поле, которого Adata не вернул, отсутствует. */
    fields: z.array(prefilledFieldSchema),
  })
  .strict();
export type OwnAdataRead = z.infer<typeof ownAdataReadSchema>;

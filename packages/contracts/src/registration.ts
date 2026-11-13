import { z } from 'zod';
import { LOCALES } from './enums.js';

/** Почта-логин: без пробелов по краям, в нижнем регистре, не длиннее 254 символов (GEN-01). */
export const loginEmailSchema = z
  .string()
  .trim()
  .pipe(z.email().max(254))
  .transform((v) => v.toLowerCase());

/**
 * Саморегистрация производителя (MAN-01): название, БИН, почта компании, ответ «Как вы узнали о нас»,
 * два согласия (условия платформы, политика персональных данных) и принятие текущей версии NDA (FC-02).
 * Пароля в форме нет (AUTH-01); лишний ключ — отказ.
 */
export const registrationRequestSchema = z
  .object({
    companyName: z.string().trim().min(2).max(300),
    bin: z.string().trim(),
    email: loginEmailSchema,
    heardAboutUs: z.string().trim().min(1).max(500),
    acceptPlatformTerms: z.literal(true),
    acceptPersonalData: z.literal(true),
    ndaVersion: z.number().int().positive(),
    locale: z.enum(LOCALES).default('kk'),
  })
  .strict();
export type RegistrationRequest = z.input<typeof registrationRequestSchema>;

/** Начало временного текста (заглушки) соглашения: по нему форма показывает отметку «Заглушка» (FC-02). */
export const LEGAL_PLACEHOLDER_MARKER = /^(PLACEHOLDER|ВРЕМЕННЫЙ ТЕКСТ|УАҚЫТША МӘТІН) — /;

/** Текст текущей версии NDA для формы регистрации (MAN-01, FC-02). */
export const registrationTermsSchema = z
  .object({ nda: z.object({ version: z.number().int().positive(), body: z.string().min(1) }).strict() })
  .strict();
export type RegistrationTerms = z.infer<typeof registrationTermsSchema>;

/**
 * Чтение того же ответа формой: без `.strict()`, чтобы новое необязательное поле API не ломало регистрацию
 * в браузере со старой сборкой (NFR-06), а ответ неверной формы стал ошибкой загрузки, а не «undefined нұсқа».
 */
export const registrationTermsReadSchema = z.object({
  nda: z.object({ version: z.number().int().positive(), body: z.string().min(1) }),
});

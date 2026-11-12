import { z } from 'zod';
import { ACCOUNT_STATES, ORGANIZATION_TYPES, ROLES, type OrganizationType, type Role } from './enums.js';
import { loginEmailSchema } from './registration.js';

/** Аккаунт в списке администратора, только для чтения (ADM-02). Служебных полей user_accounts нет. */
export const adminAccountSchema = z
  .object({
    /** user_accounts.id, .email, .full_name, .role, .state */
    id: z.uuid(),
    email: z.string(),
    fullName: z.string().nullable(),
    role: z.enum(ROLES),
    state: z.enum(ACCOUNT_STATES),
    /** user_accounts.last_sign_in_at, ISO; null — не входил (ADM-02). */
    lastSignInAt: z.string().nullable(),
  })
  .strict();
export type AdminAccount = z.infer<typeof adminAccountSchema>;

/**
 * Организация с аккаунтами. Только поля organizations: БИН и профиль производителя администратору
 * не отдаются (ADM-06).
 */
export const adminOrganizationSchema = z
  .object({
    /** organizations.id, .name, .type, .is_major_operator */
    id: z.uuid(),
    name: z.string(),
    type: z.enum(ORGANIZATION_TYPES),
    isMajorOperator: z.boolean(),
    accounts: z.array(adminAccountSchema),
  })
  .strict();
export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

/**
 * Организации по типу (imbc, operator, observer, manufacturer), затем по имени; аккаунты — по email.
 * `imbcMailbox` — ящик IMBC для писем платформы (раздел 8.2), null — не задан.
 */
export const adminAccountsSchema = z
  .object({ organizations: z.array(adminOrganizationSchema), imbcMailbox: z.string().nullable() })
  .strict();
export type AdminAccounts = z.infer<typeof adminAccountsSchema>;

/** Администратор создаёт организации операторов и наблюдателей (ADM-03); IMBC одна, производителя создаёт регистрация. */
export const CREATABLE_ORGANIZATION_TYPES = ['operator', 'observer'] as const;

/**
 * Роли приглашения по типу организации (раздел 3.1, ADM-01): сотрудники IMBC — SME, администратор и
 * директор; оператор и наблюдатель — своя роль. Производителя нет: его единственный аккаунт создаёт
 * регистрация (GEN-01).
 */
export const INVITABLE_ROLES = {
  imbc: ['expert', 'administrator', 'director'],
  operator: ['operator'],
  observer: ['observer'],
} as const satisfies Record<Exclude<OrganizationType, 'manufacturer'>, readonly Role[]>;

/** Новая организация (ADM-03): отметка major operator — только у оператора (GEN-05). */
export const createOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(300),
    type: z.enum(CREATABLE_ORGANIZATION_TYPES),
    isMajorOperator: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.type === 'operator' || !v.isMajorOperator, {
    path: ['isMajorOperator'],
    message: 'Only an operator organisation can be a major operator',
  });
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Отметка major operator (ADM-03, GEN-05). */
export const majorOperatorSchema = z.object({ isMajorOperator: z.boolean() }).strict();

/** Ящик IMBC (раздел 8.2): адрес в нижнем регистре; null снимает. */
export const imbcMailboxSchema = z.object({ email: loginEmailSchema.nullable() }).strict();
export const imbcMailboxResultSchema = z.object({ imbcMailbox: z.string().nullable() }).strict();
export type ImbcMailboxResult = z.infer<typeof imbcMailboxResultSchema>;

/** Приглашение (ADM-01): почта, имя, роль и организация; языка в форме нет — письмо по-казахски (NOT-19). */
export const inviteAccountSchema = z
  .object({
    email: loginEmailSchema,
    fullName: z.string().trim().min(2).max(200),
    organizationId: z.uuid(),
    role: z.enum(ROLES),
  })
  .strict();
export type InviteAccountInput = z.infer<typeof inviteAccountSchema>;

export const adminAccountResultSchema = z.object({ account: adminAccountSchema }).strict();
export type AdminAccountResult = z.infer<typeof adminAccountResultSchema>;

export const adminOrganizationResultSchema = z
  .object({ organization: adminOrganizationSchema.omit({ accounts: true }) })
  .strict();
export type AdminOrganizationResult = z.infer<typeof adminOrganizationResultSchema>;

/** Повтор приглашения поставлен в очередь (NOT-24, AUTH-01). */
export const invitationResentSchema = z.object({ status: z.literal('password_email_queued') }).strict();
export type InvitationResent = z.infer<typeof invitationResentSchema>;

/**
 * Коды problem+json, которые возвращают маршруты администратора (их сервисы, SessionGuard и поток
 * Keycloak): по ним страница выбирает сообщение. `validation` — ошибка схемы тела, `internal` — сбой 500.
 */
export const ADMIN_PROBLEM_CODES = [
  'validation',
  'unauthenticated',
  'mfa_required',
  'responsibility_required',
  'forbidden',
  'bad_origin',
  'not_found',
  'organization_exists',
  'not_operator',
  'organization_not_invitable',
  'role_not_allowed',
  'email_exists',
  'not_invited',
  'identity_not_bound',
  'identity_unavailable',
  'busy',
  'internal',
] as const;
export type AdminProblemCode = (typeof ADMIN_PROBLEM_CODES)[number];

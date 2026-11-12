import { z } from 'zod';
import { ACCOUNT_STATES, ORGANIZATION_TYPES, ROLES } from './enums.js';

/** Аккаунт в списке администратора, только для чтения (ADM-02). Служебных полей user_accounts нет. */
export const adminAccountSchema = z.object({
  /** user_accounts.id, .email, .full_name, .role, .state */
  id: z.uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(ROLES),
  state: z.enum(ACCOUNT_STATES),
  /** user_accounts.last_sign_in_at, ISO; null — не входил (ADM-02). */
  lastSignInAt: z.string().nullable(),
});
export type AdminAccount = z.infer<typeof adminAccountSchema>;

/**
 * Организация с аккаунтами. Только поля organizations: БИН и профиль производителя администратору
 * не отдаются (ADM-06).
 */
export const adminOrganizationSchema = z.object({
  /** organizations.id, .name, .type, .is_major_operator */
  id: z.uuid(),
  name: z.string(),
  type: z.enum(ORGANIZATION_TYPES),
  isMajorOperator: z.boolean(),
  accounts: z.array(adminAccountSchema),
});
export type AdminOrganization = z.infer<typeof adminOrganizationSchema>;

/** Организации по типу (imbc, operator, observer, manufacturer), затем по имени; аккаунты — по email. */
export const adminAccountsSchema = z.object({ organizations: z.array(adminOrganizationSchema) }).strict();
export type AdminAccounts = z.infer<typeof adminAccountsSchema>;

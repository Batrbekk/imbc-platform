import { sql } from 'drizzle-orm';
import { boolean, index, inet, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './_shared.js';
import { accountState, locale, organizationType, role } from './enums.js';

/** Организация: производитель, оператор, наблюдатель или IMBC (GEN-01…06). */
export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    type: organizationType('type').notNull(),
    name: text('name').notNull(),
    /** БИН хранится текстом (DATA-03); обязателен только у производителя. */
    bin: text('bin'),
    isMajorOperator: boolean('is_major_operator').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organizations_bin_uq')
      .on(t.bin)
      .where(sql`${t.bin} is not null`),
  ],
);

/** Аккаунт. У производителя ровно один (D-01), у остальных — сколько угодно (GEN-02). */
export const userAccounts = pgTable(
  'user_accounts',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    /** Идентификатор пользователя в OIDC-провайдере (sub). */
    idpSubject: text('idp_subject'),
    email: text('email').notNull(),
    fullName: text('full_name'),
    role: role('role').notNull(),
    state: accountState('state').notNull().default('invited'),
    locale: locale('locale').notNull().default('kk'),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    /** Увеличивается при блокировке/смене роли — открытые сеансы отзываются (AUTH-06). */
    authVersion: integer('auth_version').notNull().default(1),
    credentialsChangedAt: timestamp('credentials_changed_at', { withTimezone: true }),
    lastOtpIssuedAt: timestamp('last_otp_issued_at', { withTimezone: true }),
    idpLoggedOutAt: timestamp('idp_logged_out_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_accounts_email_uq').on(sql`lower(${t.email})`),
    uniqueIndex('user_accounts_idp_subject_uq').on(t.idpSubject),
    index('user_accounts_org_idx').on(t.organizationId),
  ],
);

/** Сеанс BFF: 30 минут бездействия, 12 часов абсолютно (AUTH-05, ADR-04). */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    /** SHA-256 от значения cookie; само значение в БД не хранится. */
    tokenHash: text('token_hash').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    authVersion: integer('auth_version').notNull(),
    idTokenHint: text('id_token_hint'),
    idpSessionId: text('idp_session_id'),
    idpAuthTime: timestamp('idp_auth_time', { withTimezone: true }),
    mfaPassed: boolean('mfa_passed').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_idp_session_idx').on(t.idpSessionId),
  ],
);

/** Доверенное устройство: email-код не запрашивается 30 дней (AUTH-03, ADR-20). */
export const trustedDevices = pgTable(
  'trusted_devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => userAccounts.id, { onDelete: 'cascade' }),
    deviceHash: text('device_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('trusted_devices_uq').on(t.userId, t.deviceHash)],
);

/** Одноразовый email-код: 6 цифр, 10 минут, 5 попыток (AUTH-03). */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_codes_session_created_idx').on(t.sessionId, t.createdAt)],
);

/** Atomic PostgreSQL limits work across API replicas and survive process restarts. */
export const authRateLimits = pgTable('auth_rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull(),
});

/** Deduplication for signed backchannel logout and replayed Keycloak events. */
export const authSecurityEvents = pgTable('auth_security_events', {
  eventKey: text('event_key').primaryKey(),
  createdAt: createdAt(),
});

export const authSyncState = pgTable('auth_sync_state', {
  name: text('name').primaryKey(),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
});

/** Logout can arrive before the corresponding OAuth callback creates its BFF session. */
export const revokedIdpSessions = pgTable('revoked_idp_sessions', {
  sid: text('sid').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

/** Принятие ответственности при первом входе (AUTH-10, D-65). */
export const responsibilityAcceptances = pgTable('responsibility_acceptances', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => userAccounts.id),
  textVersion: text('text_version').notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  ip: inet('ip'),
});

/** Ключ pull API организации-оператора (ADM-07, ADR-21). Секрет хранится только хешем. */
export const apiAccess = pgTable(
  'api_access',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    issuedBy: uuid('issued_by').references(() => userAccounts.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => userAccounts.id),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('api_access_prefix_uq').on(t.keyPrefix)],
);

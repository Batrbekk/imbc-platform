import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  inet,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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
    /** Ящик IMBC для писем платформы (DBML, раздел 8.2); задаётся только у организации IMBC. */
    notificationMailbox: text('notification_mailbox'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('organizations_bin_uq')
      .on(t.bin)
      .where(sql`${t.bin} is not null`),
    // Организация IMBC одна: её создаёт миграция 0008, ящик хранится у неё.
    uniqueIndex('organizations_imbc_uq')
      .on(t.type)
      .where(sql`${t.type} = 'imbc'`),
    // Не в DBML: администратор не создаёт второго оператора или наблюдателя с тем же именем (ADM-03).
    // Условие — тип, а не пустой БИН: связь БИН с типом схема не проверяет. Производителей различает
    // БИН (у мигрированного его может не быть), их названия могут совпадать.
    uniqueIndex('organizations_name_uq')
      .on(t.type, sql`lower(${t.name})`)
      .where(sql`${t.type} <> 'manufacturer'`),
    check('organizations_mailbox_imbc_ck', sql`${t.notificationMailbox} is null or ${t.type} = 'imbc'`),
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
    /** Согласия при регистрации производителя (MAN-01): условия платформы и политика персональных данных. */
    platformTermsAcceptedAt: timestamp('platform_terms_accepted_at', { withTimezone: true }),
    personalDataAcceptedAt: timestamp('personal_data_accepted_at', { withTimezone: true }),
    /**
     * Не в DBML: принятие NDA при регистрации, пока профиля нет (FC-02, MAN-01). DBML требует у
     * `nda_acceptance` профиль, а профиль появляется, когда задан пароль (MAN-03): при его создании
     * принятие переносится в `nda_acceptance`, колонки очищаются. Три колонки — все или ни одной.
     */
    registrationNdaVersionId: uuid('registration_nda_version_id').references((): AnyPgColumn => ndaVersion.id),
    registrationNdaAcceptedAt: timestamp('registration_nda_accepted_at', { withTimezone: true }),
    registrationIp: inet('registration_ip'),
    /** Не в DBML (там — колонка профиля `heard_about_us`): ответ регистрации ждёт профиля так же (MAN-01). */
    registrationHeardAboutUs: text('registration_heard_about_us'),
    /** Не в DBML: момент перехода в inactive после трёх месяцев без входа (AUTH-07). */
    inactiveSince: timestamp('inactive_since', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_accounts_email_uq').on(sql`lower(${t.email})`),
    uniqueIndex('user_accounts_idp_subject_uq').on(t.idpSubject),
    index('user_accounts_org_idx').on(t.organizationId),
    // DBML: «one row where the organisation type is manufacturer». Частичный индекс не видит тип
    // организации, поэтому условие — роль: manufacturer бывает только в организации-производителе (GEN-01).
    uniqueIndex('user_accounts_manufacturer_org_uq')
      .on(t.organizationId)
      .where(sql`${t.role} = 'manufacturer'`),
    // Ожидающее принятие NDA: все три колонки или ни одной.
    check(
      'user_accounts_registration_nda_ck',
      sql`num_nulls(${t.registrationNdaVersionId}, ${t.registrationNdaAcceptedAt}, ${t.registrationIp}) in (0, 3)`,
    ),
  ],
);

/**
 * Версия NDA платформы (DBML `nda_version`, FC-02, FC-03). Прежние версии остаются вместе с принятиями;
 * текущая — одна. Отступления от DBML: `published_by` допускает null — версию, загруженную релизом,
 * никто из администраторов не публиковал; `published_at` по умолчанию — момент вставки.
 */
export const ndaVersion = pgTable(
  'nda_version',
  {
    id: id(),
    versionNumber: integer('version_number').notNull(),
    body: text('body').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by').references((): AnyPgColumn => userAccounts.id),
    isCurrent: boolean('is_current').notNull().default(false),
  },
  (t) => [
    uniqueIndex('nda_version_number_uq').on(t.versionNumber),
    // Частичный уникальный индекс не откладывается: смена текущей версии — два UPDATE (снять, затем поставить).
    uniqueIndex('nda_version_current_uq')
      .on(t.isCurrent)
      .where(sql`${t.isCurrent}`),
    check('nda_version_number_ck', sql`${t.versionNumber} > 0`),
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

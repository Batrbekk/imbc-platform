import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AccountState, Locale, Role } from '@imbc/contracts';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { withQueueTransaction } from '../src/database/transaction.js';
import { NOTIFY_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import { MailService } from '../src/mail/mail.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import * as crypto from '../src/modules/auth/crypto.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import {
  defaultNotificationRenderer,
  NotificationDispatcher,
  type NotificationRenderer,
} from '../src/notifications/dispatcher.js';
import { enqueueNotification, type NotifyJob, notifyJobSchema } from '../src/notifications/enqueue.js';
import {
  DEFAULT_RECIPIENT_RESOLVERS,
  type Recipient,
  RecipientPartNotReady,
  type RecipientResolver,
} from '../src/notifications/recipients.js';
import {
  NOTIFICATION_RULE_CODES,
  notificationDedupKey,
  parseRecipientRule,
  RECIPIENT_PARTS,
  type RecipientPart,
} from '../src/notifications/rules.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { fakeTransport } from './support/mail.js';

// Одноразовая БД imbc_auth_test (PostgreSQL 18) и pg-boss; почта — фиктивный транспорт nodemailer, сети нет.
// Диспетчер и MailService работают от роли приложения: у неё нет UPDATE и DELETE на notification.
const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('уведомления: правила-данные, журнал, получатели, язык (NOT-18, NOT-19, NOT-21)', () => {
  vi.setConfig({ testTimeout: 30000 });
  const ROLE = 'imbc_notify_test';
  const env = {
    MAIL_FROM: 'IMBC Platform <no-reply@imbc.local>',
    PUBLIC_URL: 'https://imbc.local',
    SESSION_COOKIE_NAME: '__Host-imbc-session',
    DEVICE_COOKIE_NAME: '__Host-imbc-device',
    COOKIE_SECURE: true,
  } as Env;
  // Письмо NOT-03, которое отправила предыдущая версия (notifications_sent) до миграции 0010.
  const legacy = { subject: randomUUID(), time: 1_700_000_000_000, email: 'Legacy-Locked@Stage2.local' };
  let pool: pg.Pool;
  let db: Database;
  let rolePool: pg.Pool;
  let roleDb: Database;
  let boss: PgBoss;
  let imbcId: string;

  const dropRole = () =>
    pool.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
        REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ROLE};
        REVOKE ALL ON SCHEMA public FROM ${ROLE};
        IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'pgboss_auth_test') THEN
          REVOKE ALL ON ALL TABLES IN SCHEMA pgboss_auth_test FROM ${ROLE};
          REVOKE ALL ON SCHEMA pgboss_auth_test FROM ${ROLE};
        END IF;
        DROP ROLE ${ROLE};
      END IF;
    END $$`);

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool, '0009_stage2_foundation');
    const organization = await pool.query<{ id: string }>(
      "insert into organizations (type, name) values ('operator', 'Оператор прежней версии') returning id",
    );
    await pool.query(
      "insert into user_accounts (organization_id, email, role, idp_subject, locale) values ($1, $2, 'operator', $3, 'ru')",
      [organization.rows[0]!.id, legacy.email.toLowerCase(), legacy.subject],
    );
    await pool.query(
      "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('NOT-03', $1, $2, 'ru')",
      [`${legacy.subject}:${legacy.time}`, legacy.email],
    );
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    imbcId = (await db.select().from(schema.organizations).where(eq(schema.organizations.type, 'imbc')))[0]!.id;
    await dropRole();
    await pool.query(`CREATE ROLE ${ROLE} NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
    await applyAppRoleGrants(pool, ROLE);
    rolePool = new pg.Pool({ connectionString: databaseUrl, max: 6, options: `-c role=${ROLE}` });
    roleDb = drizzle(rolePool, { schema, casing: 'snake_case' });
    boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss_auth_test', supervise: false, schedule: false });
    await boss.start();
    // Повторы как у worker, но без пауз и только два: тест доводит задание до failed за секунды.
    await boss.createQueue(QUEUES.notify, {
      ...NOTIFY_QUEUE_OPTIONS,
      retryLimit: 2,
      retryDelay: 0,
      retryBackoff: false,
    });
    // Задание notify worker ставит от роли приложения (опрос Keycloak); на стенде схемой pg-boss владеет она.
    await pool.query(`GRANT USAGE ON SCHEMA pgboss_auth_test TO ${ROLE}`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss_auth_test TO ${ROLE}`);
  }, 60000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await boss?.stop();
    await rolePool?.end();
    if (pool) await dropRole();
    await pool?.end();
  });

  let seq = 0;
  const address = (name: string) => `${name}-${++seq}-${randomUUID().slice(0, 8)}@stage2.local`;

  async function organization(type: 'manufacturer' | 'operator' | 'observer') {
    const [row] = await db
      .insert(schema.organizations)
      .values({ type, name: `Notify ${type} ${randomUUID()}` })
      .returning();
    return row!;
  }

  async function account(
    role: Role,
    options: { email?: string; locale?: Locale; state?: AccountState; organizationId?: string } = {},
  ) {
    const organizationId =
      options.organizationId ??
      (role === 'manufacturer' || role === 'operator' || role === 'observer' ? (await organization(role)).id : imbcId);
    const [row] = await db
      .insert(schema.userAccounts)
      .values({
        organizationId,
        email: options.email ?? address(role),
        role,
        state: options.state ?? 'active',
        idpSubject: randomUUID(),
        ...(options.locale ? { locale: options.locale } : {}),
      })
      .returning();
    return row!;
  }

  const setMailbox = (value: string | null) =>
    db.update(schema.organizations).set({ notificationMailbox: value }).where(eq(schema.organizations.id, imbcId));

  /** Операторы прежних тестов не мешают: получатели «операторы не blocked» — только из этого теста. */
  const isolateOperators = () =>
    pool.query(
      "update user_accounts set state = 'blocked' where organization_id in (select id from organizations where type = 'operator')",
    );

  type JournalRow = {
    rule_code: string;
    recipient_email: string;
    user_account_id: string | null;
    language: Locale;
    dedup_key: string;
    related_object_type: string | null;
    related_object_id: string | null;
  };
  const journal = async (rule: string, eventKey: string) =>
    (
      await pool.query<JournalRow>(
        `select rule_code, recipient_email, user_account_id, language, dedup_key, related_object_type, related_object_id
           from notification where starts_with(dedup_key, $1) order by recipient_email`,
        [`${rule}\n${eventKey}\n`],
      )
    ).rows;

  const asAccount = (a: { id: string; email: string }): Recipient => ({
    email: a.email,
    source: 'account',
    accountId: a.id,
    languageAccountId: a.id,
  });
  const asContact = (email: string, manufacturerAccountId: string): Recipient => ({
    email,
    source: 'contact',
    accountId: null,
    languageAccountId: manufacturerAccountId,
  });

  // Тексты NOT-04…NOT-17 приходят со своими этапами: здесь — тема с кодом и языком; NOT-03 — настоящий шаблон.
  const testRenderer: NotificationRenderer = (rule, language, params) =>
    rule === 'NOT-03'
      ? defaultNotificationRenderer(rule, language, params)
      : { subject: `${rule} ${language}`, text: `${rule} ${language}`, html: `<p>${rule} ${language}</p>` };

  function setup(options: { overrides?: Partial<Record<RecipientPart, RecipientResolver>>; delayMs?: number } = {}) {
    const transport = fakeTransport({ delayMs: options.delayMs });
    const mail = new MailService(transport.transporter, env, roleDb);
    const dispatcher = new NotificationDispatcher(
      roleDb,
      mail,
      { ...DEFAULT_RECIPIENT_RESOLVERS, ...options.overrides },
      testRenderer,
    );
    return { transport, mail, dispatcher };
  }

  const eventKey = (name: string) => `${name}:${randomUUID()}`;
  const summary = { sent: 0, duplicates: 0, skippedObservers: 0, invalid: 0, skipped: null };

  /** Строки журнала, предупреждения и письма не несут адресов: проверка всех аргументов вызовов журнала. */
  const logged = (...spies: { mock: { calls: unknown[][] } }[]) =>
    JSON.stringify(spies.flatMap((spy) => spy.mock.calls));

  it('повтор события не отправляет второе письмо на тот же адрес: два задания NOT-04 с одним eventKey — одно письмо ящику IMBC, одна строка notification (NOT-18)', async () => {
    const mailbox = address('imbc-review');
    await setMailbox(mailbox);
    const { transport, dispatcher } = setup();
    const job: NotifyJob = { rule: 'NOT-04', eventKey: eventKey('submitted'), params: {} };
    await enqueueNotification(boss, job);
    await enqueueNotification(boss, job);
    const fetched = await boss.fetch<NotifyJob>(QUEUES.notify, { batchSize: 10 });
    const ours = fetched.filter((j) => j.data.eventKey === job.eventKey);
    expect(ours).toHaveLength(2);
    const results = [];
    for (const j of ours) results.push(await dispatcher.dispatch(notifyJobSchema.parse(j.data)));
    await boss.complete(
      QUEUES.notify,
      fetched.map((j) => j.id),
    );
    expect(results).toEqual([
      { ...summary, sent: 1 },
      { ...summary, duplicates: 1 },
    ]);
    expect(transport.sent.map((m) => [m.to, m.subject, m.headers['X-IMBC-Notification']])).toEqual([
      [mailbox, 'NOT-04 kk', 'NOT-04'],
    ]);
    expect(await journal('NOT-04', job.eventKey)).toEqual([
      {
        rule_code: 'NOT-04',
        recipient_email: mailbox,
        user_account_id: null,
        language: 'kk',
        dedup_key: notificationDedupKey('NOT-04', job.eventKey, mailbox),
        related_object_type: null,
        related_object_id: null,
      },
    ]);
  });

  it('один адрес в разном регистре — одно письмо: аккаунт Maker@Stage2.local и контакт maker@stage2.local — одна строка, источник account, язык аккаунта (NOT-18)', async () => {
    const tag = randomUUID().slice(0, 8);
    const maker = await account('manufacturer', { email: `Maker-${tag}@Stage2.local`, locale: 'en' });
    const contact = asContact(`maker-${tag}@stage2.local`, maker.id);
    const { transport, dispatcher } = setup({ overrides: { focal_point: async () => [contact] } });
    // Правило NOT-05 (manufacturer_account+focal_point): аккаунт раньше контакта.
    const first = eventKey('review');
    expect(
      await dispatcher.dispatch({ rule: 'NOT-05', eventKey: first, organizationId: maker.organizationId, params: {} }),
    ).toEqual({ ...summary, sent: 1 });
    // Тот же адрес ещё и третьим получателем в верхнем регистре — всё равно одно письмо.
    const again = setup({
      overrides: { focal_point: async () => [contact, { ...contact, email: contact.email.toUpperCase() }] },
    });
    const second = eventKey('review');
    expect(
      await again.dispatcher.dispatch({
        rule: 'NOT-05',
        eventKey: second,
        organizationId: maker.organizationId,
        params: {},
      }),
    ).toEqual({ ...summary, sent: 1 });
    // Порядок частей обратный (контакт раньше аккаунта) — остаётся аккаунт: выбор по источнику, не по порядку.
    await pool.query(
      "update notification_rule set recipient_rule = 'focal_point+manufacturer_account' where code = 'NOT-05'",
    );
    const third = eventKey('review');
    try {
      expect(
        await dispatcher.dispatch({
          rule: 'NOT-05',
          eventKey: third,
          organizationId: maker.organizationId,
          params: {},
        }),
      ).toEqual({ ...summary, sent: 1 });
    } finally {
      await pool.query(
        "update notification_rule set recipient_rule = 'manufacturer_account+focal_point' where code = 'NOT-05'",
      );
    }
    expect([...transport.sent, ...again.transport.sent].map((m) => [m.to, m.subject])).toEqual([
      [maker.email, 'NOT-05 en'],
      [maker.email, 'NOT-05 en'],
      [maker.email, 'NOT-05 en'],
    ]);
    for (const key of [first, second, third])
      expect(await journal('NOT-05', key)).toEqual([
        expect.objectContaining({
          recipient_email: maker.email,
          user_account_id: maker.id,
          language: 'en',
          dedup_key: notificationDedupKey('NOT-05', key, contact.email),
        }),
      ]);
  });

  it('наблюдателю письмо не уходит: получатель-аккаунт observer и ящик IMBC, равный логину наблюдателя без учёта регистра, пропущены (skippedObservers 2); NOT-03 наблюдателю уходит (NOT-21)', async () => {
    const tag = randomUUID().slice(0, 8);
    const watcherA = await account('observer', { locale: 'ru' });
    const watcherB = await account('observer', { email: `Watcher-B-${tag}@Stage2.local` });
    await setMailbox(`watcher-b-${tag}@STAGE2.local`);
    const { transport, dispatcher } = setup({ overrides: { manufacturer_account: async () => [asAccount(watcherA)] } });
    // NOT-06 (manufacturer_account+imbc_mailbox): аккаунт-наблюдатель и ящик, совпавший с логином наблюдателя.
    const key = eventKey('certificate');
    expect(await dispatcher.dispatch({ rule: 'NOT-06', eventKey: key, params: {} })).toEqual({
      ...summary,
      skippedObservers: 2,
      skipped: 'no_recipients',
    });
    // NOT-08 (person) наблюдателю — тоже нет.
    const reply = eventKey('reply');
    expect(await dispatcher.dispatch({ rule: 'NOT-08', eventKey: reply, accountId: watcherA.id, params: {} })).toEqual({
      ...summary,
      skippedObservers: 1,
      skipped: 'no_recipients',
    });
    expect(transport.sent).toEqual([]);
    expect(await journal('NOT-06', key)).toEqual([]);
    expect(await journal('NOT-08', reply)).toEqual([]);
    // Письма аккаунта (NOT-01…NOT-03) наблюдатель получает: блокировка входа — своему аккаунту (AUTH-04).
    const locked = eventKey(watcherA.idpSubject!);
    expect(
      await dispatcher.dispatch({
        rule: 'NOT-03',
        eventKey: locked,
        accountId: watcherA.id,
        params: { minutes: '15', link: 'https://imbc.local/login' },
      }),
    ).toEqual({ ...summary, sent: 1 });
    expect(transport.sent.map((m) => m.to)).toEqual([watcherA.email]);
    expect(await journal('NOT-03', locked)).toEqual([
      expect.objectContaining({ user_account_id: watcherA.id, language: 'ru' }),
    ]);
    // Наблюдатель B не получил ничего ни на какой регистр своего логина.
    const toB = await pool.query('select 1 from notification where lower(recipient_email) = lower($1)', [
      watcherB.email,
    ]);
    expect(toB.rowCount).toBe(0);
  });

  it('язык письма (NOT-19): аккаунт ru — ru; аккаунт без выбора — kk; контакт — язык аккаунта производителя en; ящик IMBC — kk при языке администратора ru', async () => {
    const russian = await account('operator', { locale: 'ru' });
    const unset = await account('operator');
    expect(unset.locale).toBe('kk');
    const maker = await account('manufacturer', { locale: 'en' });
    // Ящик IMBC совпадает с логином администратора (язык ru): язык ящика не ищется по адресу — kk.
    const admin = await account('administrator', { locale: 'ru' });
    const mailbox = admin.email.toUpperCase();
    await setMailbox(mailbox);
    const contact = asContact(address('contact'), maker.id);
    const { transport, dispatcher } = setup({ overrides: { manufacturer_contacts: async () => [contact] } });

    const replyRu = eventKey('reply');
    const replyKk = eventKey('reply');
    const request = eventKey('request');
    await dispatcher.dispatch({ rule: 'NOT-08', eventKey: replyRu, accountId: russian.id, params: {} });
    await dispatcher.dispatch({ rule: 'NOT-08', eventKey: replyKk, accountId: unset.id, params: {} });
    // NOT-13 (manufacturer_contacts+imbc_mailbox): контакт производителя и ящик IMBC.
    expect(
      await dispatcher.dispatch({
        rule: 'NOT-13',
        eventKey: request,
        organizationId: maker.organizationId,
        params: {},
      }),
    ).toEqual({ ...summary, sent: 2 });

    expect(transport.sent.map((m) => [m.to, m.subject])).toEqual([
      [russian.email, 'NOT-08 ru'],
      [unset.email, 'NOT-08 kk'],
      [contact.email, 'NOT-13 en'],
      [mailbox, 'NOT-13 kk'],
    ]);
    expect((await journal('NOT-08', replyRu)).map((r) => r.language)).toEqual(['ru']);
    expect((await journal('NOT-08', replyKk)).map((r) => r.language)).toEqual(['kk']);
    expect(
      (await journal('NOT-13', request)).map((r) => [r.recipient_email, r.language, r.user_account_id]).sort(),
    ).toEqual(
      [
        [contact.email, 'en', null],
        [mailbox, 'kk', null],
      ].sort(),
    );
  });

  it('ящик IMBC не задан — письма нет, skipped no_recipients, предупреждение без адреса, задание завершено', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const log = vi.spyOn(Logger.prototype, 'log');
    const { transport, dispatcher } = setup();
    for (const value of [null, '   ']) {
      await setMailbox(value);
      const key = eventKey('submitted');
      // Задание завершается (без исключения) — pg-boss его не повторяет, письмо не зацикливается.
      expect(await dispatcher.dispatch({ rule: 'NOT-04', eventKey: key, params: {} })).toEqual({
        ...summary,
        skipped: 'no_recipients',
      });
      expect(await journal('NOT-04', key)).toEqual([]);
    }
    expect(transport.sent).toEqual([]);
    expect(warn).toHaveBeenCalledWith('notification NOT-04: ящик IMBC не задан');
    expect(logged(warn, log)).not.toContain('@');
  });

  it('правило выключено — писем нет, skipped disabled', async () => {
    await setMailbox(address('imbc-disabled'));
    const { transport, dispatcher } = setup();
    await pool.query("update notification_rule set enabled = false where code = 'NOT-07'");
    const key = eventKey('imbc-request');
    try {
      expect(await dispatcher.dispatch({ rule: 'NOT-07', eventKey: key, params: {} })).toEqual({
        ...summary,
        skipped: 'disabled',
      });
    } finally {
      await pool.query("update notification_rule set enabled = true where code = 'NOT-07'");
    }
    expect(transport.sent).toEqual([]);
    expect(await journal('NOT-07', key)).toEqual([]);
  });

  it('сбой SMTP на втором из трёх адресов: первый и третий отправлены, задание падает; повтор отправляет только второй; итог — три строки, три адреса без дублей', async () => {
    await isolateOperators();
    const org = await organization('operator');
    const operators = [];
    for (let i = 0; i < 3; i++) operators.push(await account('operator', { organizationId: org.id }));
    const [first, second, third] = operators as [(typeof operators)[0], (typeof operators)[0], (typeof operators)[0]];
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const log = vi.spyOn(Logger.prototype, 'log');
    const { transport, dispatcher } = setup();
    transport.failWhen((to) => to === second.email);
    const job: NotifyJob = { rule: 'NOT-11', eventKey: eventKey('surveyed'), profileId: randomUUID(), params: {} };

    const failure = await dispatcher.dispatch(job).then(
      () => null,
      (error: unknown) => error as Error,
    );
    expect(failure?.message).toBe('notification NOT-11: 1 не отправлено');
    expect(transport.sent.map((m) => m.to).sort()).toEqual([first.email, third.email].sort());
    expect((await journal('NOT-11', job.eventKey)).map((r) => r.recipient_email).sort()).toEqual(
      [first.email, third.email].sort(),
    );

    // Повтор задания (pg-boss): SMTP снова доступен — уходит только недостающее письмо.
    transport.failWhen(() => false);
    expect(await dispatcher.dispatch(job)).toEqual({ ...summary, sent: 1, duplicates: 2 });
    const addresses = transport.sent.map((m) => m.to);
    expect(addresses.slice(2)).toEqual([second.email]);
    expect([...new Set(addresses)].sort()).toEqual(operators.map((o) => o.email).sort());
    expect(addresses).toHaveLength(3);
    const rows = await journal('NOT-11', job.eventKey);
    expect(rows.map((r) => [r.recipient_email, r.user_account_id]).sort()).toEqual(
      operators.map((o) => [o.email, o.id]).sort(),
    );
    // В журнале процесса и в тексте ошибки адресов нет (NFR-11).
    expect(logged(warn, log)).not.toContain('@');
  });

  it('параллельные задания одного события — одно письмо на адрес', async () => {
    await isolateOperators();
    const org = await organization('operator');
    const operators = [];
    for (let i = 0; i < 3; i++) operators.push(await account('operator', { organizationId: org.id }));
    // Две копии worker с общим SMTP: письмо идёт 40 мс, транзакции пересекаются.
    const one = setup({ delayMs: 40 });
    const mail = new MailService(one.transport.transporter, env, roleDb);
    const two = new NotificationDispatcher(roleDb, mail, DEFAULT_RECIPIENT_RESOLVERS, testRenderer);
    const job: NotifyJob = { rule: 'NOT-11', eventKey: eventKey('surveyed'), params: {} };
    const [a, b] = await Promise.all([one.dispatcher.dispatch(job), two.dispatch(job)]);
    expect(a.sent + b.sent).toBe(3);
    expect(a.duplicates + b.duplicates).toBe(3);
    expect(one.transport.sent.map((m) => m.to).sort()).toEqual(operators.map((o) => o.email).sort());
    expect(await journal('NOT-11', job.eventKey)).toHaveLength(3);
  });

  it('operator_accounts_not_blocked — без blocked, с invited и inactive; manufacturer_account — единственный аккаунт организации производителя; три адреса — три строки журнала (DATA-02)', async () => {
    await isolateOperators();
    const orgA = await organization('operator');
    const orgB = await organization('operator');
    const active = await account('operator', { organizationId: orgA.id });
    const invited = await account('operator', { organizationId: orgA.id, state: 'invited' });
    const inactive = await account('operator', { organizationId: orgB.id, state: 'inactive' });
    await account('operator', { organizationId: orgB.id, state: 'blocked' });
    await account('observer');
    const maker = await account('manufacturer');
    const otherMaker = await account('manufacturer');
    const job: NotifyJob = { rule: 'NOT-11', eventKey: eventKey('surveyed'), params: {} };

    const operators = await DEFAULT_RECIPIENT_RESOLVERS.operator_accounts_not_blocked(roleDb, job);
    expect(operators.map((r) => r.email).sort()).toEqual([active.email, invited.email, inactive.email].sort());
    expect(operators.every((r) => r.source === 'account' && r.languageAccountId === r.accountId)).toBe(true);

    expect(
      await DEFAULT_RECIPIENT_RESOLVERS.manufacturer_account(roleDb, { ...job, organizationId: maker.organizationId }),
    ).toEqual([asAccount(maker)]);
    // По профилю — аккаунт организации профиля.
    const [profile] = await db
      .insert(schema.manufacturerProfiles)
      .values({ organizationId: otherMaker.organizationId })
      .returning();
    expect(await DEFAULT_RECIPIENT_RESOLVERS.manufacturer_account(roleDb, { ...job, profileId: profile!.id })).toEqual([
      asAccount(otherMaker),
    ]);
    expect(await DEFAULT_RECIPIENT_RESOLVERS.person(roleDb, { ...job, accountId: active.id })).toEqual([
      asAccount(active),
    ]);
    const mailbox = address('imbc-parts');
    await setMailbox(mailbox);
    expect(await DEFAULT_RECIPIENT_RESOLVERS.imbc_mailbox(roleDb, job)).toEqual([
      { email: mailbox, source: 'imbc_mailbox', accountId: null, languageAccountId: null },
    ]);

    const { transport, dispatcher } = setup();
    expect(await dispatcher.dispatch(job)).toEqual({ ...summary, sent: 3 });
    expect(transport.sent).toHaveLength(3);
    const rows = await journal('NOT-11', job.eventKey);
    expect(rows.map((r) => r.recipient_email).sort()).toEqual([active.email, invited.email, inactive.email].sort());
  });

  it('каждое из 17 правил разбирается parseRecipientRule; части этапов 3 и 5 бросают RecipientPartNotReady', async () => {
    const rules = await roleDb
      .select({ code: schema.notificationRule.code, recipientRule: schema.notificationRule.recipientRule })
      .from(schema.notificationRule)
      .orderBy(schema.notificationRule.code);
    expect(rules.map((r) => r.code)).toEqual([...NOTIFICATION_RULE_CODES]);
    const used = new Set(rules.flatMap((r) => parseRecipientRule(r.recipientRule)));
    expect([...used].sort()).toEqual([...RECIPIENT_PARTS].sort());
    for (const text of ['person+unknown', '', 'person+', 'Person', ' person'])
      expect(() => parseRecipientRule(text), text).toThrow();

    const job: NotifyJob = { rule: 'NOT-05', eventKey: eventKey('review'), params: {} };
    for (const [part, stage] of [
      ['focal_point', '3'],
      ['manufacturer_contacts', '3'],
      ['assigned_sme_or_imbc_mailbox', '5'],
    ] as const) {
      const error = await DEFAULT_RECIPIENT_RESOLVERS[part](roleDb, job).catch((e: unknown) => e);
      expect(error, part).toBeInstanceOf(RecipientPartNotReady);
      expect(error, part).toMatchObject({ part, stage });
    }
    // Правило с неготовой частью не отправляет и готовую часть: задание падает, письмо придёт с этапом 3.
    const maker = await account('manufacturer');
    const { transport, dispatcher } = setup();
    await expect(dispatcher.dispatch({ ...job, organizationId: maker.organizationId })).rejects.toBeInstanceOf(
      RecipientPartNotReady,
    );
    expect(transport.sent).toEqual([]);
    expect(await journal('NOT-05', job.eventKey)).toEqual([]);
  });

  it('notifyJobSchema: лишний ключ и почта вне params — отклоняются; enqueueNotification ставит задание в транзакции вызывающего', async () => {
    const base = { rule: 'NOT-04', eventKey: eventKey('submitted') } as const;
    expect(notifyJobSchema.parse(base)).toEqual({ ...base, params: {} });
    const otp = { ...base, related: { type: 'otp_code', id: randomUUID() } };
    expect(notifyJobSchema.parse(otp)).toEqual({ ...otp, params: {} });
    const email = 'person@stage2.local';
    for (const bad of [
      { ...base, email },
      { ...base, to: email },
      { ...base, eventKey: `submitted:${email}` },
      { ...base, params: { contact: email } },
      { ...base, related: { type: 'profile', id: randomUUID(), email } },
      { ...base, related: { type: 'Profile', id: randomUUID() } },
      { ...base, related: { type: 'profile-file', id: randomUUID() } },
      { ...base, related: { type: 'x'.repeat(65), id: randomUUID() } },
      { ...base, rule: 'unknown' },
      { ...base, accountId: 'not-a-uuid' },
      { ...base, eventKey: '' },
      { ...base, params: { long: 'x'.repeat(501) } },
    ]) {
      const parsed = notifyJobSchema.safeParse(bad);
      expect(parsed.success, JSON.stringify(Object.keys(bad))).toBe(false);
      // Текст ошибки разбора не повторяет значения: адреса в нём нет.
      expect(JSON.stringify(parsed.error?.issues)).not.toContain(email);
    }

    const job: NotifyJob = { ...base, related: { type: 'profile', id: randomUUID() }, params: { section: 'contacts' } };
    const queued = async () =>
      (
        await pool.query<{ data: NotifyJob }>(
          `select data from pgboss_auth_test.job where name = $1 and data->>'eventKey' = $2`,
          [QUEUES.notify, job.eventKey],
        )
      ).rows.map((r) => r.data);
    // Откат транзакции вызывающего — задания нет.
    await expect(
      withQueueTransaction(pool, async (_tx, queueDb) => {
        await enqueueNotification(boss, job, queueDb);
        expect(
          (
            await queueDb.executeSql(`select 1 from pgboss_auth_test.job where name = $1 and data->>'eventKey' = $2`, [
              QUEUES.notify,
              job.eventKey,
            ])
          ).rows,
        ).toHaveLength(1);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await queued()).toEqual([]);
    // Неверное задание не ставится вовсе.
    await expect(
      withQueueTransaction(pool, (_tx, queueDb) =>
        enqueueNotification(boss, { ...job, params: { to: email } }, queueDb),
      ),
    ).rejects.toThrow();
    expect(await queued()).toEqual([]);
    // Фиксация — одно задание с id, кодом и параметрами, без адресов.
    await withQueueTransaction(pool, (_tx, queueDb) => enqueueNotification(boss, job, queueDb));
    expect(await queued()).toEqual([job]);
    await boss.deleteAllJobs(QUEUES.notify);
  });

  /** Worker с заглушкой Keycloak: пакет событий задан тестом, онбординг не участвует; транзакции — от роли приложения. */
  function keycloakWorker(events: () => object[], sessions = new SessionService(roleDb, env)) {
    return new JobHandlers(
      roleDb,
      {} as never,
      env,
      new AuditService(roleDb),
      { securityEvents: vi.fn(async () => events()) } as never,
      sessions,
      { onPasswordSet: vi.fn() } as never,
      rolePool,
      boss,
    );
  }

  const lockouts = async (accountId: string) =>
    db
      .select()
      .from(schema.auditEntries)
      .where(and(eq(schema.auditEntries.action, 'auth.locked_out'), eq(schema.auditEntries.objectId, accountId)));

  const cursor = async () =>
    (await db.query.authSyncState.findFirst({ where: eq(schema.authSyncState.name, 'keycloak-events') }))?.checkedAt;

  type QueuedJob = { state: string; retry_count: number; data: NotifyJob };
  /** Задания notify события — в любом состоянии (created, retry, completed, failed). */
  const notifyJobs = async (key: string) =>
    (
      await pool.query<QueuedJob>(
        `select state, retry_count, data from pgboss_auth_test.job where name = $1 and data->>'eventKey' = $2`,
        [QUEUES.notify, key],
      )
    ).rows;

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  async function until(check: () => Promise<boolean> | boolean, what: string, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    while (!(await check())) {
      if (Date.now() > deadline) throw new Error(`не дождались: ${what}`);
      await pause(20);
    }
  }

  /**
   * Цикл worker очереди notify, как в WorkerModule: задание — `runJob`; исключение — `fail`, дальше повтор по
   * правилам очереди (в тесте — два повтора без пауз). Идёт, пока в очереди есть живые задания.
   */
  async function drain(dispatcher: NotificationDispatcher) {
    const live = async () =>
      (
        await pool.query<{ n: number }>(
          `select count(*)::int as n from pgboss_auth_test.job where name = $1 and state in ('created', 'retry', 'active')`,
          [QUEUES.notify],
        )
      ).rows[0]!.n;
    for (let round = 0; round < 50 && (await live()) > 0; round++) {
      const jobs = await boss.fetch<unknown>(QUEUES.notify, { batchSize: 20 });
      if (jobs.length === 0) {
        await pause(20);
        continue;
      }
      for (const job of jobs) {
        try {
          await dispatcher.runJob(job.data);
          await boss.complete(QUEUES.notify, job.id);
        } catch (error) {
          await boss.fail(QUEUES.notify, job.id, { message: (error as Error).message });
        }
      }
    }
    expect(await live()).toBe(0);
  }

  const lockout = (user: { idpSubject: string | null }, time: number) => ({
    type: 'USER_DISABLED_BY_TEMPORARY_LOCKOUT',
    userId: user.idpSubject,
    time,
  });

  it('NOT-03 по блокировке входа: задание notify и аудит auth.locked_out одной транзакцией, письмо — из задания на языке аккаунта; повтор и параллельный опрос — одно задание, одна запись аудита, одно письмо', async () => {
    await boss.deleteAllJobs(QUEUES.notify);
    const user = await account('operator', { locale: 'ru' });
    const time = Date.now() - 5000;
    const key = `${user.idpSubject}:${time}`;
    const { transport, dispatcher } = setup();
    const worker = keycloakWorker(() => [{ id: `lock-${user.id}`, ...lockout(user, time) }]);
    await worker.keycloakEvents();
    // Опрос письма не шлёт: задание и аудит есть, письма ещё нет.
    expect(transport.sent).toEqual([]);
    const [job] = await notifyJobs(key);
    expect(job?.data).toEqual({
      rule: 'NOT-03',
      eventKey: key,
      accountId: user.id,
      params: { minutes: '15', link: 'https://imbc.local/login' },
    });
    expect(JSON.stringify(job?.data)).not.toContain('@');
    const [audit] = await lockouts(user.id);
    expect(audit).toMatchObject({ outcome: 'denied', isAccountEvent: true, objectType: 'account', userId: user.id });
    expect(JSON.stringify(audit)).not.toContain(user.email);

    await drain(dispatcher);
    expect(transport.sent).toHaveLength(1);
    const [mail] = transport.sent;
    expect(mail!.to).toBe(user.email);
    expect(mail!.headers['X-IMBC-Notification']).toBe('NOT-03');
    expect(mail!.subject).toBe('Учётная запись в платформе IMBC временно заблокирована');
    expect(mail!.text).toContain('заблокирован на 15 минут');
    expect(mail!.text).toContain('https://imbc.local/login');
    expect(await journal('NOT-03', key)).toEqual([
      {
        rule_code: 'NOT-03',
        recipient_email: user.email,
        user_account_id: user.id,
        language: 'ru',
        dedup_key: notificationDedupKey('NOT-03', key, user.email),
        related_object_type: null,
        related_object_id: null,
      },
    ]);

    // Перекрытие окон опроса и два опроса разом: отметка события одна — ни второго задания, ни второго аудита.
    await worker.keycloakEvents();
    await Promise.all([worker.keycloakEvents(), worker.keycloakEvents()]);
    await drain(dispatcher);
    expect((await notifyJobs(key)).map((j) => j.state)).toEqual(['completed']);
    expect(await lockouts(user.id)).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
    expect(await journal('NOT-03', key)).toHaveLength(1);
  });

  it('SMTP навсегда отклоняет адрес: курсор сдвинулся, остальные события пакета обработаны один раз, аудит блокировки один, задание notify повторяется и в итоге failed, опрос не стоит (AUTH-04)', async () => {
    await boss.deleteAllJobs(QUEUES.notify);
    const rejected = await account('operator');
    const fine = await account('operator', { locale: 'en' });
    const changed = await account('operator');
    const time = Date.now() - 4000;
    const events = [
      lockout(rejected, time),
      lockout(fine, time + 1),
      { id: `pw-${changed.id}`, type: 'UPDATE_PASSWORD', userId: changed.idpSubject, time: time + 2 },
    ];
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const log = vi.spyOn(Logger.prototype, 'log');
    const error = vi.spyOn(Logger.prototype, 'error');
    const { transport, dispatcher } = setup();
    transport.failWhen((to) => to === rejected.email);
    const worker = keycloakWorker(() => events);

    const before = await cursor();
    await worker.keycloakEvents();
    const moved = await cursor();
    expect(moved).toBeDefined();
    expect(moved).not.toEqual(before);
    await drain(dispatcher);
    // Отклонённый адрес: 1 попытка + 2 повтора, затем failed; письмо другому адресу — одно.
    expect((await notifyJobs(`${rejected.idpSubject}:${time}`)).map((j) => [j.state, j.retry_count])).toEqual([
      ['failed', 2],
    ]);
    expect(transport.attempts.get(rejected.email)).toBe(3);
    expect((await notifyJobs(`${fine.idpSubject}:${time + 1}`)).map((j) => j.state)).toEqual(['completed']);
    expect(transport.sent.map((m) => m.to)).toEqual([fine.email]);
    expect(await lockouts(rejected.id)).toHaveLength(1);
    expect(await lockouts(fine.id)).toHaveLength(1);
    const versionOf = async (id: string) =>
      (await db.query.userAccounts.findFirst({ where: eq(schema.userAccounts.id, id) }))!.authVersion;
    expect(await versionOf(changed.id)).toBe(changed.authVersion + 1);

    // Следующий опрос с перекрытием окна: курсор снова сдвигается, события пакета не повторяются.
    await worker.keycloakEvents();
    expect(await cursor()).not.toEqual(moved);
    await drain(dispatcher);
    expect(await notifyJobs(`${rejected.idpSubject}:${time}`)).toHaveLength(1);
    expect(await notifyJobs(`${fine.idpSubject}:${time + 1}`)).toHaveLength(1);
    expect(transport.attempts.get(rejected.email)).toBe(3);
    expect(transport.sent).toHaveLength(1);
    expect(await lockouts(rejected.id)).toHaveLength(1);
    expect(await versionOf(changed.id)).toBe(changed.authVersion + 1);
    expect(logged(warn, log, error)).not.toContain('@');
  });

  it('временный сбой SMTP: письмо NOT-03 уходит со следующей попытки задания, одно', async () => {
    await boss.deleteAllJobs(QUEUES.notify);
    const user = await account('operator');
    const time = Date.now() - 3000;
    const { transport, dispatcher } = setup();
    transport.failWhen((to, attempt) => to === user.email && attempt === 1);
    await keycloakWorker(() => [lockout(user, time)]).keycloakEvents();
    await drain(dispatcher);
    const key = `${user.idpSubject}:${time}`;
    expect((await notifyJobs(key)).map((j) => [j.state, j.retry_count])).toEqual([['completed', 1]]);
    expect(transport.attempts.get(user.email)).toBe(2);
    expect(transport.sent.map((m) => m.to)).toEqual([user.email]);
    expect(await journal('NOT-03', key)).toHaveLength(1);
    expect(await lockouts(user.id)).toHaveLength(1);
  });

  it('NOT-03, отправленное предыдущей версией: ключ журнала из 0010 совпадает с notificationDedupKey; тот же пакет событий не ставит ни задания, ни аудита (NOT-18)', async () => {
    const key = `${legacy.subject}:${legacy.time}`;
    const [row] = await journal('NOT-03', key);
    // Формат ключа один в SQL миграции и в коде: код, ключ события, адрес в нижнем регистре.
    expect(row?.dedup_key).toBe(notificationDedupKey('NOT-03', key, legacy.email));
    expect(row?.dedup_key).toBe(`NOT-03\n${key}\n${legacy.email.toLowerCase()}`);
    const user = (await db.query.userAccounts.findFirst({
      where: eq(schema.userAccounts.idpSubject, legacy.subject),
    }))!;
    await keycloakWorker(() => [
      { type: 'USER_DISABLED_BY_TEMPORARY_LOCKOUT', userId: legacy.subject, time: legacy.time },
    ]).keycloakEvents();
    expect(await notifyJobs(key)).toEqual([]);
    expect(await journal('NOT-03', key)).toHaveLength(1);
    expect(await lockouts(user.id)).toEqual([]);
  });

  it('окно выката (NFR-06): NOT-03, которое прежняя версия записала в notifications_sent после постановки задания, считается отправленным — письма и строки журнала нет', async () => {
    await boss.deleteAllJobs(QUEUES.notify);
    const user = await account('operator', { locale: 'ru' });
    const time = Date.now() - 2000;
    const key = `${user.idpSubject}:${time}`;
    await keycloakWorker(() => [lockout(user, time)]).keycloakEvents();
    expect(await notifyJobs(key)).toHaveLength(1);
    // Прежняя версия worker обработала ту же блокировку раньше нашего задания (адрес — в другом регистре).
    await pool.query(
      "insert into notifications_sent (code, dedupe_key, recipient, locale) values ('NOT-03', $1, $2, 'ru')",
      [key, user.email.toUpperCase()],
    );
    const { transport, dispatcher } = setup();
    const log = vi.spyOn(Logger.prototype, 'log');
    await drain(dispatcher);
    expect(transport.sent).toEqual([]);
    expect(await journal('NOT-03', key)).toEqual([]);
    expect((await notifyJobs(key)).map((j) => j.state)).toEqual(['completed']);
    expect(log).toHaveBeenCalledWith('notification NOT-03: sent 0, duplicates 1, observers 0, invalid 0');
  });

  it('гонка, вторая ветка: первая транзакция откатилась по сбою SMTP — ждавшая на уникальном индексе отправляет сама; одно письмо, одна строка журнала', async () => {
    const user = await account('operator');
    const one = setup();
    const two = new NotificationDispatcher(
      roleDb,
      new MailService(one.transport.transporter, env, roleDb),
      DEFAULT_RECIPIENT_RESOLVERS,
      testRenderer,
    );
    one.transport.failWhen((to, attempt) => to === user.email && attempt === 1);
    const job: NotifyJob = { rule: 'NOT-08', eventKey: eventKey('reply'), accountId: user.id, params: {} };
    const release = one.transport.hold();
    // Первая копия вставила строку журнала и ждёт SMTP; вторая встаёт на уникальный индекс dedup_key.
    const first = one.dispatcher.dispatch(job).then(
      (value) => ({ ok: true as const, value }),
      (reason: unknown) => ({ ok: false as const, reason: reason as Error }),
    );
    await until(() => one.transport.state.pending === 1, 'первая отправка в SMTP');
    const second = two.dispatch(job);
    await until(
      async () =>
        (
          await pool.query<{ n: number }>(
            "select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike 'insert into \"notification\"%'",
          )
        ).rows[0]!.n === 1,
      'вторая вставка ждёт блокировку',
    );
    release();
    const outcome = await first;
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.reason.message).toBe('notification NOT-08: 1 не отправлено');
    expect(await second).toEqual({ ...summary, sent: 1 });
    expect(one.transport.attempts.get(user.email)).toBe(2);
    expect(one.transport.sent.map((m) => m.to)).toEqual([user.email]);
    expect(await journal('NOT-08', job.eventKey)).toHaveLength(1);
  });

  it('постоянный отказ — задание завершается сразу со строкой журнала, без повторов (неверное задание, часть этапа 3, нет текста, нет подстановки, нет правила); временный сбой — повторы до failed', async () => {
    await boss.deleteAllJobs(QUEUES.notify);
    await setMailbox(address('imbc-permanent'));
    const maker = await account('manufacturer');
    const operator = await account('operator');
    const error = vi.spyOn(Logger.prototype, 'error');
    const warn = vi.spyOn(Logger.prototype, 'warn');
    // Рендерер по умолчанию: текста NOT-04 ещё нет (этап 5), у NOT-03 есть.
    const transport = fakeTransport();
    const dispatcher = new NotificationDispatcher(
      roleDb,
      new MailService(transport.transporter, env, roleDb),
      DEFAULT_RECIPIENT_RESOLVERS,
      defaultNotificationRenderer,
    );
    const keys = {
      invalid: eventKey('invalid'),
      notReady: eventKey('review'),
      noText: eventKey('submitted'),
      noParam: eventKey('locked'),
      noRule: eventKey('pause'),
    };
    // Мимо enqueueNotification — как испорченная строка задания.
    await boss.send(QUEUES.notify, { rule: 'NOT-04', eventKey: keys.invalid, recipient: 'someone@stage2.local' });
    await enqueueNotification(boss, {
      rule: 'NOT-05',
      eventKey: keys.notReady,
      organizationId: maker.organizationId,
      params: {},
    });
    await enqueueNotification(boss, { rule: 'NOT-04', eventKey: keys.noText, params: {} });
    await enqueueNotification(boss, {
      rule: 'NOT-03',
      eventKey: keys.noParam,
      accountId: operator.id,
      params: { minutes: '15' },
    });
    await enqueueNotification(boss, { rule: 'NOT-17', eventKey: keys.noRule, accountId: operator.id, params: {} });
    await pool.query("update notification_rule set code = 'retired-17' where code = 'NOT-17'");
    try {
      await drain(dispatcher);
    } finally {
      await pool.query("update notification_rule set code = 'NOT-17' where code = 'retired-17'");
    }
    for (const key of Object.values(keys))
      expect(
        (await notifyJobs(key)).map((j) => [j.state, j.retry_count]),
        key,
      ).toEqual([['completed', 0]]);
    expect(transport.sent).toEqual([]);
    const lines = error.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual(
      expect.arrayContaining([
        'notification NOT-04: задание отклонено без повторов — неверные поля: job:unrecognized_keys',
        'notification NOT-05: письмо не будет отправлено, без повторов — notification: часть получателей focal_point появится на этапе 3',
        'notification NOT-04: письмо не будет отправлено, без повторов — notification NOT-04: нет текста письма',
        'notification NOT-03: письмо не будет отправлено, без повторов — mail NOT-03: нет подстановки {link}',
        'notification NOT-17: письмо не будет отправлено, без повторов — notification NOT-17: правила нет в notification_rule',
      ]),
    );
    expect(lines).toHaveLength(5);

    // Временный сбой (база резолвера, SMTP) — повторы pg-boss до failed, письма нет.
    const flaky = new NotificationDispatcher(
      roleDb,
      new MailService(transport.transporter, env, roleDb),
      {
        ...DEFAULT_RECIPIENT_RESOLVERS,
        person: async () => {
          throw new Error('connection terminated unexpectedly');
        },
      },
      defaultNotificationRenderer,
    );
    const transient = eventKey('locked');
    await enqueueNotification(boss, {
      rule: 'NOT-03',
      eventKey: transient,
      accountId: operator.id,
      params: { minutes: '15', link: 'https://imbc.local/login' },
    });
    await drain(flaky);
    expect((await notifyJobs(transient)).map((j) => [j.state, j.retry_count])).toEqual([['failed', 2]]);
    expect(error.mock.calls).toHaveLength(5);
    expect(logged(error, warn)).not.toContain('@');
  });

  it('NOT-02: строка журнала с NOT-02, адресом, языком и related otp_code; кода нет ни в одной колонке; сбой SMTP — строки нет', async () => {
    vi.spyOn(crypto, 'sixDigitCode').mockReturnValue('739104');
    const sessions = new SessionService(roleDb, env);
    const { transport, mail } = setup();
    const controller = new AuthController(
      {} as never,
      sessions,
      new AuditService(roleDb),
      mail,
      new AuthRateLimitService(roleDb),
      env,
      {} as never,
      {} as never,
    );
    const signedIn = async (user: typeof schema.userAccounts.$inferSelect) => {
      const entry = await sessions.create({
        userId: user.id,
        authVersion: user.authVersion,
        idToken: null,
        idpSessionId: randomUUID(),
        idpAuthTime: new Date(Math.floor(Date.now() / 1000) * 1000),
        ip: null,
        userAgent: 'test',
      });
      return { entry, auth: (await sessions.resolve(entry.token))! };
    };
    const rowsOf = async (accountId: string) =>
      (
        await pool.query<JournalRow>(
          `select rule_code, recipient_email, user_account_id, language, dedup_key, related_object_type, related_object_id, sent_at
             from notification where user_account_id = $1`,
          [accountId],
        )
      ).rows;

    const user = await account('operator', { locale: 'en' });
    const { entry, auth } = await signedIn(user);
    expect(await controller.sendOtp(auth, { ip: '127.0.0.61' } as never)).toMatchObject({ sent: true });
    const [otp] = await db.select().from(schema.otpCodes).where(eq(schema.otpCodes.sessionId, entry.id));
    expect(transport.sent.map((m) => [m.to, m.headers['X-IMBC-Notification']])).toEqual([[user.email, 'NOT-02']]);
    expect(transport.sent[0]!.subject).toBe('IMBC Platform sign-in code: 739104');
    const rows = await rowsOf(user.id);
    expect(rows).toEqual([
      expect.objectContaining({
        rule_code: 'NOT-02',
        recipient_email: user.email,
        user_account_id: user.id,
        language: 'en',
        dedup_key: notificationDedupKey('NOT-02', `otp:${otp!.id}`, user.email),
        related_object_type: 'otp_code',
        related_object_id: otp!.id,
      }),
    ]);
    // Сам код в журнале не хранится.
    expect(JSON.stringify(rows)).not.toContain('739104');

    // SMTP недоступен: 503, код отброшен, строки журнала нет — повтор запроса отправит новый код.
    const unlucky = await account('operator');
    const second = await signedIn(unlucky);
    transport.failWhen((to) => to === unlucky.email);
    await expect(controller.sendOtp(second.auth, { ip: '127.0.0.62' } as never)).rejects.toMatchObject({
      code: 'mail_unavailable',
    });
    await expect(controller.sendOtp(second.auth, { ip: '127.0.0.62' } as never)).rejects.toBeInstanceOf(
      ProblemException,
    );
    expect(await rowsOf(unlucky.id)).toEqual([]);
    expect(await db.select().from(schema.otpCodes).where(eq(schema.otpCodes.sessionId, second.entry.id))).toEqual([]);

    // Письмо ушло, а строка журнала не записалась (база недоступна): вход не ломается, предупреждение без адреса.
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const brokenJournal = {
      insert: () => {
        throw new Error('connection terminated unexpectedly');
      },
    } as unknown as Database;
    const fragile = new AuthController(
      {} as never,
      sessions,
      new AuditService(roleDb),
      new MailService(transport.transporter, env, brokenJournal),
      new AuthRateLimitService(roleDb),
      env,
      {} as never,
      {} as never,
    );
    transport.failWhen(() => false);
    const lucky = await account('operator');
    const third = await signedIn(lucky);
    expect(await fragile.sendOtp(third.auth, { ip: '127.0.0.63' } as never)).toMatchObject({ sent: true });
    expect(transport.sent.map((m) => m.to)).toContain(lucky.email);
    expect(await rowsOf(lucky.id)).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { error: 'Error' },
      'notification NOT-02: письмо отправлено, строка журнала не записана',
    );
    expect(logged(warn)).not.toContain('@');
  });

  it('NOT-02 не держит соединение базы на время SMTP: пока письмо «висит», запрос из того же пула (max 1) проходит', async () => {
    const single = new pg.Pool({ connectionString: databaseUrl, max: 1, options: `-c role=${ROLE}` });
    try {
      const singleDb = drizzle(single, { schema, casing: 'snake_case' });
      const sessions = new SessionService(singleDb, env);
      const transport = fakeTransport();
      const controller = new AuthController(
        {} as never,
        sessions,
        new AuditService(singleDb),
        new MailService(transport.transporter, env, singleDb),
        new AuthRateLimitService(singleDb),
        env,
        {} as never,
        {} as never,
      );
      const user = await account('operator');
      const entry = await sessions.create({
        userId: user.id,
        authVersion: user.authVersion,
        idToken: null,
        idpSessionId: randomUUID(),
        idpAuthTime: new Date(Math.floor(Date.now() / 1000) * 1000),
        ip: null,
        userAgent: 'test',
      });
      const auth = (await sessions.resolve(entry.token))!;
      const release = transport.hold();
      const sending = controller.sendOtp(auth, { ip: '127.0.0.64' } as never);
      try {
        await until(() => transport.state.pending === 1, 'код входа в SMTP');
        const probe = await Promise.race([
          single.query<{ ok: number }>('select 1 as ok').then((r) => r.rows[0]!.ok),
          pause(3000).then(() => 'пул занят'),
        ]);
        expect(probe).toBe(1);
      } finally {
        release();
      }
      expect(await sending).toMatchObject({ sent: true });
      const rows = await pool.query('select rule_code from notification where user_account_id = $1', [user.id]);
      expect(rows.rows).toEqual([{ rule_code: 'NOT-02' }]);
    } finally {
      await single.end();
    }
  });
});

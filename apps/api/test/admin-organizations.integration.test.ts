import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type Role } from '@imbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ZodError } from 'zod';
import { AuditService } from '../src/common/audit.service.js';
import { ProblemException } from '../src/common/problem.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { boundLockWaits, sqlState } from '../src/database/lock-waits.js';
import { seedDemo } from '../src/database/seed.js';
import { QUEUES } from '../src/jobs/queues.js';
import type { AccountLifecycleService } from '../src/modules/admin/account-lifecycle.service.js';
import { AccountsController } from '../src/modules/admin/accounts.controller.js';
import { AccountsService } from '../src/modules/admin/accounts.service.js';
import { InvitationsService } from '../src/modules/admin/invitations.service.js';
import { OrganizationsController } from '../src/modules/admin/organizations.controller.js';
import { ADMIN_ROUTES, lockActor, OrganizationsService } from '../src/modules/admin/organizations.service.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import { KeycloakAdminService, KeycloakRequestError } from '../src/modules/auth/keycloak-admin.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

// Одноразовая БД imbc_auth_test и pg-boss; Keycloak — объект с vi.fn; почта — только *.local.
const databaseUrl = process.env.TEST_DATABASE_URL;
const REQUEST = { ip: '192.0.2.10' } as never;

type Keycloak = Pick<KeycloakAdminService, 'createUser' | 'deleteUser'>;

describe.skipIf(!databaseUrl)(
  'администратор: организации, приглашения, ящик IMBC (ADM-01, ADM-03, GEN-05, NOT-24)',
  () => {
    vi.setConfig({ testTimeout: 30000 });
    let pool: pg.Pool;
    let db: Database;
    let boss: PgBoss;
    let admin: AuthContext;
    let imbcId: string;
    let keycloak: { createUser: Mock<Keycloak['createUser']>; deleteUser: Mock<Keycloak['deleteUser']> };

    const organizationsController = () =>
      new OrganizationsController(new OrganizationsService(db, new AuditService(db)));
    const accountsController = (identity: Keycloak = keycloak, queue: PgBoss = boss) =>
      new AccountsController(
        new AccountsService(db),
        new InvitationsService(
          db,
          pool,
          boss,
          new IdentityProvisioningService(pool, queue, identity as KeycloakAdminService),
          new AuditService(db),
        ),
        // Блокировка, роль и почта — account-lifecycle.integration.test.ts.
        {} as AccountLifecycleService,
      );

    /** Код и статус отказа ProblemException. */
    const problem = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ProblemException);
      const p = error as ProblemException;
      return { status: p.getStatus(), code: p.code };
    };

    const audits = async (action: string, objectId?: string) =>
      (
        await pool.query<{
          diff: unknown;
          is_account_event: boolean;
          ip: string | null;
          user_id: string;
          outcome: string;
        }>(
          `select diff, is_account_event, host(ip) as ip, user_id, outcome from audit_entries
          where action = $1 and ($2::text is null or object_id = $2) order by at, id`,
          [action, objectId ?? null],
        )
      ).rows;

    const jobs = async (subject: string) =>
      Number(
        (
          await pool.query<{ n: string }>(
            `select count(*) as n from pgboss_auth_test.job where name = $1 and data->>'subject' = $2`,
            [QUEUES.sendPasswordEmail, subject],
          )
        ).rows[0]!.n,
      );

    /** Задания письма субъекта и число разных минутных окон singletonKey среди них. */
    const jobSlots = async (subject: string) => {
      const { rows } = await pool.query<{ n: string; slots: string }>(
        `select count(*) as n, count(distinct singleton_on) as slots from pgboss_auth_test.job
          where name = $1 and data->>'subject' = $2`,
        [QUEUES.sendPasswordEmail, subject],
      );
      return { count: Number(rows[0]!.n), slots: Number(rows[0]!.slots) };
    };

    /** Второй администратор IMBC в состоянии `state`. */
    const administrator = async (state: 'active' | 'blocked' = 'active'): Promise<AuthContext> => {
      const id = randomUUID();
      await db
        .insert(schema.userAccounts)
        .values({ id, organizationId: imbcId, email: `${id}@imbc.local`, role: 'administrator', state });
      return { ...admin, user: { ...admin.user, id, email: `${id}@imbc.local` } };
    };

    const accountRow = (email: string) =>
      db.query.userAccounts.findFirst({ where: sql`lower(${schema.userAccounts.email}) = ${email}` });

    const createOrganization = async (type: 'operator' | 'observer', name = `${type} ${randomUUID()}`) =>
      (await organizationsController().create(admin, { name, type }, REQUEST)).organization;

    const invite = (organizationId: string, role: Role, email = `${randomUUID()}@invite.local`) =>
      accountsController().invite(admin, { email, fullName: 'Приглашённый Сотрудник', organizationId, role }, REQUEST);

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
      await seedDemo(pool);
      db = drizzle(pool, { schema, casing: 'snake_case' });
      boss = new PgBoss({
        connectionString: databaseUrl,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      await boss.createQueue(QUEUES.sendPasswordEmail, { retryLimit: 10, retryDelay: 0 });
      await boss.createQueue(QUEUES.cleanupIdentity);

      // Исполнитель — администратор seed, вошедший (транзакция действия проверяет active administrator).
      await pool.query(`update user_accounts set state = 'active' where lower(email) = 'admin@imbc.local'`);
      const row = (await accountRow('admin@imbc.local'))!;
      imbcId = row.organizationId;
      admin = {
        sessionId: randomUUID(),
        mfaPassed: true,
        responsibilityAccepted: true,
        user: {
          id: row.id,
          email: row.email,
          fullName: row.fullName,
          role: 'administrator',
          organizationId: row.organizationId,
          organizationType: 'imbc',
          locale: row.locale,
        },
      };
    }, 60000);

    beforeEach(() => {
      keycloak = {
        createUser: vi.fn<Keycloak['createUser']>(async () => randomUUID()),
        deleteUser: vi.fn<Keycloak['deleteUser']>().mockResolvedValue(undefined),
      };
    });

    afterAll(async () => {
      await boss?.stop();
      await pool?.end();
    });

    it('оператор и наблюдатель создаются; major только у оператора; тот же тип и имя без учёта регистра — 409 organization_exists; тип manufacturer или imbc — 400 (ADM-03, GEN-05)', async () => {
      const controller = organizationsController();
      const name = `Оператор ${randomUUID()}`;
      const operator = await controller.create(
        admin,
        { name: `  ${name} `, type: 'operator', isMajorOperator: true },
        REQUEST,
      );
      expect(operator).toEqual({
        organization: { id: expect.any(String), name, type: 'operator', isMajorOperator: true },
      });
      const observer = await controller.create(admin, { name, type: 'observer' }, REQUEST);
      // Наблюдатель с тем же именем — другой тип, допускается; отметки major у него нет.
      expect(observer.organization).toMatchObject({ name, type: 'observer', isMajorOperator: false });

      const [created] = await audits('organization.created', operator.organization.id);
      expect(created).toMatchObject({
        diff: { name, type: 'operator', isMajorOperator: true },
        is_account_event: true,
        ip: '192.0.2.10',
        user_id: admin.user.id,
        outcome: 'ok',
      });

      expect(await problem(controller.create(admin, { name: name.toUpperCase(), type: 'operator' }, REQUEST))).toEqual({
        status: 409,
        code: 'organization_exists',
      });
      await expect(
        controller.create(admin, { name, type: 'observer', isMajorOperator: true }, REQUEST),
      ).rejects.toBeInstanceOf(ZodError);
      for (const type of ['manufacturer', 'imbc'])
        await expect(controller.create(admin, { name: `Тип ${type}`, type }, REQUEST)).rejects.toBeInstanceOf(ZodError);
      await expect(
        controller.create(admin, { name: 'Оператор с БИН', type: 'operator', bin: '980540000381' }, REQUEST),
      ).rejects.toBeInstanceOf(ZodError);

      // Сервис сам не доверяет схеме контроллера: тип не из CREATABLE_ORGANIZATION_TYPES — 400 до базы.
      const service = new OrganizationsService(db, new AuditService(db));
      for (const type of ['imbc', 'manufacturer'])
        await expect(
          service.create(admin.user, { name: `Сервис ${type}`, type, isMajorOperator: false } as never, null),
        ).rejects.toBeInstanceOf(ZodError);
      await expect(
        service.create(admin.user, { name: 'Сервис major', type: 'observer', isMajorOperator: true }, null),
      ).rejects.toBeInstanceOf(ZodError);
      expect((await pool.query(`select 1 from organizations where name like 'Сервис %'`)).rowCount).toBe(0);

      // Две одинаковые организации одновременно: одна создана, вторая — 409 (organizations_name_uq).
      const same = `Параллельный ${randomUUID()}`;
      const results = await Promise.allSettled([
        controller.create(admin, { name: same, type: 'operator' }, REQUEST),
        controller.create(admin, { name: same.toLowerCase(), type: 'operator' }, REQUEST),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason).toMatchObject({ code: 'organization_exists' });
      expect(failure.reason.getStatus()).toBe(409);
      const count = await pool.query(
        `select 1 from organizations where type = 'operator' and lower(name) = lower($1)`,
        [same],
      );
      expect(count.rowCount).toBe(1);
      // Отказы не пишут organization.created: две записи выше и одна параллельная.
      const all = await pool.query(
        `select 1 from audit_entries where action = 'organization.created' and diff->>'name' in ($1, $2, $3)`,
        [name, same, same.toLowerCase()],
      );
      expect(all.rowCount).toBe(3);
    });

    it('отметка major ставится и снимается только у оператора; наблюдателю — 409 not_operator; повтор без изменения — без второй записи аудита', async () => {
      const controller = organizationsController();
      const operator = await createOrganization('operator');
      const observer = await createOrganization('observer');

      expect(await controller.setMajorOperator(admin, operator.id, { isMajorOperator: true }, REQUEST)).toEqual({
        organization: { ...operator, isMajorOperator: true },
      });
      // Повтор без изменения — 200 без записи аудита.
      expect(
        (await controller.setMajorOperator(admin, operator.id, { isMajorOperator: true }, REQUEST)).organization
          .isMajorOperator,
      ).toBe(true);
      expect(await audits('organization.major_operator_changed', operator.id)).toEqual([
        expect.objectContaining({ diff: { from: false, to: true }, is_account_event: true, ip: '192.0.2.10' }),
      ]);

      expect(
        (await controller.setMajorOperator(admin, operator.id, { isMajorOperator: false }, REQUEST)).organization
          .isMajorOperator,
      ).toBe(false);
      expect((await audits('organization.major_operator_changed', operator.id)).map((a) => a.diff)).toEqual([
        { from: false, to: true },
        { from: true, to: false },
      ]);
      const [stored] = await db
        .select({ isMajorOperator: schema.organizations.isMajorOperator })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, operator.id));
      expect(stored!.isMajorOperator).toBe(false);

      expect(
        await problem(controller.setMajorOperator(admin, observer.id, { isMajorOperator: true }, REQUEST)),
      ).toEqual({
        status: 409,
        code: 'not_operator',
      });
      expect(await problem(controller.setMajorOperator(admin, imbcId, { isMajorOperator: true }, REQUEST))).toEqual({
        status: 409,
        code: 'not_operator',
      });
      for (const id of [randomUUID(), 'not-a-uuid'])
        expect(await problem(controller.setMajorOperator(admin, id, { isMajorOperator: true }, REQUEST)), id).toEqual({
          status: 404,
          code: 'not_found',
        });
      await expect(controller.setMajorOperator(admin, operator.id, {}, REQUEST)).rejects.toBeInstanceOf(ZodError);
      expect(await audits('organization.major_operator_changed', observer.id)).toEqual([]);
    });

    it('ящик IMBC: адрес в нижнем регистре, null снимает, неверный — 400; аудит from/to; в списке аккаунтов — imbcMailbox (раздел 8.2)', async () => {
      const controller = organizationsController();
      const list = () => new AccountsService(db).list();
      expect((await list()).imbcMailbox).toBeNull();

      expect(await controller.setImbcMailbox(admin, { email: '  Mail@IMBC.Local ' }, REQUEST)).toEqual({
        imbcMailbox: 'mail@imbc.local',
      });
      expect(await controller.setImbcMailbox(admin, { email: 'mail@imbc.local' }, REQUEST)).toEqual({
        imbcMailbox: 'mail@imbc.local',
      });
      expect((await list()).imbcMailbox).toBe('mail@imbc.local');
      const [stored] = await db
        .select({ mailbox: schema.organizations.notificationMailbox })
        .from(schema.organizations)
        .where(eq(schema.organizations.id, imbcId));
      expect(stored!.mailbox).toBe('mail@imbc.local');

      await expect(controller.setImbcMailbox(admin, { email: 'not-an-email' }, REQUEST)).rejects.toBeInstanceOf(
        ZodError,
      );
      await expect(controller.setImbcMailbox(admin, {}, REQUEST)).rejects.toBeInstanceOf(ZodError);
      expect(await controller.setImbcMailbox(admin, { email: null }, REQUEST)).toEqual({ imbcMailbox: null });
      expect(await controller.setImbcMailbox(admin, { email: null }, REQUEST)).toEqual({ imbcMailbox: null });
      expect((await list()).imbcMailbox).toBeNull();

      // Повтор без изменения записи не создаёт: два изменения — две записи.
      const rows = await audits('organization.mailbox_changed', imbcId);
      expect(rows.map((r) => r.diff)).toEqual([
        { from: null, to: 'mail@imbc.local' },
        { from: 'mail@imbc.local', to: null },
      ]);
      for (const row of rows)
        expect(row).toMatchObject({ is_account_event: true, ip: '192.0.2.10', user_id: admin.user.id });
    });

    it('приглашение: пользователь Keycloak с firstName и locale kk, аккаунт invited в организации, одно задание send-password-email на субъект в той же транзакции (ADM-01, NOT-24, AUTH-01)', async () => {
      const operator = await createOrganization('operator');
      const email = `${randomUUID()}@invite.local`;
      const result = await accountsController().invite(
        admin,
        {
          email: ` ${email.toUpperCase()} `,
          fullName: ' Новый Оператор ',
          organizationId: operator.id,
          role: 'operator',
        },
        REQUEST,
      );
      expect(keycloak.createUser).toHaveBeenCalledExactlyOnceWith({ email, firstName: 'Новый Оператор', locale: 'kk' });
      const subject = await keycloak.createUser.mock.results[0]!.value;

      const row = (await accountRow(email))!;
      expect(row).toMatchObject({
        organizationId: operator.id,
        email,
        fullName: 'Новый Оператор',
        role: 'operator',
        state: 'invited',
        locale: 'kk',
        idpSubject: subject,
        lastSignInAt: null,
        registrationIp: null,
        platformTermsAcceptedAt: null,
      });
      expect(result).toEqual({
        account: {
          id: row.id,
          email,
          fullName: 'Новый Оператор',
          role: 'operator',
          state: 'invited',
          lastSignInAt: null,
        },
      });
      expect(await jobs(subject)).toBe(1);
      expect(await audits('account.invited', row.id)).toEqual([
        expect.objectContaining({
          diff: { email, role: 'operator', organizationId: operator.id },
          is_account_event: true,
          ip: '192.0.2.10',
          user_id: admin.user.id,
        }),
      ]);
      expect(keycloak.deleteUser).not.toHaveBeenCalled();

      // Задание письма — в транзакции строк: очередь отказала — ни аккаунта, ни аудита, пользователь Keycloak удалён.
      const failed = `${randomUUID()}@invite.local`;
      const failedQueue = { send: vi.fn().mockRejectedValue(new Error('queue unavailable')) } as unknown as PgBoss;
      await expect(
        accountsController(keycloak, failedQueue).invite(
          admin,
          { email: failed, fullName: 'Без Письма', organizationId: operator.id, role: 'operator' },
          REQUEST,
        ),
      ).rejects.toThrow();
      expect(await accountRow(failed)).toBeUndefined();
      expect(keycloak.deleteUser).toHaveBeenCalledExactlyOnceWith(await keycloak.createUser.mock.results[1]!.value);
      expect(
        (
          await pool.query(`select 1 from audit_entries where action = 'account.invited' and diff->>'email' = $1`, [
            failed,
          ])
        ).rowCount,
      ).toBe(0);
    });

    it('IMBC — три роли, оператор — operator, наблюдатель — observer, иначе 400 role_not_allowed; организация производителя — 409 organization_not_invitable; чужой id — 404', async () => {
      const operator = await createOrganization('operator');
      const observer = await createOrganization('observer');
      for (const role of ['expert', 'administrator', 'director'] as const)
        expect((await invite(imbcId, role)).account).toMatchObject({ role, state: 'invited' });
      expect((await invite(operator.id, 'operator')).account.role).toBe('operator');
      expect((await invite(observer.id, 'observer')).account.role).toBe('observer');
      expect(keycloak.createUser).toHaveBeenCalledTimes(5);
      keycloak.createUser.mockClear();

      const refusals: [string, Role][] = [
        [imbcId, 'operator'],
        [imbcId, 'observer'],
        [imbcId, 'manufacturer'],
        [operator.id, 'observer'],
        [operator.id, 'expert'],
        [operator.id, 'manufacturer'],
        [observer.id, 'operator'],
        [observer.id, 'administrator'],
      ];
      for (const [organizationId, role] of refusals)
        expect(await problem(invite(organizationId, role)), `${role}`).toEqual({
          status: 400,
          code: 'role_not_allowed',
        });

      const [manufacturer] = await db
        .select({ id: schema.organizations.id })
        .from(schema.organizations)
        .where(eq(schema.organizations.type, 'manufacturer'))
        .limit(1);
      expect(await problem(invite(manufacturer!.id, 'manufacturer'))).toEqual({
        status: 409,
        code: 'organization_not_invitable',
      });
      expect(await problem(invite(manufacturer!.id, 'operator'))).toEqual({
        status: 409,
        code: 'organization_not_invitable',
      });
      expect(await problem(invite(randomUUID(), 'operator'))).toEqual({ status: 404, code: 'not_found' });
      // Отказ — до Keycloak: пользователь не создаётся.
      expect(keycloak.createUser).not.toHaveBeenCalled();
    });

    it('у организации-оператора несколько аккаунтов, по одному на адрес (GEN-02); у наблюдателя — так же (GEN-06)', async () => {
      for (const type of ['operator', 'observer'] as const) {
        const organization = await createOrganization(type);
        const first = `${randomUUID()}@${type}.local`;
        await invite(organization.id, type, first);
        await invite(organization.id, type, `${randomUUID()}@${type}.local`);
        const members = await db
          .select({ id: schema.userAccounts.id })
          .from(schema.userAccounts)
          .where(eq(schema.userAccounts.organizationId, organization.id));
        expect(members, type).toHaveLength(2);

        // Тот же адрес (в другом регистре) — 409 до Keycloak.
        keycloak.createUser.mockClear();
        expect(await problem(invite(organization.id, type, first.toUpperCase()))).toEqual({
          status: 409,
          code: 'email_exists',
        });
        expect(keycloak.createUser).not.toHaveBeenCalled();
      }
    });

    it('одно приглашение дважды параллельно — один 201, один 409 email_exists, пользователь Keycloak проигравшего удалён; адрес занят только в Keycloak (createUser 409) — 409 email_exists', async () => {
      const operator = await createOrganization('operator');
      const email = `${randomUUID()}@invite.local`;
      // Оба запроса проходят проверку почты до Keycloak и получают разных пользователей: в БД побеждает один.
      let created = 0;
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      keycloak.createUser.mockImplementation(async () => {
        if (++created === 2) release();
        await barrier;
        return randomUUID();
      });
      const results = await Promise.allSettled([
        invite(operator.id, 'operator', email),
        invite(operator.id, 'operator', email),
      ]);
      expect(keycloak.createUser).toHaveBeenCalledTimes(2);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failure = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failure.reason).toBeInstanceOf(ProblemException);
      expect({ status: failure.reason.getStatus(), code: failure.reason.code }).toEqual({
        status: 409,
        code: 'email_exists',
      });

      const subjects = await Promise.all(keycloak.createUser.mock.results.map((r) => r.value as Promise<string>));
      const winner = (await accountRow(email))!.idpSubject!;
      const loser = subjects.find((s) => s !== winner)!;
      expect(subjects).toContain(winner);
      expect(keycloak.deleteUser).toHaveBeenCalledExactlyOnceWith(loser);
      expect(await jobs(winner)).toBe(1);
      expect(await jobs(loser)).toBe(0);
      const rows = await pool.query(`select 1 from user_accounts where lower(email) = $1`, [email]);
      expect(rows.rowCount).toBe(1);
      expect(
        (
          await pool.query(`select 1 from audit_entries where action = 'account.invited' and diff->>'email' = $1`, [
            email,
          ])
        ).rowCount,
      ).toBe(1);

      // Адрес занят только в Keycloak: 409 без аккаунта и без удаления чужого пользователя.
      const taken = `${randomUUID()}@invite.local`;
      const occupied = {
        createUser: vi.fn<Keycloak['createUser']>().mockRejectedValue(new KeycloakRequestError(409, 'create user')),
        deleteUser: vi.fn<Keycloak['deleteUser']>(),
      };
      expect(
        await problem(
          accountsController(occupied).invite(
            admin,
            { email: taken, fullName: 'Занятый Адрес', organizationId: operator.id, role: 'operator' },
            REQUEST,
          ),
        ),
      ).toEqual({ status: 409, code: 'email_exists' });
      expect(occupied.deleteUser).not.toHaveBeenCalled();
      expect(await accountRow(taken)).toBeUndefined();
    });

    it('повтор приглашения: invited — одно задание и при двух повторах подряд (singletonKey); active и blocked — 409 not_invited; аккаунт seed без субъекта — 409 identity_not_bound', async () => {
      const observer = await createOrganization('observer');
      const { account } = await invite(observer.id, 'observer');
      const subject = (await accountRow(account.email))!.idpSubject!;
      const controller = accountsController();
      expect(await controller.resend(admin, account.id, REQUEST)).toEqual({ status: 'password_email_queued' });
      expect(await controller.resend(admin, account.id, REQUEST)).toEqual({ status: 'password_email_queued' });
      // pg-boss дедуплицирует по (name, singleton_on, singleton_key), singleton_on — время БД с шагом 60 с.
      // Приглашение и два повтора укладываются не больше чем в два окна: заданий по одному на окно, не больше двух.
      const after = await jobSlots(subject);
      expect(after.count).toBe(after.slots);
      expect(after.count).toBeLessThanOrEqual(2);
      // Аудит честен: queued — задание действительно поставлено; хотя бы один повтор попал в окно с заданием.
      const resent = await audits('account.invitation_resent', account.id);
      expect(resent).toHaveLength(2);
      for (const row of resent)
        expect(row).toMatchObject({ is_account_event: true, ip: '192.0.2.10', user_id: admin.user.id });
      const queued = resent.map((row) => (row.diff as { queued: boolean }).queued);
      expect(queued.filter(Boolean).length).toBe(after.count - 1);
      expect(queued).toContain(false);
      // Keycloak повтор не трогает: письмо отправит задание.
      expect(keycloak.createUser).toHaveBeenCalledOnce();

      for (const state of ['active', 'blocked'] as const) {
        await pool.query('update user_accounts set state = $1 where id = $2', [state, account.id]);
        expect(await problem(controller.resend(admin, account.id, REQUEST)), state).toEqual({
          status: 409,
          code: 'not_invited',
        });
      }
      const seed = (await accountRow('expert@imbc.local'))!;
      expect(seed).toMatchObject({ state: 'invited', idpSubject: null });
      expect(await problem(controller.resend(admin, seed.id, REQUEST))).toEqual({
        status: 409,
        code: 'identity_not_bound',
      });
      for (const id of [randomUUID(), 'not-a-uuid'])
        expect(await problem(controller.resend(admin, id, REQUEST)), id).toEqual({ status: 404, code: 'not_found' });
      expect(await jobSlots(subject)).toEqual(after);
      expect(await audits('account.invitation_resent', seed.id)).toEqual([]);
    });

    it('ответы не содержат БИН и полей профиля (ADM-06)', async () => {
      const organizations = organizationsController();
      const operator = await organizations.create(admin, { name: `ADM-06 ${randomUUID()}`, type: 'operator' }, REQUEST);
      const responses: unknown[] = [
        operator,
        await organizations.setMajorOperator(admin, operator.organization.id, { isMajorOperator: true }, REQUEST),
        await organizations.setImbcMailbox(admin, { email: 'adm06@imbc.local' }, REQUEST),
        await invite(operator.organization.id, 'operator'),
        await new AccountsService(db).list(),
      ];
      expect(Object.keys(operator.organization).sort()).toEqual(['id', 'isMajorOperator', 'name', 'type']);
      const invited = responses[3] as { account: object };
      expect(Object.keys(invited.account).sort()).toEqual(['email', 'fullName', 'id', 'lastSignInAt', 'role', 'state']);

      const bins = await pool.query<{ bin: string }>('select bin from organizations where bin is not null');
      expect(bins.rows.length).toBeGreaterThan(0);
      for (const response of responses) {
        const text = JSON.stringify(response);
        for (const key of ['bin', 'status', 'completenessPct', 'heardAboutUs', 'registrationIp', 'ndaVersion'])
          expect(text, key).not.toContain(`"${key}"`);
        for (const { bin } of bins.rows) expect(text).not.toContain(bin);
      }
      // Повтор приглашения отвечает только статусом постановки письма.
      const { account } = invited as { account: { id: string } };
      expect(await accountsController().resend(admin, account.id, REQUEST)).toStrictEqual({
        status: 'password_email_queued',
      });
    });

    it('исполнитель уже не active administrator — 403 в транзакции действия, запись denied в аудите, изменений нет (GEN-08, AUD-01)', async () => {
      // Сеанс прошёл guard, затем аккаунт заблокировали: сервис вызывается напрямую уже заблокированным.
      const blocked = await administrator('active');
      const id = blocked.user.id;
      await pool.query(`update user_accounts set state = 'blocked' where id = $1`, [id]);
      const name = `Заблокированный ${randomUUID()}`;
      const organizations = organizationsController();
      expect(await problem(organizations.create(blocked, { name, type: 'operator' }, REQUEST))).toEqual({
        status: 403,
        code: 'forbidden',
      });
      expect((await pool.query('select 1 from organizations where name = $1', [name])).rowCount).toBe(0);
      expect(await problem(organizations.setImbcMailbox(blocked, { email: 'blocked@imbc.local' }, REQUEST))).toEqual({
        status: 403,
        code: 'forbidden',
      });
      const email = `${randomUUID()}@invite.local`;
      expect(
        await problem(
          accountsController().invite(
            blocked,
            { email, fullName: 'Не Создан', organizationId: imbcId, role: 'expert' },
            REQUEST,
          ),
        ),
      ).toEqual({ status: 403, code: 'forbidden' });
      expect(await accountRow(email)).toBeUndefined();
      // Пользователь Keycloak уже создан — удаляется компенсацией.
      expect(keycloak.deleteUser).toHaveBeenCalledOnce();
      const operator = await createOrganization('operator');
      expect(
        await problem(
          new OrganizationsService(db, new AuditService(db)).setMajorOperator(blocked.user, operator.id, true, null),
        ),
      ).toEqual({ status: 403, code: 'forbidden' });
      expect(await problem(accountsController().resend(blocked, randomUUID(), REQUEST))).toEqual({
        status: 403,
        code: 'forbidden',
      });

      // Каждый отказ — одна запись, как у SessionGuard: действие accounts.manage, объект — маршрут.
      const { rows } = await pool.query<{ object_type: string; object_id: string; outcome: string; ip: string | null }>(
        `select object_type, object_id, outcome, host(ip) as ip from audit_entries
          where user_id = $1 and action = 'accounts.manage' order by at, id`,
        [id],
      );
      expect(rows).toEqual([
        { object_type: 'route', object_id: ADMIN_ROUTES.createOrganization, outcome: 'denied', ip: '192.0.2.10' },
        { object_type: 'route', object_id: ADMIN_ROUTES.imbcMailbox, outcome: 'denied', ip: '192.0.2.10' },
        { object_type: 'route', object_id: ADMIN_ROUTES.invite, outcome: 'denied', ip: '192.0.2.10' },
        { object_type: 'route', object_id: ADMIN_ROUTES.majorOperator, outcome: 'denied', ip: null },
        { object_type: 'route', object_id: ADMIN_ROUTES.resend, outcome: 'denied', ip: '192.0.2.10' },
      ]);
      expect(
        (await pool.query(`select 1 from audit_entries where user_id = $1 and outcome <> 'denied'`, [id])).rowCount,
      ).toBe(0);
    });

    it('два администратора одновременно берут блокировку друг друга и обновляют чужую строку — оба завершаются без 40P01, по очереди (GEN-08)', async () => {
      const first = await administrator();
      const second = await administrator();
      let signal!: () => void;
      const firstLocked = new Promise<void>((resolve) => {
        signal = resolve;
      });
      // Транзакция действия над чужим аккаунтом: lockActor, пауза, затем изменение строки цели.
      const demote = (actor: AuthContext, targetId: string, onLocked?: () => void) =>
        db.transaction(async (raw) => {
          const tx = raw as unknown as Database;
          await boundLockWaits(tx);
          await lockActor(tx, actor.user.id, targetId);
          onLocked?.();
          await new Promise((resolve) => setTimeout(resolve, 300));
          await tx.update(schema.userAccounts).set({ state: 'blocked' }).where(eq(schema.userAccounts.id, targetId));
        });
      const one = demote(first, second.user.id, signal);
      await firstLocked;
      const two = demote(second, first.user.id);
      const [a, b] = await Promise.allSettled([one, two]);

      for (const result of [a, b])
        if (result.status === 'rejected') expect(sqlState(result.reason), 'deadlock').not.toBe('40P01');
      expect(a.status).toBe('fulfilled');
      // Второй ждёт первого и перечитывает себя уже заблокированным: 403, а не взаимная блокировка 40P01.
      expect(b.status).toBe('rejected');
      const reason = (b as PromiseRejectedResult).reason as ProblemException;
      expect(reason).toBeInstanceOf(ProblemException);
      expect({ status: reason.getStatus(), code: reason.code }).toEqual({ status: 403, code: 'forbidden' });
      const states = await pool.query<{ id: string; state: string }>(
        'select id, state from user_accounts where id = any($1::uuid[])',
        [[first.user.id, second.user.id]],
      );
      expect(Object.fromEntries(states.rows.map((r) => [r.id, r.state]))).toEqual({
        [first.user.id]: 'active',
        [second.user.id]: 'blocked',
      });
    });
  },
);

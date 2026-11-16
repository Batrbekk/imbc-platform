import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService, type AuditEvent } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import { InvitationsService } from '../src/modules/admin/invitations.service.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import type { KeycloakAdminService } from '../src/modules/auth/keycloak-admin.service.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'generic invitation provisioning: uncertain COMMIT and guarded compensation on PostgreSQL',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool, appPool: pg.Pool, db: Database, appDb: Database, boss: PgBoss, admin: AuthUser;
    const role = `identity_ack_${randomUUID().replaceAll('-', '')}`;
    const keycloak = {
      createUser: vi.fn(async () => randomUUID()),
      deleteUser: vi.fn(async () => undefined),
      sendPasswordEmail: vi.fn(async () => undefined),
      logoutUser: vi.fn(async () => undefined),
      awaitingInitialPasswordSetup: vi.fn(async () => true),
    };
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool, '0023_release_policy_rules');
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
      const account = (
        await db
          .insert(s.userAccounts)
          .values({ organizationId: imbc.id, role: 'administrator', state: 'active', email: 'administrator@ack.local' })
          .returning()
      )[0]!;
      admin = {
        id: account.id,
        organizationId: imbc.id,
        organizationType: 'imbc',
        role: 'administrator',
        email: account.email,
        fullName: null,
        locale: 'kk',
      };
      await pool.query(`create role "${role}"`);
      await applyAppRoleGrants(pool, role);
      appPool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 5, options: `-c role=${role}` });
      appDb = drizzle(appPool, { schema: s, casing: 'snake_case' });
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      for (const queue of [QUEUES.sendPasswordEmail, QUEUES.cleanupIdentity]) await boss.createQueue(queue);
      await pool.query(
        `grant usage on schema pgboss_auth_test to "${role}"; grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
      );
    });
    afterAll(async () => {
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${role}"; drop role "${role}"`);
      await pool?.end();
    });
    beforeEach(async () => {
      await boss.deleteAllJobs(QUEUES.sendPasswordEmail);
      await boss.deleteAllJobs(QUEUES.cleanupIdentity);
      vi.resetAllMocks();
      keycloak.createUser.mockImplementation(async () => randomUUID());
      keycloak.deleteUser.mockResolvedValue(undefined);
      keycloak.sendPasswordEmail.mockResolvedValue(undefined);
      keycloak.logoutUser.mockResolvedValue(undefined);
      keycloak.awaitingInitialPasswordSetup.mockResolvedValue(true);
    });
    const input = async (type: 'operator' | 'observer') => {
      const org = (
        await db
          .insert(s.organizations)
          .values({ type, name: `Synthetic ${type} ${randomUUID()}` })
          .returning()
      )[0]!;
      return {
        organizationId: org.id,
        role: type,
        email: `${randomUUID()}@ack.local`,
        fullName: 'Synthetic invited account',
      };
    };
    const rows = (email: string) => db.select().from(s.userAccounts).where(eq(s.userAccounts.email, email));
    const queueRows = async (name: string) =>
      (await pool.query('select data from pgboss_auth_test.job where name=$1 order by id', [name])).rows.map(
        (r) => r.data,
      );
    const auditRows = (id: string) =>
      db.select().from(s.auditEntries).where(eq(s.auditEntries.objectId, id)).orderBy(s.auditEntries.id);
    const provisioner = (servicePool: pg.Pool = appPool, queue: PgBoss = boss) =>
      new IdentityProvisioningService(servicePool, queue, keycloak as unknown as KeycloakAdminService);
    const invitations = (
      servicePool: pg.Pool = appPool,
      queue: PgBoss = boss,
      audit: AuditService = new AuditService(appDb),
    ) => new InvitationsService(appDb, appPool, queue, provisioner(servicePool, queue), audit);
    const worker = () =>
      new JobHandlers(
        appDb,
        {} as never,
        {} as Env,
        new AuditService(appDb),
        keycloak as unknown as KeycloakAdminService,
        {} as never,
        {} as never,
        appPool,
        boss,
      );
    /** Keep the actual PostgreSQL commit. Drop its ACK, not its writes; subsequent probes use new connections. */
    const failingPool = (mode: 'lost_ack' | 'lost_ack_unknown_lookup' | 'rollback_unknown_lookup'): pg.Pool => {
      let connections = 0,
        lostAck = false;
      return {
        connect: async () => {
          if (++connections === 2 && mode !== 'lost_ack') throw new Error('Synthetic fresh lookup unavailable');
          const client = await appPool.connect();
          return new Proxy(client, {
            get(target, property) {
              if (property === 'query')
                return (...args: unknown[]) => {
                  const query = args[0];
                  const text =
                    typeof query === 'string'
                      ? query
                      : query && typeof query === 'object' && 'text' in query
                        ? query.text
                        : null;
                  const result = Reflect.apply(target.query, target, args);
                  if (
                    mode !== 'rollback_unknown_lookup' &&
                    !lostAck &&
                    typeof text === 'string' &&
                    text.trim().toLowerCase() === 'commit'
                  ) {
                    lostAck = true;
                    return Promise.resolve(result).then(() => {
                      throw new Error('Synthetic lost COMMIT acknowledgment');
                    });
                  }
                  return result;
                };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        },
      } as unknown as pg.Pool;
    };

    it.each(['operator', 'observer'] as const)(
      'lost COMMIT ACK for an actual %s invitation keeps its account, audit, durable job and identity',
      async (type) => {
        const request = await input(type);
        await expect(invitations(failingPool('lost_ack')).invite(admin, request, '203.0.113.8')).rejects.toMatchObject({
          cause: { message: 'Synthetic lost COMMIT acknowledgment' },
        });
        const accounts = await rows(request.email);
        expect(accounts).toHaveLength(1);
        const account = accounts[0]!;
        expect(account).toMatchObject({ state: 'invited', role: type, organizationId: request.organizationId });
        expect(await auditRows(account.id)).toHaveLength(1);
        expect(await queueRows(QUEUES.sendPasswordEmail)).toEqual([{ subject: account.idpSubject }]);
        expect(await queueRows(QUEUES.cleanupIdentity)).toHaveLength(0);
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        await worker().sendPasswordEmail({ subject: account.idpSubject! });
        expect(keycloak.sendPasswordEmail).toHaveBeenCalledExactlyOnceWith(account.idpSubject);
        expect(keycloak.awaitingInitialPasswordSetup).not.toHaveBeenCalled();
      },
    );
    it('a failed transaction deletes only the proven orphan and rolls back the account, audit and queued email', async () => {
      const request = await input('operator');
      const failedQueue = {
        send: vi.fn(async (_name: string, data: unknown, options: unknown) => {
          await Reflect.apply(boss.send, boss, [QUEUES.sendPasswordEmail, data, options]);
          throw new Error('Synthetic queue failure after insert');
        }),
      } as unknown as PgBoss;
      await expect(invitations(appPool, failedQueue).invite(admin, request, '203.0.113.8')).rejects.toThrow(
        'Synthetic queue failure after insert',
      );
      expect(await rows(request.email)).toHaveLength(0);
      expect(await queueRows(QUEUES.sendPasswordEmail)).toHaveLength(0);
      expect(await queueRows(QUEUES.cleanupIdentity)).toHaveLength(0);
      expect(keycloak.deleteUser).toHaveBeenCalledExactlyOnceWith(await keycloak.createUser.mock.results[0]!.value);
      expect(
        (await db.select().from(s.auditEntries)).filter(
          (r) => r.action === 'account.invited' && JSON.stringify(r.diff).includes(request.email),
        ),
      ).toHaveLength(0);
    });
    it('unknown fresh lookup after committed invitation queues only guarded cleanup and retains all committed evidence', async () => {
      const request = await input('observer');
      await expect(
        invitations(failingPool('lost_ack_unknown_lookup')).invite(admin, request, null),
      ).rejects.toMatchObject({
        cause: { message: 'Synthetic lost COMMIT acknowledgment' },
      });
      const account = (await rows(request.email))[0]!,
        audit = await auditRows(account.id);
      expect(await queueRows(QUEUES.cleanupIdentity)).toEqual([{ subject: account.idpSubject }]);
      expect(keycloak.deleteUser).not.toHaveBeenCalled();
      await worker().cleanupIdentity({ subject: account.idpSubject! });
      expect(keycloak.deleteUser).not.toHaveBeenCalled();
      expect(await rows(request.email)).toEqual([account]);
      expect(await auditRows(account.id)).toEqual(audit);
      expect(await queueRows(QUEUES.sendPasswordEmail)).toEqual([{ subject: account.idpSubject }]);
    });
    it('unknown lookup after rollback defers cleanup; its eventual fresh orphan check performs the deletion', async () => {
      const request = await input('observer');
      await expect(
        provisioner(failingPool('rollback_unknown_lookup')).provision(
          { email: request.email, firstName: null, locale: 'kk' },
          async (tx, subject) => {
            await tx.insert(s.userAccounts).values({
              organizationId: request.organizationId,
              role: 'observer',
              state: 'invited',
              email: request.email,
              idpSubject: subject,
            });
            throw new Error('Synthetic failed business write');
          },
        ),
      ).rejects.toThrow('Synthetic failed business write');
      const subject = await keycloak.createUser.mock.results[0]!.value;
      expect(await rows(request.email)).toHaveLength(0);
      expect(await queueRows(QUEUES.cleanupIdentity)).toEqual([{ subject }]);
      expect(keycloak.deleteUser).not.toHaveBeenCalled();
      await worker().cleanupIdentity({ subject });
      expect(keycloak.deleteUser).toHaveBeenCalledExactlyOnceWith(subject);
    });
    it('cleanup cannot see absence while a generic invitation transaction is pending; it waits for the identity lock and reads after commit', async () => {
      const request = await input('operator'),
        subject = randomUUID();
      keycloak.createUser.mockResolvedValue(subject);
      let entered!: () => void, release!: () => void;
      const writing = new Promise<void>((r) => {
          entered = r;
        }),
        barrier = new Promise<void>((r) => {
          release = r;
        });
      const actual = new AuditService(appDb);
      const pausedAudit = {
        record: async (event: AuditEvent, tx: Pick<Database, 'insert'>) => {
          await actual.record(event, tx);
          entered();
          await barrier;
        },
      } as AuditService;
      const inviting = invitations(appPool, boss, pausedAudit).invite(admin, request, null);
      try {
        await writing;
        const cleaning = worker().cleanupIdentity({ subject });
        for (let n = 0; n < 100; n++) {
          if (
            (
              await pool.query(
                "select 1 from pg_locks where locktype='advisory' and classid=2146711109 and not granted",
              )
            ).rowCount
          )
            break;
          if (n === 99) throw new Error('Cleanup never reached the original identity lock');
          await new Promise((r) => setTimeout(r, 10));
        }
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        release();
        const invited = await inviting;
        await cleaning;
        expect(keycloak.deleteUser).not.toHaveBeenCalled();
        expect((await rows(request.email))[0]!.id).toBe(invited.account.id);
      } finally {
        release();
        await inviting;
      }
    });
    it('a subject referenced in another organization is never deleted when the attempted invitation rolls back', async () => {
      const old = await input('operator'),
        request = await input('observer'),
        subject = randomUUID();
      const existing = (
        await db
          .insert(s.userAccounts)
          .values({ organizationId: old.organizationId, role: 'operator', email: old.email, idpSubject: subject })
          .returning()
      )[0]!;
      keycloak.createUser.mockResolvedValue(subject);
      await expect(invitations().invite(admin, request, null)).rejects.toMatchObject({ code: 'email_exists' });
      expect(keycloak.deleteUser).not.toHaveBeenCalled();
      expect(await rows(old.email)).toEqual([existing]);
      expect(await rows(request.email)).toHaveLength(0);
      expect(await queueRows(QUEUES.cleanupIdentity)).toHaveLength(0);
    });
    it('failed orphan deletion defers guarded cleanup without changing the original invitation failure', async () => {
      const request = await input('operator');
      keycloak.deleteUser.mockRejectedValueOnce(new Error('Synthetic IdP deletion unavailable'));
      await expect(
        provisioner().provision({ email: request.email, firstName: null, locale: 'kk' }, async () => {
          throw new Error('Synthetic invitation failure');
        }),
      ).rejects.toThrow('Synthetic invitation failure');
      const subject = await keycloak.createUser.mock.results[0]!.value;
      expect(await queueRows(QUEUES.cleanupIdentity)).toEqual([{ subject }]);
      await worker().cleanupIdentity({ subject });
      expect(keycloak.deleteUser).toHaveBeenCalledTimes(2);
    });
    it('inactive reset remains an explicit UPDATE_PASSWORD flow with logout and no initial-setup probe', async () => {
      const request = await input('operator');
      const account = (
        await db
          .insert(s.userAccounts)
          .values({
            organizationId: request.organizationId,
            role: 'operator',
            state: 'inactive',
            email: request.email,
            idpSubject: randomUUID(),
            inactiveSince: new Date(),
          })
          .returning()
      )[0]!;
      await worker().sendInactivityReset({ accountId: account.id });
      expect(keycloak.logoutUser).toHaveBeenCalledExactlyOnceWith(account.idpSubject);
      expect(keycloak.sendPasswordEmail).toHaveBeenCalledExactlyOnceWith(account.idpSubject, ['UPDATE_PASSWORD']);
      expect(keycloak.awaitingInitialPasswordSetup).not.toHaveBeenCalled();
    });
  },
);

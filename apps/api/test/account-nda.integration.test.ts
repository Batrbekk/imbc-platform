import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { computeBinCheckDigit } from '@imbc/contracts';
import { Controller } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import { DB, type Database } from '../src/database/database.module.js';
import * as s from '../src/database/schema/index.js';
import { QUEUES } from '../src/jobs/queues.js';
import { QUEUE } from '../src/infra/infra.module.js';
import { AdataScheduler } from '../src/modules/adata/adata.scheduler.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { IdentityProvisioningService } from '../src/modules/auth/identity-provisioning.service.js';
import { AuthRateLimitService } from '../src/modules/auth/rate-limit.service.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { CurrentNdaController } from '../src/modules/registration/current-nda.controller.js';
import { CurrentNdaService } from '../src/modules/registration/current-nda.service.js';
import { accountNdaLinksInsert, currentAccountNdaEvidence } from '../src/modules/registration/nda-evidence.js';
import { ManufacturerOnboardingService } from '../src/modules/registration/onboarding.service.js';
import { RegistrationController } from '../src/modules/registration/registration.controller.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp } from './support/http.js';
import { seedProfileGraph } from './support/profile-graph.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'canonical account NDA evidence, populated expand/R1 and own HTTP',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool, appPool: pg.Pool, db: Database, appDb: Database, boss: PgBoss;
    let service: CurrentNdaService, onboarding: ManufacturerOnboardingService;
    let currentId: string, expert: AuthUser;
    let pending: AuthUser,
      known: { actor: AuthUser; profile: string; legacy: string },
      unknown: typeof known,
      conflict: typeof known,
      ambiguous: typeof known;
    const original = new Date('2024-02-01T01:02:03.123Z');
    const role = `nda_test_${randomUUID().replaceAll('-', '')}`;
    let bins = 100;
    const bin = () => {
      const prefix = `2712${String(++bins).padStart(7, '0')}`;
      return `${prefix}${computeBinCheckDigit(prefix)}`;
    };
    const actor = async (org?: string, triplet = false): Promise<AuthUser> => {
      const organizationId =
        org ??
        (
          await db
            .insert(s.organizations)
            .values({ type: 'manufacturer', name: 'Synthetic NDA fixture', bin: bin() })
            .returning()
        )[0]!.id;
      const [account] = await db
        .insert(s.userAccounts)
        .values({
          organizationId,
          role: 'manufacturer',
          state: 'active',
          email: `${randomUUID()}@nda.local`,
          ...(triplet
            ? {
                registrationNdaVersionId: currentId,
                registrationNdaAcceptedAt: original,
                registrationIp: '203.0.113.7',
              }
            : {}),
        })
        .returning();
      return {
        id: account!.id,
        organizationId,
        role: 'manufacturer',
        organizationType: 'manufacturer',
        email: account!.email,
        fullName: null,
        locale: 'en',
      };
    };
    const oldConsent = async (kind: 'known' | 'unknown' | 'conflict' | 'ambiguous') => {
      const g = await seedProfileGraph(pool);
      await db.update(s.organizations).set({ bin: bin() }).where(eq(s.organizations.id, g.org));
      const user = await actor(g.org, kind === 'conflict');
      const at = kind === 'conflict' ? new Date('2024-03-02T04:05:06Z') : original;
      const row = (
        await pool.query<{ id: string }>(
          'insert into nda_acceptance(profile_id,nda_version_id,accepted_at,ip_address) values($1,$2,$3,$4) returning id',
          [g.profile, currentId, at, '203.0.113.7'],
        )
      ).rows[0]!;
      if (kind !== 'unknown')
        await new AuditService(db).record({
          userId: user.id,
          organizationId: g.org,
          action: 'nda.accepted',
          objectType: 'nda_acceptance',
          objectId: row.id,
          diff: { version: 42 },
        });
      if (kind === 'ambiguous')
        await new AuditService(db).record({
          userId: expert.id,
          organizationId: g.org,
          action: 'nda.accepted',
          objectType: 'nda_acceptance',
          objectId: row.id,
        });
      return { actor: user, profile: g.profile, legacy: row.id };
    };
    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool, '0021_submission_requirement_serialization');
      db = drizzle(pool, { schema: s, casing: 'snake_case' });
      const [nda] = await db
        .insert(s.ndaVersion)
        .values({ versionNumber: 42, body: 'Synthetic NDA test text', isCurrent: true })
        .returning();
      currentId = nda!.id;
      const imbc = (await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc')))[0]!;
      const [staff] = await db
        .insert(s.userAccounts)
        .values({ organizationId: imbc.id, role: 'expert', state: 'active', email: 'expert@nda.local' })
        .returning();
      expert = {
        id: staff!.id,
        organizationId: imbc.id,
        organizationType: 'imbc',
        role: 'expert',
        email: staff!.email,
        fullName: null,
        locale: 'en',
      };
      pending = await actor(undefined, true);
      known = await oldConsent('known');
      unknown = await oldConsent('unknown');
      conflict = await oldConsent('conflict');
      ambiguous = await oldConsent('ambiguous');
      await pool.query(`create role "${role}" nologin`);
      await applyAppRoleGrants(pool, role); // Earlier boundary has no canonical tables.
      await migrateThrough(pool);
      await applyAppRoleGrants(pool, role);
      appPool = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        application_name: 'nda-consent-tests',
        options: `-c role=${role}`,
        max: 5,
      });
      appDb = drizzle(appPool, { schema: s, casing: 'snake_case' });
      service = new CurrentNdaService(appPool, new AuditService(appDb));
      boss = new PgBoss({
        connectionString: process.env.TEST_DATABASE_URL,
        schema: 'pgboss_auth_test',
        supervise: false,
        schedule: false,
      });
      await boss.start();
      for (const queue of [QUEUES.adataPrefill, QUEUES.sendPasswordEmail, QUEUES.cleanupIdentity])
        await boss.createQueue(queue);
      await pool.query(
        `grant usage on schema pgboss_auth_test to "${role}"; grant select,insert,update,delete on all tables in schema pgboss_auth_test to "${role}"`,
      );
      onboarding = new ManufacturerOnboardingService(
        appPool,
        new ProfilesService(appDb),
        new AdataScheduler(appPool, boss, new AuditService(appDb)),
        new AuditService(appDb),
      );
    });
    afterAll(async () => {
      await boss?.stop();
      await appPool?.end();
      if (pool) await pool.query(`drop owned by "${role}"; drop role "${role}"`);
      await pool?.end();
    });
    const consentRows = async (user: AuthUser) =>
      db.select().from(s.accountNdaAcceptance).where(eq(s.accountNdaAcceptance.userAccountId, user.id));
    const profileRows = async (user: AuthUser) =>
      db.select().from(s.manufacturerProfile).where(eq(s.manufacturerProfile.organizationId, user.organizationId));
    const legacyRow = async (id: string) =>
      (await db.select().from(s.ndaAcceptance).where(eq(s.ndaAcceptance.id, id)))[0]!;

    it('backfills pending triplets before profile and uses exact old consent facts with uniquely audited original actor', async () => {
      expect(await consentRows(pending)).toEqual([
        expect.objectContaining({ userAccountId: pending.id, acceptedAt: original, ipAddress: '203.0.113.7' }),
      ]);
      expect(await profileRows(pending)).toHaveLength(0);
      const source = (await consentRows(known.actor))[0]!;
      expect(source.acceptedAt).toEqual(original);
      expect(source.ipAddress).toBe('203.0.113.7');
      expect(await legacyRow(known.legacy)).toMatchObject({
        accountNdaAcceptanceId: source.id,
        acceptedAt: original,
        organizationId: known.actor.organizationId,
      });
      expect(source.acceptedAt.getTime()).not.toBe(
        (await db.select().from(s.auditEntries).where(eq(s.auditEntries.objectId, known.legacy)))[0]!.at.getTime(),
      );
    });
    it('retains explicit unresolved old evidence for unknown, ambiguous and conflicting original actors/times', async () => {
      for (const old of [unknown, conflict, ambiguous])
        expect(await legacyRow(old.legacy)).toMatchObject({ accountNdaAcceptanceId: null, linkedAt: null });
      expect(await consentRows(unknown.actor)).toHaveLength(0);
      expect(await consentRows(ambiguous.actor)).toHaveLength(0);
      expect((await consentRows(conflict.actor))[0]!.acceptedAt).toEqual(original);
      expect((await pool.query('select * from nda_evidence_migration_report')).rows[0]).toMatchObject({
        raw_unresolved_legacy_rows: '3',
        effective_unresolved_legacy_rows: '3',
      });
    });
    it('captures new/R1 pending triplet writes before a profile and never overwrites a repeated account/version tick', async () => {
      const user = await actor(undefined, true),
        first = (await consentRows(user))[0]!;
      await appDb
        .update(s.userAccounts)
        .set({ registrationNdaAcceptedAt: new Date(), registrationIp: '198.51.100.1' })
        .where(eq(s.userAccounts.id, user.id));
      expect(await consentRows(user)).toEqual([first]);
      await appDb
        .update(s.userAccounts)
        .set({ registrationNdaVersionId: null, registrationNdaAcceptedAt: null, registrationIp: null })
        .where(eq(s.userAccounts.id, user.id));
      expect(await consentRows(user)).toEqual([first]);
    });
    it('links every durable version on an existing Verified profile without resetting content, state or evidence', async () => {
      const g = await seedProfileGraph(pool);
      await db.update(s.organizations).set({ bin: bin() }).where(eq(s.organizations.id, g.org));
      const user = await actor(g.org, true);
      await db
        .update(s.userAccounts)
        .set({ registrationHeardAboutUs: 'Original pending answer' })
        .where(eq(s.userAccounts.id, user.id));
      await db
        .update(s.manufacturerProfile)
        .set({ status: 'verified', verifiedAt: original })
        .where(eq(s.manufacturerProfile.id, g.profile));
      const before = await profileRows(user);
      const evidence = await consentRows(user);
      await onboarding.onPasswordSet(user.id, 'password_set', new Date());
      expect(await profileRows(user)).toEqual(before);
      expect(await consentRows(user)).toEqual(evidence);
      expect(
        (await db.select().from(s.userAccounts).where(eq(s.userAccounts.id, user.id)))[0]!.registrationHeardAboutUs,
      ).toBe('Original pending answer');
      expect(
        await currentAccountNdaEvidence(appDb, {
          accountId: user.id,
          organizationId: user.organizationId,
          ndaVersionId: currentId,
        }),
      ).toMatchObject({ profileLinked: true, acceptedAt: original });
      await onboarding.onPasswordSet(user.id, 'sign_in', new Date());
      expect(await consentRows(user)).toEqual(evidence);
    });
    it('fresh same-version migrated tick appends a bridge, preserves the old row/ID and reads new canonical time/IP only', async () => {
      const old = await legacyRow(unknown.legacy),
        beforeProfile = await profileRows(unknown.actor);
      const first = await service.accept(unknown.actor, { versionNumber: 42, accepted: true }, '198.51.100.44');
      expect(first.accepted).toBe(true);
      expect(first.profileLinked).toBe(true);
      expect(new Date(first.acceptedAt!)).not.toEqual(old.acceptedAt);
      expect(await legacyRow(unknown.legacy)).toEqual(old);
      expect(await profileRows(unknown.actor)).toEqual(beforeProfile);
      const canonical = await currentAccountNdaEvidence(appDb, {
        accountId: unknown.actor.id,
        organizationId: unknown.actor.organizationId,
        ndaVersionId: currentId,
      });
      expect(canonical?.ipAddress).toBe('198.51.100.44');
      const saved = await consentRows(unknown.actor);
      expect(await service.accept(unknown.actor, { versionNumber: 42, accepted: true }, '198.51.100.55')).toEqual(
        first,
      );
      expect(await consentRows(unknown.actor)).toEqual(saved);
      expect(
        await db.select().from(s.ndaAcceptanceBridge).where(eq(s.ndaAcceptanceBridge.ndaAcceptanceId, old.id)),
      ).toHaveLength(1);
      const report = (await pool.query('select * from nda_evidence_migration_report')).rows[0]!;
      expect(report.raw_unresolved_legacy_rows).toBe('3');
      expect(report.bridge_resolved_legacy_rows).toBe('1');
      expect(report.effective_unresolved_legacy_rows).toBe('2');
    });
    it('serializes concurrent direct and bridge replays without changing acceptedAt/IP or linking one source twice', async () => {
      const g = await seedProfileGraph(pool),
        user = await actor(g.org);
      const results = await Promise.all([
        service.accept(user, { versionNumber: 42, accepted: true }, '203.0.113.1'),
        service.accept(user, { versionNumber: 42, accepted: true }, '203.0.113.2'),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(await consentRows(user)).toHaveLength(1);
      expect(await db.select().from(s.ndaAcceptance).where(eq(s.ndaAcceptance.profileId, g.profile))).toHaveLength(1);
      const replay = await Promise.all([
        service.accept(unknown.actor, { versionNumber: 42, accepted: true }, '203.0.113.3'),
        service.accept(unknown.actor, { versionNumber: 42, accepted: true }, '203.0.113.4'),
      ]);
      expect(replay[0]).toEqual(replay[1]);
      expect(
        await db.select().from(s.ndaAcceptanceBridge).where(eq(s.ndaAcceptanceBridge.ndaAcceptanceId, unknown.legacy)),
      ).toHaveLength(1);
      const source = (await consentRows(user))[0]!;
      await expect(
        appDb.insert(s.ndaAcceptanceBridge).values({
          ndaAcceptanceId: known.legacy,
          profileId: known.profile,
          organizationId: known.actor.organizationId,
          ndaVersionId: currentId,
          accountNdaAcceptanceId: source.id,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
    it('preserves old R1 INSERT/read roundtrip and attaches only exact pending-account consent facts', async () => {
      const g = await seedProfileGraph(pool),
        user = await actor(g.org, true);
      const insert =
        'insert into nda_acceptance(profile_id,nda_version_id,accepted_at,ip_address) values($1,$2,$3,$4) on conflict do nothing returning id';
      const row = (await appPool.query<{ id: string }>(insert, [g.profile, currentId, original, '203.0.113.7']))
        .rows[0]!;
      const before = await legacyRow(row.id);
      expect(before.accountNdaAcceptanceId).toBe((await consentRows(user))[0]!.id);
      expect((await appPool.query(insert, [g.profile, currentId, new Date(), '203.0.113.99'])).rows).toEqual([]);
      expect(await legacyRow(row.id)).toEqual(before);
      const foreign = await actor();
      await expect(appDb.execute(accountNdaLinksInsert(g.profile, foreign.id))).rejects.toMatchObject({
        cause: { code: '23514' },
      });
    });
    it('denies wrong roles and forged account/profile/org/version sources at both service and database boundaries', async () => {
      const user = await actor(),
        foreign = await actor();
      await expect(
        service.accept(
          { ...user, organizationId: foreign.organizationId },
          { versionNumber: 42, accepted: true },
          '203.0.113.7',
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(service.accept(expert, { versionNumber: 42, accepted: true }, '203.0.113.7')).rejects.toMatchObject({
        code: 'forbidden',
      });
      await expect(
        appDb.insert(s.accountNdaAcceptance).values({
          userAccountId: user.id,
          organizationId: foreign.organizationId,
          ndaVersionId: currentId,
          acceptedAt: original,
          ipAddress: '203.0.113.7',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      await expect(
        appDb.insert(s.accountNdaAcceptance).values({
          userAccountId: expert.id,
          organizationId: expert.organizationId,
          ndaVersionId: currentId,
          acceptedAt: original,
          ipAddress: '203.0.113.7',
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
      const source = (await consentRows(known.actor))[0]!;
      const g = await seedProfileGraph(pool);
      await expect(
        appDb.insert(s.ndaAcceptance).values({
          profileId: g.profile,
          organizationId: g.org,
          ndaVersionId: currentId,
          accountNdaAcceptanceId: source.id,
          acceptedAt: source.acceptedAt,
          ipAddress: source.ipAddress,
        }),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });
    it('enforces append-only canonical evidence, direct links and bridges for app role and privileged row mutations', async () => {
      for (const table of ['account_nda_acceptance', 'nda_acceptance', 'nda_acceptance_bridge']) {
        for (const command of [`update ${table} set id=id`, `delete from ${table}`, `truncate ${table}`])
          await expect(appPool.query(command)).rejects.toMatchObject({ code: '42501' });
        await expect(pool.query(`update ${table} set id=id`)).rejects.toMatchObject({ code: '23514' });
      }
    });
    it('own HTTP accepts a current tick before a profile, replays stably and retains CSRF/session/role scopes', async () => {
      const user = await actor();
      const http = await startHttp({
        controllers: [CurrentNdaController],
        providers: [{ provide: CurrentNdaService, useValue: service }],
        organizationId: user.organizationId,
        accountIds: { manufacturer: user.id, expert: expert.id },
      });
      try {
        expect((await http.get('/api/v1/nda/current')).status).toBe(401);
        const first = await http.send('POST', '/api/v1/nda/current', 'manufacturer', {
          versionNumber: 42,
          accepted: true,
        });
        expect(first.status).toBe(200);
        const evidence = await first.json();
        expect(evidence).toMatchObject({ accepted: true, profileLinked: false });
        expect(
          await (
            await http.send('POST', '/api/v1/nda/current', 'manufacturer', { versionNumber: 42, accepted: true })
          ).json(),
        ).toEqual(evidence);
        expect(
          (await http.send('POST', '/api/v1/nda/current', 'manufacturer', { versionNumber: 42, accepted: false }))
            .status,
        ).toBe(400);
        expect(
          (
            await http.send('POST', '/api/v1/nda/current', 'manufacturer', {
              versionNumber: 42,
              accepted: true,
              accountId: known.actor.id,
            })
          ).status,
        ).toBe(400);
        expect(
          (await http.send('POST', '/api/v1/nda/current', 'expert', { versionNumber: 42, accepted: true })).status,
        ).toBe(403);
        expect(
          (
            await fetch(`${http.base}/api/v1/nda/current`, {
              method: 'POST',
              headers: {
                cookie: 'imbc-session=manufacturer',
                origin: 'https://foreign.local',
                'content-type': 'application/json',
              },
              body: JSON.stringify({ versionNumber: 42, accepted: true }),
            })
          ).status,
        ).toBe(403);
        expect(await profileRows(user)).toHaveLength(0);
      } finally {
        await http.close();
      }
    });
    it('rolls back canonical tick and profile linkage together on audit failure', async () => {
      const g = await seedProfileGraph(pool),
        user = await actor(g.org),
        before = await profileRows(user);
      const failing = new CurrentNdaService(appPool, {
        record: vi.fn().mockRejectedValue(new Error('audit failure')),
      } as unknown as AuditService);
      await expect(failing.accept(user, { versionNumber: 42, accepted: true }, '203.0.113.8')).rejects.toThrow(
        'audit failure',
      );
      expect(await consentRows(user)).toHaveLength(0);
      expect(await db.select().from(s.ndaAcceptance).where(eq(s.ndaAcceptance.profileId, g.profile))).toHaveLength(0);
      expect(await profileRows(user)).toEqual(before);
    });
    it('public signup persists original tick before password; invitation retry and version changes preserve original history', async () => {
      const keycloak = { createUser: vi.fn(async () => randomUUID()), deleteUser: vi.fn(), sendPasswordEmail: vi.fn() };
      @Controller('v1/registrations')
      class BoundRegistrationController extends RegistrationController {
        constructor() {
          super(
            appDb,
            boss,
            new IdentityProvisioningService(appPool, boss, keycloak as never),
            new AuditService(appDb),
            { enforce: vi.fn(), allow: vi.fn(async () => true) } as unknown as AuthRateLimitService,
          );
        }
      }
      const http = await startHttp({
        controllers: [BoundRegistrationController],
        providers: [
          { provide: DB, useValue: appDb },
          { provide: QUEUE, useValue: boss },
          {
            provide: IdentityProvisioningService,
            useValue: new IdentityProvisioningService(appPool, boss, keycloak as never),
          },
          { provide: AuthRateLimitService, useValue: { enforce: vi.fn(), allow: vi.fn(async () => true) } },
        ],
      });
      const body = {
        companyName: 'Synthetic registration',
        bin: bin(),
        email: `${randomUUID()}@nda.local`,
        locale: 'en',
        heardAboutUs: 'Synthetic test',
        acceptPlatformTerms: true,
        acceptPersonalData: true,
        ndaVersion: 42,
      };
      expect((await http.send('POST', '/api/v1/registrations', undefined, body)).status).toBe(202);
      const account = (await db.select().from(s.userAccounts).where(eq(s.userAccounts.email, body.email)))[0]!;
      const user: AuthUser = {
        id: account.id,
        organizationId: account.organizationId,
        role: 'manufacturer',
        organizationType: 'manufacturer',
        email: account.email,
        fullName: null,
        locale: 'en',
      };
      const first = (await consentRows(user))[0]!;
      expect(await profileRows(user)).toHaveLength(0);
      expect(
        (await http.send('POST', '/api/v1/registrations/resend', undefined, { email: account.email })).status,
      ).toBe(202);
      expect(
        (await http.send('POST', '/api/v1/registrations/resend', undefined, { email: account.email })).status,
      ).toBe(202);
      expect(await consentRows(user)).toEqual([first]);
      expect(
        (await http.send('POST', '/api/v1/registrations', undefined, { ...body, email: 'different@nda.local' })).status,
      ).toBe(409);
      await http.close();
      await db.update(s.ndaVersion).set({ isCurrent: false }).where(eq(s.ndaVersion.id, currentId));
      const [version] = await db
        .insert(s.ndaVersion)
        .values({ versionNumber: 43, body: 'Synthetic new NDA test text', isCurrent: true })
        .returning();
      try {
        await onboarding.onPasswordSet(user.id, 'password_set', new Date());
        expect(await consentRows(user)).toEqual([first]);
        await db.update(s.userAccounts).set({ state: 'active' }).where(eq(s.userAccounts.id, user.id));
        expect((await service.read(user)).accepted).toBe(false);
        await service.accept(user, { versionNumber: 43, accepted: true }, '198.51.100.9');
        expect(await consentRows(user)).toHaveLength(2);
        expect((await consentRows(user)).find((row) => row.ndaVersionId === currentId)).toEqual(first);
        expect((await service.read(user)).profileLinked).toBe(true);
      } finally {
        await db.update(s.ndaVersion).set({ isCurrent: false }).where(eq(s.ndaVersion.id, version!.id));
        await db.update(s.ndaVersion).set({ isCurrent: true }).where(eq(s.ndaVersion.id, currentId));
      }
    });
    it('preserves two accepted versions before password and links ALL of them atomically at profile creation', async () => {
      const user = await actor(undefined, true),
        originalSource = (await consentRows(user))[0]!;
      await db.update(s.ndaVersion).set({ isCurrent: false }).where(eq(s.ndaVersion.id, currentId));
      const [version] = await db
        .insert(s.ndaVersion)
        .values({ versionNumber: 44, body: 'Synthetic pre-profile version', isCurrent: true })
        .returning();
      try {
        expect((await service.accept(user, { versionNumber: 44, accepted: true }, '198.51.100.44')).profileLinked).toBe(
          false,
        );
        expect(await profileRows(user)).toHaveLength(0);
        const both = await consentRows(user);
        expect(both).toHaveLength(2);
        await onboarding.onPasswordSet(user.id, 'password_set', new Date());
        expect(await consentRows(user)).toEqual(both);
        const links = await db
          .select()
          .from(s.ndaAcceptance)
          .where(eq(s.ndaAcceptance.organizationId, user.organizationId));
        expect(new Set(links.map((link) => link.accountNdaAcceptanceId))).toEqual(
          new Set(both.map((source) => source.id)),
        );
        expect(links.find((link) => link.ndaVersionId === currentId)).toMatchObject({
          acceptedAt: originalSource.acceptedAt,
          ipAddress: originalSource.ipAddress,
        });
      } finally {
        await db.update(s.ndaVersion).set({ isCurrent: false }).where(eq(s.ndaVersion.id, version!.id));
        await db.update(s.ndaVersion).set({ isCurrent: true }).where(eq(s.ndaVersion.id, currentId));
      }
    });
    const waitForLock = async () => {
      for (let attempt = 0; attempt < 200; attempt++) {
        const count = (
          await pool.query<{ n: number }>(
            "select count(*)::int as n from pg_stat_activity where application_name='nda-consent-tests' and wait_event_type='Lock'",
          )
        ).rows[0]!.n;
        if (count) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Expected isolated NDA lock wait');
    };
    it('fresh current-version check after waiting rejects a superseded displayed version without recording a tick', async () => {
      const user = await actor(),
        writer = await pool.connect();
      let pendingResult: Promise<unknown> | undefined;
      let newId: string | undefined;
      try {
        await writer.query('begin');
        await writer.query('update nda_version set is_current=false where id=$1', [currentId]);
        newId = (
          await writer.query<{ id: string }>(
            "insert into nda_version(version_number,body,is_current) values(45,'Synthetic wait test',true) returning id",
          )
        ).rows[0]!.id;
        pendingResult = service.accept(user, { versionNumber: 42, accepted: true }, '203.0.113.7').then(
          (value) => value,
          (error: unknown) => error,
        );
        await waitForLock();
        await writer.query('commit');
        expect(await pendingResult).toMatchObject({ code: 'nda_version_changed' });
        expect(await consentRows(user)).toHaveLength(0);
      } finally {
        await writer.query('rollback');
        writer.release();
        await pendingResult;
        if (newId) await db.update(s.ndaVersion).set({ isCurrent: false }).where(eq(s.ndaVersion.id, newId));
        await db.update(s.ndaVersion).set({ isCurrent: true }).where(eq(s.ndaVersion.id, currentId));
      }
    });
    it('DB parent serialization sees a committed bridge after waiting and denies duplicate direct use of its source', async () => {
      const g = await seedProfileGraph(pool),
        user = await actor(g.org);
      const old = (
        await pool.query<{ id: string }>(
          'insert into nda_acceptance(profile_id,nda_version_id,accepted_at,ip_address) values($1,$2,$3,$4) returning id',
          [g.profile, currentId, original, '203.0.113.7'],
        )
      ).rows[0]!;
      const [source] = await appDb
        .insert(s.accountNdaAcceptance)
        .values({
          userAccountId: user.id,
          organizationId: g.org,
          ndaVersionId: currentId,
          acceptedAt: new Date(),
          ipAddress: '198.51.100.22',
        })
        .returning();
      const writer = await pool.connect();
      let blocked: Promise<unknown> | undefined;
      try {
        await writer.query('begin');
        await writer.query(
          'insert into nda_acceptance_bridge(nda_acceptance_id,profile_id,organization_id,nda_version_id,account_nda_acceptance_id) values($1,$2,$3,$4,$5)',
          [old.id, g.profile, g.org, currentId, source!.id],
        );
        blocked = appPool
          .query(
            'insert into nda_acceptance(profile_id,organization_id,nda_version_id,account_nda_acceptance_id,accepted_at,ip_address) values($1,$2,$3,$4,$5,$6) on conflict do nothing',
            [g.profile, g.org, currentId, source!.id, source!.acceptedAt, source!.ipAddress],
          )
          .then(
            (value) => value,
            (error: unknown) => error,
          );
        await waitForLock();
        await writer.query('commit');
        expect(await blocked).toMatchObject({ code: '23514' });
        expect(
          await db
            .select()
            .from(s.ndaAcceptanceBridge)
            .where(eq(s.ndaAcceptanceBridge.accountNdaAcceptanceId, source!.id)),
        ).toHaveLength(1);
        expect(
          await db.select().from(s.ndaAcceptance).where(eq(s.ndaAcceptance.accountNdaAcceptanceId, source!.id)),
        ).toHaveLength(0);
      } finally {
        await writer.query('rollback');
        writer.release();
        await blocked;
      }
    });
  },
);

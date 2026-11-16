import 'reflect-metadata';
import { can, POLICY_ACTIONS, POLICY_ACTION_CLASS, RELEASE_POLICY_RULES, ROLES, type Role } from '@imbc/contracts';
import { Controller, Get, Post } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockActor } from '../src/common/actor-transaction.js';
import { loadDatabasePolicy, POLICY, PolicyEngine } from '../src/common/policy.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import { applyMigrations } from '../src/database/migrator.js';
import { applyReleasePolicyRules } from '../src/database/policy-data.js';
import * as schema from '../src/database/schema/index.js';
import { Can } from '../src/modules/auth/guards.js';
import { openTestPool, resetDatabase } from './support/database.js';
import { startHttp } from './support/http.js';

@Controller('v1/policy-probe')
class PolicyProbeController {
  @Get('lps') @Can('lps.read') read() {
    return { permitted: true };
  }
  @Post('lps') @Can('lps.edit') edit() {
    return { permitted: true };
  }
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('GEN-08/10 authoritative release policy / migration0023', () => {
  let pool: pg.Pool;
  let db: Database;
  let policy: PolicyEngine;
  let expertId: string;
  const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
  const resetRelease = async () => {
    const client = await pool.connect();
    try {
      await applyReleasePolicyRules(client);
    } finally {
      client.release();
    }
  };
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    // The production runner commits enum DDL before its atomic seed step, including a fresh install.
    await applyMigrations(pool, folder);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    policy = await loadDatabasePolicy(db);
    expertId = (
      await pool.query<{ id: string }>(`
      insert into user_accounts(organization_id,email,role,state,idp_subject)
      select id,'policy-expert@test.local','expert','active','policy-expert-subject'
      from organizations where type='imbc' returning id`)
    ).rows[0]!.id;
  }, 60000);
  afterAll(async () => {
    await pool?.end();
  });

  it.each(RELEASE_POLICY_RULES.map((row) => [row.role, row.action, row] as const))(
    'loads release access case %s / %s from SQL rows in its exact class',
    (_role, _action, row) => {
      expect(policy.can(row.role, row.action, row.dataClass)).toEqual(can(row.role, row.action));
    },
  );
  it('keeps all absent role/action pairs denied and G independent of manufacturer visibility or NDA', async () => {
    for (const role of ROLES)
      for (const action of POLICY_ACTIONS) expect(policy.can(role, action)).toEqual(can(role, action));
    expect(policy.can('operator', 'lps.read', 'a_register')).toBeNull();
    expect(policy.can('administrator', 'lps.edit', 'e_administration')).toBeNull();
    expect((await pool.query('select enum_range(null::data_class)::text[] as labels')).rows[0].labels).toEqual([
      'a_register',
      'b_manufacturer',
      'c_imbc',
      'd_operator',
      'e_administration',
      'f_forecast',
      'g_lps',
    ]);
  });
  it('is idempotent on repeated production migration/seed and preserves current rule UUIDs', async () => {
    const before = (await pool.query('select * from policy_rule order by id')).rows;
    await applyMigrations(pool, folder);
    expect((await pool.query('select * from policy_rule order by id')).rows).toEqual(before);
  });
  it('uses loaded SQL permissions in the real HTTP guard for all six roles, with denial audit', async () => {
    const http = await startHttp({
      controllers: [PolicyProbeController],
      providers: [{ provide: POLICY, useValue: policy }],
    });
    try {
      for (const role of ROLES) {
        expect((await http.get('/api/v1/policy-probe/lps', role)).status, role).toBe(
          ['expert', 'operator', 'director'].includes(role) ? 200 : 403,
        );
        expect((await http.send('POST', '/api/v1/policy-probe/lps', role, {})).status, role).toBe(
          role === 'expert' ? 201 : 403,
        );
      }
      expect(http.audit.record).toHaveBeenCalledTimes(8);
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied', action: 'lps.edit' }),
      );
    } finally {
      await http.close();
    }
  });
  it('rechecks persisted policy after locking the actor rather than trusting a prior cached allow', async () => {
    expect(policy.can('expert', 'lps.read')).toBe('all');
    await pool.query("update policy_rule set effect='deny' where role='expert' and action='lps.read'");
    try {
      expect((await loadDatabasePolicy(db)).can('expert', 'lps.read')).toBeNull();
      await expect(db.transaction((tx) => lockActor(tx, expertId, undefined, 'lps.read'))).rejects.toMatchObject({
        status: 403,
        code: 'forbidden',
      });
      // A newly bootstrapped guard sees the persisted deny even though the UI release hint still allows it.
      const http = await startHttp({
        controllers: [PolicyProbeController],
        providers: [{ provide: POLICY, useValue: await loadDatabasePolicy(db) }],
      });
      try {
        expect((await http.get('/api/v1/policy-probe/lps', 'expert')).status).toBe(403);
      } finally {
        await http.close();
      }
    } finally {
      await resetRelease();
    }
  });
  it('fails closed at startup on empty or unknown rows; only a release restores them', async () => {
    await pool.query('DELETE FROM policy_rule');
    await expect(loadDatabasePolicy(db)).rejects.toThrow('empty_policy_rules');
    await resetRelease();
    await pool.query(
      "insert into policy_rule(role,data_class,action,condition,effect) values('expert','c_imbc','unknown.action','none','allow')",
    );
    await expect(loadDatabasePolicy(db)).rejects.toThrow();
    await resetRelease();
    expect((await loadDatabasePolicy(db)).can('expert', 'lps.read')).toBe('all');
  });
  it('does not permit a role to receive every known action', () => {
    expect(
      () =>
        new PolicyEngine(
          POLICY_ACTIONS.map((action) => ({
            role: 'expert' as Role,
            action,
            dataClass: POLICY_ACTION_CLASS[action],
            condition: 'none',
            effect: 'allow',
          })),
        ),
    ).toThrow('policy_role_has_every_right');
  });
  it('grants the runtime role SELECT but no INSERT/UPDATE/DELETE/TRUNCATE on policy rows', async () => {
    const name = 'imbc_policy_readonly_test';
    await pool.query(`CREATE ROLE ${name} NOLOGIN`);
    try {
      await applyAppRoleGrants(pool, name);
      const client = await pool.connect();
      try {
        await client.query(`SET ROLE ${name}`);
        expect((await client.query('select count(*)::int as n from policy_rule')).rows[0].n).toBe(
          RELEASE_POLICY_RULES.length,
        );
        for (const query of [
          "insert into policy_rule(role,data_class,action,condition,effect) values('observer','g_lps','lps.read','none','allow')",
          "update policy_rule set effect='deny'",
          'DELETE FROM policy_rule',
          'TRUNCATE policy_rule',
        ])
          await expect(client.query(query)).rejects.toMatchObject({ code: '42501' });
      } finally {
        await client.query('RESET ROLE');
        client.release();
      }
    } finally {
      await pool.query(`DROP OWNED BY ${name}`);
      await pool.query(`DROP ROLE ${name}`);
    }
  });
});

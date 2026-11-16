import type { DataClass, FilePurpose, Role } from '@imbc/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/database.module.js';
import type { AuthContext } from '../src/modules/auth/auth.types.js';
import { manufacturerFileRule } from '../src/modules/files/file-access.js';
import { PgDialect } from 'drizzle-orm/pg-core';
import { TEST_POLICY_ROWS } from './support/policy.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const FILE = '00000000-0000-4000-8000-000000000002';
const REVISION = '00000000-0000-4000-8000-000000000003';
const VERSION = '00000000-0000-4000-8000-000000000004';
const auth = (role: Role) => ({ user: { role, organizationId: ORG } }) as AuthContext;
const file = { id: FILE, organizationId: ORG, purpose: 'cv' as FilePurpose, dataClass: 'b_manufacturer' as DataClass };
const owner = (state = 'working', submittedAt: Date | null = null) => ({
  sectionRevisionId: REVISION,
  state,
  submittedAt,
});
const txWith = (...rows: unknown[][]) => {
  const execute = vi.fn();
  for (const result of rows) execute.mockResolvedValueOnce({ rows: result });
  const query = (statement: Parameters<PgDialect['sqlToQuery']>[0]) =>
    new PgDialect().sqlToQuery(statement).sql.includes('from policy_rule')
      ? Promise.resolve({ rows: TEST_POLICY_ROWS })
      : execute(statement);
  return { tx: { execute: query } as unknown as Database, execute };
};

describe('manufacturer file selection: saved owner and frozen snapshot (GEN-09, DATA-07)', () => {
  it('own upload preview is available without an owner lookup; another tenant and class are denied', async () => {
    const { tx, execute } = txWith();
    expect(await manufacturerFileRule({ tx, auth: auth('manufacturer'), file })).toEqual({
      allowed: true,
      versions: 'latest',
    });
    expect(
      await manufacturerFileRule({ tx, auth: auth('manufacturer'), file: { ...file, organizationId: FILE } }),
    ).toEqual({ allowed: false });
    expect(
      await manufacturerFileRule({ tx, auth: auth('manufacturer'), file: { ...file, dataClass: 'c_imbc' } }),
    ).toEqual({ allowed: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['administrator', 'operator', 'observer'] as const)(
    '%s cannot read manufacturer content or probe its owners',
    async (role) => {
      const { tx, execute } = txWith();
      expect(await manufacturerFileRule({ tx, auth: auth(role), file })).toEqual({ allowed: false });
      expect(execute).not.toHaveBeenCalled();
    },
  );

  it.each(['expert', 'director'] as const)('%s needs a persisted owner, including Draft', async (role) => {
    expect(await manufacturerFileRule({ tx: txWith([]).tx, auth: auth(role), file })).toEqual({ allowed: false });
    const { tx, execute } = txWith([owner()]);
    expect(await manufacturerFileRule({ tx, auth: auth(role), file })).toEqual({ allowed: true, versions: 'latest' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('frozen owners without snapshots fail closed; captured IDs constrain default and explicit selection', async () => {
    expect(await manufacturerFileRule({ tx: txWith([owner('submitted')], []).tx, auth: auth('expert'), file })).toEqual(
      { allowed: false },
    );
    expect(
      await manufacturerFileRule({
        tx: txWith([owner('verified')], [{ id: VERSION }]).tx,
        auth: auth('director'),
        file,
      }),
    ).toEqual({ allowed: true, versions: [VERSION] });
  });

  it('a submitted timestamp prevents malformed working metadata from granting latest access', async () => {
    expect(
      await manufacturerFileRule({ tx: txWith([owner('working', new Date())], []).tx, auth: auth('expert'), file }),
    ).toEqual({ allowed: false });
  });

  it('a permitted working owner permits latest even if another owner is frozen', async () => {
    const { tx, execute } = txWith([owner('verified'), owner()]);
    expect(await manufacturerFileRule({ tx, auth: auth('director'), file })).toEqual({
      allowed: true,
      versions: 'latest',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

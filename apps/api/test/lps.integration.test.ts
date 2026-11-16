import 'reflect-metadata';
import {
  LPS_SORT_COLUMNS,
  ROLES,
  lpsDashboardSchema,
  lpsEntryReadSchema,
  lpsCompanyReadSchema,
  lpsListSchema,
  type LpsEntryRead,
  type Role,
} from '@imbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Database } from '../src/database/database.module.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import * as s from '../src/database/schema/index.js';
import { LpsService } from '../src/modules/lps/lps.service.js';
import { LpsController } from '../src/modules/lps/lps.controller.js';
import * as readGraph from '../src/modules/lps/lps-read.js';
import { DictionariesService } from '../src/modules/dictionaries/dictionaries.service.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { ORGANIZATION_TYPE } from './support/organization-type.js';

const ROOT = '/api/v1/lps';
const TABLES =
  'lps_contact_email,lps_contact_phone,lps_contact,lps_location,lps_entry_commodity,lps_entry,lps_company_country,lps_company';
describe.skipIf(!process.env.TEST_DATABASE_URL)('LPS class G real PostgreSQL and HTTP', () => {
  let pool: pg.Pool, db: Database, http: HttpStand, service: LpsService;
  let orgId: string, accounts: Record<Role, string>, references: Record<string, string>;
  let first: LpsEntryRead, second: LpsEntryRead, missing: LpsEntryRead;
  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema: s, casing: 'snake_case' });
    const [imbc] = await db.select().from(s.organizations).where(eq(s.organizations.type, 'imbc'));
    orgId = imbc!.id;
    accounts = {} as typeof accounts;
    for (const role of ROLES) {
      const type = ORGANIZATION_TYPE[role];
      const org =
        type === 'imbc'
          ? imbc!
          : (
              await db
                .insert(s.organizations)
                .values({
                  type,
                  name: `LPS fixture ${role}`,
                  ...(type === 'manufacturer' ? { bin: '261100001234' } : {}),
                })
                .returning()
            )[0]!;
      const [account] = await db
        .insert(s.userAccounts)
        .values({ organizationId: org.id, role, state: 'active', email: `lps-${role}@fixture.local` })
        .returning();
      accounts[role] = account!.id;
    }
    references = {};
    const seedReference = async (dictionary: string, code: string, parentEntryId?: string) => {
      let [dict] = await db.select().from(s.dictionary).where(eq(s.dictionary.code, dictionary));
      if (!dict)
        [dict] = await db
          .insert(s.dictionary)
          .values({ code: dictionary, name: `Fixture ${dictionary}` })
          .returning();
      let [entry] = await db
        .select()
        .from(s.dictionaryEntry)
        .where(sql`${s.dictionaryEntry.dictionaryId}=${dict!.id} and ${s.dictionaryEntry.code}=${code}`);
      if (!entry)
        [entry] = await db
          .insert(s.dictionaryEntry)
          .values({ dictionaryId: dict!.id, code, parentEntryId })
          .returning();
      for (const language of ['en', 'ru', 'kk'] as const)
        await db
          .insert(s.dictionaryEntryTranslation)
          .values({ dictionaryEntryId: entry!.id, language, name: `${language} ${code}` })
          .onConflictDoNothing();
      references[code] = entry!.id;
    };
    for (const code of ['KZ', 'DE']) await seedReference('country', code);
    for (const code of ['LC', 'LPS']) await seedReference('programme', code);
    for (const code of ['planning', 'in_process', 'localized', 'on_hold']) await seedReference('lps_status', code);
    await seedReference('commodity_group', 'A');
    await seedReference('commodity_group', 'B');
    await seedReference('commodity_type', 'LPS-A1', references.A);
    await seedReference('commodity_type', 'LPS-B1', references.B);
    await seedReference('region', 'LPS-R1');
    await seedReference('region', 'LPS-R2');
    service = new LpsService(pool, new AuditService(db));
  }, 60000);
  beforeEach(async () => {
    await pool.query(`truncate ${TABLES}`);
    http = await startHttp({
      controllers: [LpsController],
      providers: [{ provide: LpsService, useValue: service }],
      organizationId: orgId,
      accountIds: accounts,
    });
    const c1 = lpsCompanyReadSchema.parse(
      await json(
        await http.send('POST', `${ROOT}/companies`, 'expert', {
          name: 'Fixture Alpha',
          countryIds: [references.KZ, references.DE],
        }),
      ),
    );
    const c2 = lpsCompanyReadSchema.parse(
      await json(await http.send('POST', `${ROOT}/companies`, 'expert', { name: 'Fixture Beta' })),
    );
    first = await create({
      companyId: c1.id,
      scopeDescription: 'Fixture pump and service',
      statusId: references.planning,
      investmentUsd: '0009007199254740993.001200',
      newJobs: 0,
      plannedLaunch: ' Q4 2027/q1 2028 ',
      lastUpdatedOn: '2026-11-01',
      comment: 'Visible business commentary',
      commodityTypeIds: [references['LPS-B1'], references['LPS-A1']],
      locations: [
        { city: 'Town A', regionId: references['LPS-R1'] },
        { city: 'Town B', regionId: references['LPS-R2'] },
      ],
      contacts: [
        {
          fullName: 'Fixture Person',
          roleTitle: 'Focal point',
          emails: ['BOX@FIXTURE.LOCAL', 'two@fixture.local'],
          phones: ['+7 701 234 5678 ext 0004'],
        },
        { fullName: null, roleTitle: null, emails: ['general@fixture.local'], phones: [] },
      ],
    });
    second = await create({
      companyId: c1.id,
      sourceTypeId: references.LC,
      scopeDescription: 'Fixture maintenance',
      statusId: references.localized,
      investmentUsd: '20.00',
      newJobs: 7,
      plannedLaunch: '2026',
      lastUpdatedOn: '2026-11-02',
      commodityTypeIds: [references['LPS-A1']],
      locations: [{ city: 'Town B', regionId: references['LPS-R1'] }],
    });
    missing = await create({
      companyId: c2.id,
      scopeDescription: 'Fixture undecided service',
      statusId: references.on_hold,
    });
  });
  afterEach(async () => {
    await http?.close();
  });
  afterAll(async () => {
    await pool?.end();
  });
  const json = async (response: Response) => {
    const value = await response.json();
    if (!response.ok) throw new Error(`Fixture request failed ${response.status}: ${JSON.stringify(value)}`);
    return value;
  };
  const create = async (input: unknown) =>
    lpsEntryReadSchema.parse(await json(await http.send('POST', `${ROOT}/entries`, 'expert', input)));
  const write = (entry: LpsEntryRead) => ({
    companyId: entry.company.id,
    sourceTypeId: entry.sourceType.id,
    scopeDescription: entry.scopeDescription,
    statusId: entry.status.id,
    plannedLaunch: entry.plannedLaunch,
    comment: entry.comment,
    investmentUsd: entry.investmentUsd,
    newJobs: entry.newJobs,
    lastUpdatedOn: entry.lastUpdatedOn,
    commodityTypeIds: entry.commodityTypes.map((value) => value.id),
    locations: entry.locations.map((value) => ({ id: value.id, city: value.city, regionId: value.region?.id ?? null })),
    contacts: entry.contacts.map((value) => ({ ...value })),
  });
  const list = async (query = '', role: Role = 'operator') =>
    lpsListSchema.parse(await json(await http.get(`${ROOT}/entries${query ? `?${query}` : ''}`, role)));
  const dashboard = async (query = '', role: Role = 'operator') =>
    lpsDashboardSchema.parse(await json(await http.get(`${ROOT}/dashboard${query ? `?${query}` : ''}`, role)));
  const context = (role: Role = 'expert') => ({
    actor: {
      id: accounts[role],
      organizationId: orgId,
      role,
      email: `${role}@fixture.local`,
      fullName: null,
      organizationType: 'imbc' as const,
      locale: 'kk',
    },
    ip: null,
  });
  const appSql = async <T>(work: (client: pg.PoolClient) => Promise<T>) => {
    await pool.query(
      "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lps_review_app') THEN CREATE ROLE lps_review_app; END IF; END $$",
    );
    await applyAppRoleGrants(pool, 'lps_review_app');
    const client = await pool.connect();
    try {
      await client.query('set role lps_review_app');
      return await work(client);
    } finally {
      await client.query('reset role');
      client.release();
    }
  };
  const waitForLock = async (queryPattern: string) => {
    for (let tries = 0; tries < 150; tries++) {
      const wait = await pool.query(
        'select count(*)::int count from pg_stat_activity where datname=current_database() and wait_event_type=$1 and query like $2',
        ['Lock', queryPattern],
      );
      if (wait.rows[0].count > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected real PostgreSQL lock wait was not observed');
  };

  it.each(ROLES)('%s sees only its persisted policy rights over class G', async (role) => {
    const read = ['expert', 'operator', 'director'].includes(role),
      edit = role === 'expert';
    for (const path of [
      '/entries',
      `/entries/${first.id}`,
      '/companies',
      `/companies/${first.company.id}`,
      '/dashboard',
    ])
      expect((await http.get(`${ROOT}${path}`, role)).status).toBe(read ? 200 : 403);
    expect((await http.send('PUT', `${ROOT}/entries/${first.id}`, role, write(first))).status).toBe(edit ? 200 : 403);
    expect((await http.send('POST', `${ROOT}/companies`, role, { name: `Fixture ${role}` })).status).toBe(
      edit ? 201 : 403,
    );
  });
  it('requires a session and validates CSRF before writes', async () => {
    expect((await http.get(`${ROOT}/entries`)).status).toBe(401);
    expect(
      (
        await fetch(`${http.base}${ROOT}/companies`, {
          method: 'POST',
          headers: {
            cookie: 'imbc-session=expert',
            origin: 'https://foreign.local',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ name: 'Foreign request' }),
        })
      ).status,
    ).toBe(403);
  });
  it('preserves decimal precision, unknowns, launch periods and associated focal points', async () => {
    expect(first).toMatchObject({
      investmentUsd: '9007199254740993.001200',
      newJobs: 0,
      plannedLaunch: 'Q4 2027 / Q1 2028',
      lastUpdatedOn: '2026-11-01',
    });
    expect(missing).toMatchObject({
      investmentUsd: null,
      newJobs: null,
      plannedLaunch: null,
      lastUpdatedOn: null,
      contacts: [],
      locations: [],
      commodityTypes: [],
      sourceType: { code: 'LPS' },
    });
    expect(first.contacts).toMatchObject([
      {
        fullName: 'Fixture Person',
        emails: ['box@fixture.local', 'two@fixture.local'],
        phones: ['+77012345678 ext. 0004'],
      },
      { fullName: null, emails: ['general@fixture.local'] },
    ]);
    expect(first.commodityGroups.map((value) => value.code)).toEqual(['A', 'B']);
    const stored = await pool.query('select investment_usd::text amount from lps_entry where id=$1', [first.id]);
    expect(stored.rows[0].amount).toBe(first.investmentUsd);
  });
  it('reuses a company across statuses and allows duplicate company names without inferring identity', async () => {
    const duplicate = lpsCompanyReadSchema.parse(
      await json(await http.send('POST', `${ROOT}/companies`, 'expert', { name: first.company.name })),
    );
    expect(duplicate.id).not.toBe(first.company.id);
    expect((await list()).items.filter((value) => value.company.id === first.company.id)).toHaveLength(2);
    const facts = await dashboard();
    expect(facts.totalEntries).toBe(3);
    expect(facts.totalCompanies).toBe(2);
    expect(facts.statuses.reduce((sum, value) => sum + value.count, 0)).toBe(3);
    expect(facts.regions.reduce((sum, value) => sum + value.count, 0)).toBe(4);
  });
  it('allows direct manual status selection, immediately visible without profile/NDA/approval/queue effects', async () => {
    const before = await pool.query(
      'select (select count(*) from manufacturer_profile)::int profiles,(select count(*) from account_nda_acceptance)::int nda',
    );
    const updated = lpsEntryReadSchema.parse(
      await json(
        await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', {
          ...write(first),
          statusId: references.on_hold,
        }),
      ),
    );
    expect(updated.status.code).toBe('on_hold');
    expect((await list(`statusIds=${references.on_hold}`)).items.map((value) => value.id)).toContain(first.id);
    expect(
      (
        await pool.query(
          'select (select count(*) from manufacturer_profile)::int profiles,(select count(*) from account_nda_acceptance)::int nda',
        )
      ).rows,
    ).toEqual(before.rows);
    expect(JSON.stringify(updated)).not.toMatch(/migrationKey|importRow|idpSubject|organizationId/);
  });
  it('shared company edits stamp every affected entry and audit full old facts without advancing business dates', async () => {
    const edited = await http.send('PUT', `${ROOT}/companies/${first.company.id}`, 'expert', {
      name: 'Fixture Renamed',
      countryIds: [references.KZ],
    });
    expect(edited.status).toBe(200);
    const rows = await list();
    const affected = rows.items.filter((value) => value.company.id === first.company.id);
    expect(affected.map((value) => value.updatedAt)).toEqual([
      affected[0]!.company.updatedAt,
      affected[0]!.company.updatedAt,
    ]);
    expect(new Set(affected.map((value) => value.lastUpdatedOn))).toEqual(new Set(['2026-11-01', '2026-11-02']));
    const audit = await pool.query(
      'select diff from audit_entries where object_type=$1 and object_id=$2 order by at desc limit 1',
      ['lps_entry', first.id],
    );
    expect(audit.rows[0].diff).toMatchObject({
      operation: 'update',
      before: {
        company: { name: 'Fixture Alpha', countries: expect.any(Array) },
        contacts: first.contacts,
        investmentUsd: first.investmentUsd,
      },
      after: { company: { name: 'Fixture Renamed' }, contacts: first.contacts },
    });
  });
  it('keeps historical LC when Type is omitted on edit and preserves stable ordered child IDs', async () => {
    const input = write(first);
    const updated = lpsEntryReadSchema.parse(
      await json(
        await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', {
          ...input,
          contacts: [...input.contacts].reverse(),
          locations: [...input.locations].reverse(),
        }),
      ),
    );
    expect(updated.contacts.map((value) => value.id)).toEqual(first.contacts.map((value) => value.id).reverse());
    expect(updated.locations.map((value) => value.id)).toEqual(first.locations.map((value) => value.id).reverse());
    const { sourceTypeId: _, ...legacy } = write(second);
    expect(
      lpsEntryReadSchema.parse(await json(await http.send('PUT', `${ROOT}/entries/${second.id}`, 'expert', legacy)))
        .sourceType.code,
    ).toBe('LC');
  });
  it('refuses foreign child IDs and rolls all values back', async () => {
    const response = await http.send('PUT', `${ROOT}/entries/${second.id}`, 'expert', {
      ...write(second),
      locations: [{ id: first.locations[0]!.id, city: 'Stolen', regionId: references['LPS-R1'] }],
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'lps_child_scope' });
    expect(lpsEntryReadSchema.parse(await json(await http.get(`${ROOT}/entries/${second.id}`, 'operator')))).toEqual(
      second,
    );
  });
  it.each([
    { plannedLaunch: 'Q5 2027' },
    { investmentUsd: -1 },
    { investmentUsd: '1e3' },
    { newJobs: -1 },
    { newJobs: 0.5 },
    { lastUpdatedOn: '2026-02-29' },
    { scopeDescription: ' ' },
    { statusId: 'bad' },
  ])('rejects invalid business facts %j before mutation', async (patch) => {
    expect(
      (await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', { ...write(first), ...patch })).status,
    ).toBe(400);
    expect(lpsEntryReadSchema.parse(await json(await http.get(`${ROOT}/entries/${first.id}`, 'expert')))).toEqual(
      first,
    );
  });
  it('rejects wrong dictionaries and retains retired references only in unchanged fields', async () => {
    expect(
      (await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', { ...write(first), statusId: references.KZ }))
        .status,
    ).toBe(400);
    await db
      .update(s.dictionaryEntry)
      .set({ retiredAt: new Date() })
      .where(eq(s.dictionaryEntry.id, references['LPS-R1']!));
    try {
      expect((await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', write(first))).status).toBe(200);
      expect(
        (
          await http.send('PUT', `${ROOT}/entries/${missing.id}`, 'expert', {
            ...write(missing),
            locations: [{ city: 'Town X', regionId: references['LPS-R1'] }],
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', {
            ...write(first),
            locations: [{ city: 'Town X', regionId: references['LPS-R1'] }],
          })
        ).status,
      ).toBe(400);
    } finally {
      await db
        .update(s.dictionaryEntry)
        .set({ retiredAt: null })
        .where(eq(s.dictionaryEntry.id, references['LPS-R1']!));
    }
  });
  it('matches city/region and type/group as pairs, AND dimensions with OR values', async () => {
    expect((await list(`cities=Town%20A&regionIds=${references['LPS-R2']}`)).total).toBe(0);
    expect((await list(`cities=Town%20A&regionIds=${references['LPS-R1']}`)).items.map((value) => value.id)).toEqual([
      first.id,
    ]);
    expect((await list(`commodityTypeIds=${references['LPS-A1']}&commodityGroupIds=${references.B}`)).total).toBe(0);
    const multi = `regionIds=${references['LPS-R1']}&regionIds=${references['LPS-R2']}&commodityGroupIds=${references.A}&statusIds=${references.planning}&statusIds=${references.localized}`;
    expect(new Set((await list(multi)).items.map((value) => value.id))).toEqual(new Set([first.id, second.id]));
  });
  it('uses exact same filtered IDs/counts and paired facets for dashboard drilldown', async () => {
    const filter = `regionIds=${references['LPS-R1']}&commodityGroupIds=${references.A}`;
    const page = await list(filter);
    const counts = await dashboard(filter);
    expect(counts.totalEntries).toBe(page.total);
    expect(page.total).toBe(2);
    expect(counts.regions.map((value) => value.reference?.id)).toEqual([references['LPS-R1']]);
    expect(counts.commodityGroups.map((value) => value.reference?.id)).toEqual([references.A]);
    for (const bucket of counts.regions)
      expect((await list(`regionIds=${bucket.reference!.id}&commodityGroupIds=${references.A}`)).total).toBe(
        bucket.count,
      );
    for (const bucket of counts.commodityGroups)
      expect((await list(`regionIds=${references['LPS-R1']}&commodityGroupIds=${bucket.reference!.id}`)).total).toBe(
        bucket.count,
      );
  });
  it('fetches the child graph only for IDs on the SQL-selected page', async () => {
    const spy = vi.spyOn(readGraph, 'readLpsEntries');
    try {
      const page = await list('limit=1&offset=1');
      expect(page.total).toBe(3);
      expect(page.items).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![1]).toEqual([page.items[0]!.id]);
    } finally {
      spy.mockRestore();
    }
  });
  it.each(['en', 'ru', 'kk'])('uses %s reference labels and stable dictionary list order', async (locale) => {
    const page = await list(`locale=${locale}&sort=commodityTypes`);
    expect(page.items.map((value) => value.id)).toEqual([second.id, first.id, missing.id]);
    expect(page.items[1]!.commodityTypes.map((value) => value.code)).toEqual(['LPS-A1', 'LPS-B1']);
    expect(page.items[1]!.commodityTypes[0]!.names[locale as 'en' | 'ru' | 'kk']).toBe(`${locale} LPS-A1`);
    expect((await list(`locale=${locale}&sort=commodityTypes&direction=desc`)).items.map((value) => value.id)).toEqual([
      first.id,
      second.id,
      missing.id,
    ]);
    expect((await list(`locale=${locale}&sort=regions`)).items.map((value) => value.id)).toEqual([
      second.id,
      first.id,
      missing.id,
    ]);
  });
  it('preserves aligned display groups while omitting absent name keys from lexical sort', async () => {
    await json(
      await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', {
        ...write(first),
        contacts: [first.contacts[1], first.contacts[0]],
      }),
    );
    const middle = await create({
      companyId: missing.company.id,
      scopeDescription: 'Fixture person Z',
      statusId: references.planning,
      contacts: [{ fullName: 'Zulu', roleTitle: null, emails: [], phones: [] }],
    });
    expect((await list('sort=contactNames')).items.map((value) => value.id)).toEqual([
      first.id,
      middle.id,
      second.id,
      missing.id,
    ]);
    expect((await list('sort=contactNames&direction=desc')).items.map((value) => value.id)).toEqual([
      middle.id,
      first.id,
      second.id,
      missing.id,
    ]);
    expect(
      lpsEntryReadSchema.parse(await json(await http.get(`${ROOT}/entries/${first.id}`, 'operator'))).contacts,
    ).toMatchObject([
      { fullName: null, emails: ['general@fixture.local'] },
      { fullName: 'Fixture Person', emails: ['box@fixture.local', 'two@fixture.local'] },
    ]);
  });
  it('sorts regions by the displayed location order, rather than treating reversed lists as ties', async () => {
    await json(
      await http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', {
        ...write(first),
        locations: [...write(first).locations].reverse(),
      }),
    );
    const updated = lpsEntryReadSchema.parse(
      await json(
        await http.send('PUT', `${ROOT}/entries/${second.id}`, 'expert', {
          ...write(second),
          locations: [write(second).locations[0], { city: 'Town A', regionId: references['LPS-R2'] }],
        }),
      ),
    );
    expect(updated.locations.map((row) => row.region!.code)).toEqual(['LPS-R1', 'LPS-R2']);
    const ascending = await list('sort=regions');
    expect(ascending.items.map((row) => row.id)).toEqual([second.id, first.id, missing.id]);
    expect(ascending.items[1]!.locations.map((row) => row.region!.code)).toEqual(['LPS-R2', 'LPS-R1']);
    expect((await list('sort=regions&direction=desc')).items.map((row) => row.id)).toEqual([
      first.id,
      second.id,
      missing.id,
    ]);
  });
  it('retains repeated regions in the location sort key and keeps an entirely unknown list last', async () => {
    const repeated = await create({
      companyId: missing.company.id,
      scopeDescription: 'Repeated location region',
      statusId: references.planning,
      locations: [
        { city: 'One', regionId: references['LPS-R1'] },
        { city: 'Two', regionId: references['LPS-R1'] },
        { city: 'Three', regionId: references['LPS-R2'] },
      ],
    });
    expect((await list('sort=regions')).items.map((row) => row.id)).toEqual([
      second.id,
      repeated.id,
      first.id,
      missing.id,
    ]);
    expect((await list('sort=regions&direction=desc')).items.map((row) => row.id)).toEqual([
      first.id,
      repeated.id,
      second.id,
      missing.id,
    ]);
    expect(repeated.locations.map((row) => row.region!.code)).toEqual(['LPS-R1', 'LPS-R1', 'LPS-R2']);
  });
  it('Unknown means absent resolved facts, explicit zero remains known and empty search is escaped', async () => {
    expect(
      (await list('regionIds=unknown&commodityGroupIds=unknown&countryIds=unknown')).items.map((value) => value.id),
    ).toEqual([missing.id]);
    expect((await list('q=%25')).total).toBe(0);
    expect((await list('q=box%40fixture.local')).total).toBe(0);
    expect((await list('q=Fixture%20Person')).items.map((value) => value.id)).toEqual([first.id]);
    expect((await list('lastUpdatedFrom=2026-11-02&lastUpdatedTo=2026-11-02')).items.map((value) => value.id)).toEqual([
      second.id,
    ]);
  });
  it.each(LPS_SORT_COLUMNS)('sorts %s with stable page counts and IDs without multiplying rows', async (sort) => {
    for (const direction of ['asc', 'desc']) {
      const all = await list(`sort=${sort}&direction=${direction}`);
      const firstPage = await list(`sort=${sort}&direction=${direction}&limit=1`),
        nextPage = await list(`sort=${sort}&direction=${direction}&limit=1&offset=1`);
      expect(all.total).toBe(3);
      expect(new Set(all.items.map((value) => value.id)).size).toBe(3);
      expect(firstPage.items[0]!.id).toBe(all.items[0]!.id);
      expect(nextPage.items[0]!.id).toBe(all.items[1]!.id);
      expect(nextPage.items[0]!.rowNumber).toBe(2);
    }
  });
  it('orders launch by earliest/latest quarter and keeps TBD/null last in both directions', async () => {
    const tbd = await create({
      companyId: missing.company.id,
      scopeDescription: 'Fixture TBD',
      statusId: references.planning,
      plannedLaunch: 'TBD',
    });
    const year = await create({
      companyId: missing.company.id,
      scopeDescription: 'Fixture Year',
      statusId: references.planning,
      plannedLaunch: '2027',
    });
    expect((await list('sort=plannedLaunch')).items.map((value) => value.id)).toEqual([
      second.id,
      year.id,
      first.id,
      tbd.id,
      missing.id,
    ]);
    expect((await list('sort=plannedLaunch&direction=desc')).items.map((value) => value.id)).toEqual([
      first.id,
      year.id,
      second.id,
      tbd.id,
      missing.id,
    ]);
    expect((await list('sort=investmentUsd')).items.map((value) => value.id)).toEqual([
      second.id,
      first.id,
      missing.id,
      tbd.id,
      year.id,
    ]);
    expect((await list('sort=investmentUsd&direction=desc')).items.map((value) => value.id)).toEqual([
      first.id,
      second.id,
      missing.id,
      tbd.id,
      year.id,
    ]);
  });
  it('soft deletion retains children/history, excludes records normally, and refuses company deletion with active entries', async () => {
    expect((await http.send('DELETE', `${ROOT}/companies/${first.company.id}`, 'expert')).status).toBe(409);
    expect((await http.send('DELETE', `${ROOT}/entries/${first.id}`, 'expert')).status).toBe(204);
    expect((await http.get(`${ROOT}/entries/${first.id}`, 'operator')).status).toBe(404);
    expect((await dashboard()).totalEntries).toBe(2);
    expect(
      (await pool.query('select count(*)::int count from lps_contact where lps_entry_id=$1', [first.id])).rows[0].count,
    ).toBe(2);
    expect((await http.get(`${ROOT}/entries/${first.id}/history`, 'expert')).status).toBe(404);
    expect((await http.send('DELETE', `${ROOT}/entries/${second.id}`, 'expert')).status).toBe(204);
    expect((await http.send('DELETE', `${ROOT}/companies/${first.company.id}`, 'expert')).status).toBe(204);
    expect((await http.get(`${ROOT}/companies/${first.company.id}`, 'operator')).status).toBe(404);
    expect((await list()).total).toBe(1);
  });
  it.each(['country', 'email', 'phone'] as const)(
    'application SQL cannot move a %s fact out of a logically deleted parent',
    async (kind) => {
      let sourceParent: string, targetParent: string, table: string, parentColumn: string;
      if (kind === 'country') {
        expect((await http.send('DELETE', `${ROOT}/entries/${first.id}`, 'expert')).status).toBe(204);
        expect((await http.send('DELETE', `${ROOT}/entries/${second.id}`, 'expert')).status).toBe(204);
        expect((await http.send('DELETE', `${ROOT}/companies/${first.company.id}`, 'expert')).status).toBe(204);
        sourceParent = first.company.id;
        targetParent = missing.company.id;
        table = 'lps_company_country';
        parentColumn = 'lps_company_id';
      } else {
        const target = lpsEntryReadSchema.parse(
          await json(
            await http.send('PUT', `${ROOT}/entries/${second.id}`, 'expert', {
              ...write(second),
              contacts: [{ fullName: 'Target contact', roleTitle: null, emails: [], phones: [] }],
            }),
          ),
        );
        expect((await http.send('DELETE', `${ROOT}/entries/${first.id}`, 'expert')).status).toBe(204);
        sourceParent = first.contacts[0]!.id;
        targetParent = target.contacts[0]!.id;
        table = kind === 'email' ? 'lps_contact_email' : 'lps_contact_phone';
        parentColumn = 'lps_contact_id';
      }
      const before = (await pool.query(`select * from ${table} where ${parentColumn}=$1 order by 1,2`, [sourceParent]))
        .rows;
      expect(before.length).toBeGreaterThan(0);
      await appSql(async (client) => {
        await expect(
          client.query(`update ${table} set ${parentColumn}=$1 where ${parentColumn}=$2`, [targetParent, sourceParent]),
        ).rejects.toMatchObject({ code: '23514' });
      });
      expect(
        (await pool.query(`select * from ${table} where ${parentColumn}=$1 order by 1,2`, [sourceParent])).rows,
      ).toEqual(before);
      expect((await pool.query(`select * from ${table} where ${parentColumn}=$1`, [targetParent])).rows).toEqual([]);
    },
  );
  it.each(['email', 'phone'] as const)(
    'moving the only %s method cannot leave an active unnamed contact without presence',
    async (kind) => {
      const sourceEntry = await create({
        companyId: missing.company.id,
        scopeDescription: 'Unnamed contact source',
        statusId: references.planning,
        contacts: [
          {
            fullName: null,
            roleTitle: null,
            emails: kind === 'email' ? ['sole@fixture.local'] : [],
            phones: kind === 'phone' ? ['+77010000001'] : [],
          },
        ],
      });
      const targetEntry = await create({
        companyId: missing.company.id,
        scopeDescription: 'Named contact target',
        statusId: references.planning,
        contacts: [{ fullName: 'Named target', roleTitle: null, emails: [], phones: [] }],
      });
      const table = kind === 'email' ? 'lps_contact_email' : 'lps_contact_phone';
      await appSql(async (client) => {
        await expect(
          client.query(`update ${table} set lps_contact_id=$1 where lps_contact_id=$2`, [
            targetEntry.contacts[0]!.id,
            sourceEntry.contacts[0]!.id,
          ]),
        ).rejects.toMatchObject({ code: '23514' });
      });
      const after = lpsEntryReadSchema.parse(await json(await http.get(`${ROOT}/entries/${sourceEntry.id}`, 'expert')));
      expect(after.contacts).toEqual(sourceEntry.contacts);
      expect(
        (await pool.query(`select * from ${table} where lps_contact_id=$1`, [targetEntry.contacts[0]!.id])).rows,
      ).toEqual([]);
    },
  );
  it('DB guards reject physical dependency deletion, duplicate NULL pairs, invalid periods and role app-delete', async () => {
    await expect(pool.query('delete from dictionary_entry where id=$1', [references.KZ])).rejects.toMatchObject({
      code: '23503',
    });
    await expect(pool.query('delete from lps_company where id=$1', [first.company.id])).rejects.toMatchObject({
      code: '23503',
    });
    await expect(
      pool.query('update lps_company set deleted_at=now(),deleted_by=$2 where id=$1', [
        first.company.id,
        accounts.expert,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("update lps_entry set planned_launch='Q4 2028 / Q1 2027' where id=$1", [first.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query('insert into lps_contact(lps_entry_id,full_name) values($1,null)', [first.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query('insert into lps_location(lps_entry_id,city) values($1,$2)', [first.id, 'Only city']);
    await expect(
      pool.query('insert into lps_location(lps_entry_id,city) values($1,$2)', [first.id, 'Only city']),
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(
      "DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lps_draft_app') THEN CREATE ROLE lps_draft_app; END IF; END $$",
    );
    await applyAppRoleGrants(pool, 'lps_draft_app');
    await pool.query(
      `grant select,insert,update on lps_company,lps_entry to lps_draft_app; grant select,insert,update,delete on lps_company_country,lps_entry_commodity,lps_location,lps_contact,lps_contact_email,lps_contact_phone to lps_draft_app`,
    );
    const client = await pool.connect();
    try {
      await client.query('set role lps_draft_app');
      await expect(client.query('delete from lps_entry where id=$1', [first.id])).rejects.toMatchObject({
        code: '42501',
      });
      await expect(client.query('truncate lps_entry cascade')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('reset role');
      client.release();
    }
  });
  it('admin dictionary deletion returns entry_in_use, with no lost LPS reference or history', async () => {
    const dictionaries = new DictionariesService(db, pool, new AuditService(db));
    await expect(dictionaries.remove(context('administrator').actor, 'country', references.KZ!)).rejects.toMatchObject({
      code: 'entry_in_use',
    });
    await expect(
      dictionaries.remove(context('administrator').actor, 'programme', references.LPS!),
    ).rejects.toMatchObject({ code: 'entry_in_use' });
    await expect(
      dictionaries.remove(context('administrator').actor, 'lps_status', references.planning!),
    ).rejects.toMatchObject({ code: 'entry_in_use' });
    expect(lpsEntryReadSchema.parse(await json(await http.get(`${ROOT}/entries/${first.id}`, 'operator')))).toEqual(
      first,
    );
  });
  it('an audit failure rolls the complete entry/child mutation back', async () => {
    const failing = new LpsService(pool, {
      record: async () => {
        throw new Error('Synthetic audit outage');
      },
    } as unknown as AuditService);
    const before = await pool.query('select count(*)::int count from lps_entry');
    await expect(
      failing.createEntry(context(), {
        ...write(first),
        contacts: first.contacts.map(({ id: _, ...value }) => value),
        locations: first.locations.map(({ id: _, city, region }) => ({ city, regionId: region?.id ?? null })),
      }),
    ).rejects.toThrow('Synthetic audit outage');
    expect((await pool.query('select count(*)::int count from lps_entry')).rows).toEqual(before.rows);
    expect((await list()).total).toBe(3);
  });
  it('serializes concurrent company deletion and entry creation in both commit orders', async () => {
    const company = lpsCompanyReadSchema.parse(
      await json(await http.send('POST', `${ROOT}/companies`, 'expert', { name: 'Fixture concurrent empty' })),
    );
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('update lps_company set deleted_at=now(),deleted_by=$2 where id=$1', [
        company.id,
        accounts.expert,
      ]);
      const pending = http.send('POST', `${ROOT}/entries`, 'expert', {
        companyId: company.id,
        scopeDescription: 'Pending creation',
        statusId: references.planning,
      });
      await waitForLock('%pg_advisory_xact_lock(2146711110,0)%');
      await client.query('commit');
      expect((await pending).status).toBe(404);
      const other = lpsCompanyReadSchema.parse(
        await json(await http.send('POST', `${ROOT}/companies`, 'expert', { name: 'Fixture concurrent existing' })),
      );
      await client.query('begin');
      await client.query(
        'insert into lps_entry(lps_company_id,source_type_id,scope_description,status_id,created_by,updated_by) values($1,$2,$3,$4,$5,$5)',
        [other.id, references.LPS, 'Raw committed proposal', references.planning, accounts.expert],
      );
      const deletion = http.send('DELETE', `${ROOT}/companies/${other.id}`, 'expert');
      await waitForLock('%pg_advisory_xact_lock(2146711110,0)%');
      await client.query('commit');
      expect((await deletion).status).toBe(409);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
  it('a logically deleted entry keeps immutable child facts even under direct app SQL', async () => {
    await http.send('DELETE', `${ROOT}/entries/${first.id}`, 'expert');
    await expect(
      pool.query('delete from lps_contact_email where lps_contact_id=$1', [first.contacts[0]!.id]),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query('delete from lps_location where lps_entry_id=$1', [first.id])).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      pool.query('update lps_entry set deleted_at=null,deleted_by=null where id=$1', [first.id]),
    ).rejects.toMatchObject({ code: '23514' });
    expect(
      (
        await pool.query('select email from lps_contact_email where lps_contact_id=$1 order by sort_order', [
          first.contacts[0]!.id,
        ])
      ).rows.map((value) => value.email),
    ).toEqual(first.contacts[0]!.emails);
  });
  it('fresh actor revocation after guard denies under its row lock before any mutation', async () => {
    const blocker = await pool.connect();
    try {
      await blocker.query('begin');
      await blocker.query('update user_accounts set state=$2 where id=$1', [accounts.expert, 'inactive']);
      const pending = http.send('PUT', `${ROOT}/entries/${first.id}`, 'expert', {
        ...write(first),
        comment: 'Must not persist',
      });
      // Wait for the real API transaction to be blocked by this persisted account row.
      await waitForLock('%user_accounts%');
      await blocker.query('commit');
      expect((await pending).status).toBe(403);
      expect((await pool.query('select comment from lps_entry where id=$1', [first.id])).rows[0].comment).toBe(
        first.comment,
      );
    } finally {
      await blocker.query('rollback');
      blocker.release();
      await db.update(s.userAccounts).set({ state: 'active' }).where(eq(s.userAccounts.id, accounts.expert));
    }
  });
});

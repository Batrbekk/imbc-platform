import {
  lpsCompanyListSchema,
  lpsCompanyQuerySchema,
  lpsCompanyWriteSchema,
  lpsDashboardSchema,
  lpsEntryWriteSchema,
  lpsFiltersSchema,
  lpsListSchema,
  lpsQuerySchema,
  lpsUuidSchema,
  type LpsCompanyWrite,
  type LpsEntryWrite,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { actorTransaction, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { auditEntries } from '../../database/schema/index.js';
import type { AuthUser } from '../auth/auth.types.js';
import { escapeLpsLike, lpsDashboardCounts, lpsPageIds } from './lps-query.js';
import { compareLpsReferences, readLpsCompanies, readLpsEntries, readLpsReferences } from './lps-read.js';

const invalidReference = () => new ProblemException(400, 'lps_reference', 'Недопустимое значение справочника');
const childScope = () => new ProblemException(400, 'lps_child_scope', 'Дочерняя запись не принадлежит этой записи LPS');
const companyInUse = () =>
  new ProblemException(409, 'lps_company_in_use', 'Компания используется в активных записях LPS');
type Context = { actor: AuthUser; ip: string | null };
@Injectable()
export class LpsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}
  private run<T>(
    context: Context,
    action: 'lps.read' | 'lps.edit' | 'lps.dashboard',
    route: string,
    run: (tx: Database) => Promise<T>,
  ) {
    return actorTransaction(this.pool, this.audit, context.actor, { action, route, ip: context.ip }, async (tx) => {
      // The dictionary guard is always first: this also prevents metadata changes between page IDs and graph reads.
      await tx.execute(sql`select pg_advisory_xact_lock_shared(2146711107,3)`);
      await tx.execute(
        action === 'lps.edit'
          ? sql`select pg_advisory_xact_lock(2146711110,0)`
          : sql`select pg_advisory_xact_lock_shared(2146711110,0)`,
      );
      return run(tx);
    });
  }
  private async record(
    tx: Database,
    context: Context,
    objectType: 'lps_company' | 'lps_entry',
    id: string,
    before: unknown,
    after: unknown,
    operation: 'create' | 'update' | 'delete',
  ) {
    await this.audit.record(
      {
        userId: context.actor.id,
        organizationId: context.actor.organizationId,
        action: 'lps.edit',
        objectType,
        objectId: id,
        ip: context.ip,
        diff: { operation, before, after },
      },
      tx,
    );
  }
  private async company(tx: Database, id: string, locale = 'kk') {
    const result = (await readLpsCompanies(tx, [id], locale)).get(id);
    if (!result) throw notFound();
    return result;
  }
  private async entry(tx: Database, id: string, locale = 'kk') {
    const result = (await readLpsEntries(tx, [id], locale)).get(id);
    if (!result) throw notFound();
    return result;
  }
  /** Selected and prior reference IDs are batched. Retired values are retainable only in the same field. */
  private async choices(tx: Database, requested: { id: string; dictionary: string; prior: boolean }[]) {
    if (!requested.length) return;
    const all = [...new Set(requested.map((value) => value.id))].sort();
    const rows: {
      id: string;
      code: string;
      dictionary: string;
      retired: Date | null;
      parent: string | null;
      parentDictionary: string | null;
      parentCode: string | null;
    }[] = [];
    for (let index = 0; index < all.length; index += 1000) {
      const result = await tx.execute<(typeof rows)[number]>(sql`
        select de.id,de.code,d.code dictionary,de.retired_at retired,de.parent_entry_id parent,pd.code "parentDictionary",p.code "parentCode"
        from dictionary_entry de join dictionary d on d.id=de.dictionary_id
        left join dictionary_entry p on p.id=de.parent_entry_id left join dictionary pd on pd.id=p.dictionary_id
        where de.id=any(${sql.param(all.slice(index, index + 1000))}::uuid[]) order by de.id for share of de
      `);
      rows.push(...result.rows);
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const input of requested) {
      const row = byId.get(input.id);
      if (!row || row.dictionary !== input.dictionary || (row.retired !== null && !input.prior))
        throw invalidReference();
      if (row.dictionary === 'programme' && !['LC', 'LPS'].includes(row.code)) throw invalidReference();
      if (row.dictionary === 'country' && !/^[A-Z]{2}$/.test(row.code)) throw invalidReference();
      if (
        row.dictionary === 'commodity_type' &&
        (row.parentDictionary !== 'commodity_group' || !['A', 'B', 'C', 'D', 'E'].includes(row.parentCode ?? ''))
      )
        throw invalidReference();
    }
  }
  list(context: Context, rawQuery: unknown) {
    const query = lpsQuerySchema.parse(rawQuery);
    return this.run(context, 'lps.read', '/v1/lps/entries', async (tx) => {
      const page = await lpsPageIds(tx, query);
      const graph = await readLpsEntries(tx, page.ids, query.locale);
      return lpsListSchema.parse({
        total: page.total,
        offset: query.offset,
        limit: query.limit,
        items: page.ids.map((id, index) => ({ ...graph.get(id), rowNumber: query.offset + index + 1 })),
      });
    });
  }
  readEntry(context: Context, rawId: unknown, locale = 'kk') {
    const id = lpsUuidSchema.parse(rawId);
    return this.run(context, 'lps.read', '/v1/lps/entries/:id', (tx) => this.entry(tx, id, locale));
  }
  listCompanies(context: Context, rawQuery: unknown) {
    const query = lpsCompanyQuerySchema.parse(rawQuery);
    return this.run(context, 'lps.read', '/v1/lps/companies', async (tx) => {
      const match = query.q ? sql`and name ilike ${`%${escapeLpsLike(query.q)}%`}` : sql``;
      const total = await tx.execute<{ count: number }>(
        sql`select count(*)::int count from lps_company where deleted_at is null ${match}`,
      );
      const page = await tx.execute<{ id: string }>(
        sql`select id from lps_company where deleted_at is null ${match} order by name,id limit ${query.limit} offset ${query.offset}`,
      );
      const companies = await readLpsCompanies(
        tx,
        page.rows.map((row) => row.id),
        query.locale,
      );
      return lpsCompanyListSchema.parse({
        total: total.rows[0]!.count,
        offset: query.offset,
        limit: query.limit,
        items: page.rows.map((row) => companies.get(row.id)),
      });
    });
  }
  readCompany(context: Context, rawId: unknown, locale = 'kk') {
    const id = lpsUuidSchema.parse(rawId);
    return this.run(context, 'lps.read', '/v1/lps/companies/:id', (tx) => this.company(tx, id, locale));
  }
  dashboard(context: Context, rawQuery: unknown, locale = 'kk') {
    const filters = lpsFiltersSchema.parse(rawQuery);
    return this.run(context, 'lps.dashboard', '/v1/lps/dashboard', async (tx) => {
      const counts = await lpsDashboardCounts(tx, filters);
      const references = await readLpsReferences(
        tx,
        counts.flatMap((row) => (row.id ? [row.id] : [])),
      );
      const buckets = (kind: 'status' | 'region' | 'group') =>
        counts
          .filter((row) => row.kind === kind)
          .map((row) => ({ reference: row.id ? references.get(row.id)! : null, count: row.count }))
          .sort((a, b) =>
            a.reference === null
              ? 1
              : b.reference === null
                ? -1
                : compareLpsReferences(locale)(a.reference, b.reference),
          );
      return lpsDashboardSchema.parse({
        totalEntries: counts.find((row) => row.kind === 'total')!.count,
        totalCompanies: counts.find((row) => row.kind === 'company')!.count,
        statuses: buckets('status'),
        regions: buckets('region'),
        commodityGroups: buckets('group').map(({ reference, count }) => {
          if (!reference) return { reference: null, count };
          const { parent: _, ...base } = reference;
          return { reference: base, count };
        }),
      });
    });
  }
  createCompany(context: Context, raw: unknown) {
    const input = lpsCompanyWriteSchema.parse(raw);
    return this.run(context, 'lps.edit', '/v1/lps/companies', async (tx) => {
      await this.choices(
        tx,
        input.countryIds.map((id) => ({ id, dictionary: 'country', prior: false })),
      );
      const result = await tx.execute<{ id: string }>(
        sql`insert into lps_company(name,created_by,updated_by) values(${input.name},${context.actor.id},${context.actor.id}) returning id`,
      );
      const id = result.rows[0]!.id;
      await this.saveCountries(tx, id, input);
      const after = await this.company(tx, id);
      await this.record(tx, context, 'lps_company', id, null, after, 'create');
      return after;
    });
  }
  updateCompany(context: Context, rawId: unknown, raw: unknown) {
    const id = lpsUuidSchema.parse(rawId),
      input = lpsCompanyWriteSchema.parse(raw);
    return this.run(context, 'lps.edit', '/v1/lps/companies/:id', async (tx) => {
      await tx.execute(sql`select id from lps_company where id=${id} for update`);
      const before = await this.company(tx, id);
      const affected = await tx.execute<{ id: string }>(
        sql`select id from lps_entry where lps_company_id=${id} and deleted_at is null order by id for update`,
      );
      const beforeEntries = await readLpsEntries(
        tx,
        affected.rows.map((row) => row.id),
        'kk',
      );
      await this.choices(
        tx,
        input.countryIds.map((countryId) => ({
          id: countryId,
          dictionary: 'country',
          prior: before.countries.some((value) => value.id === countryId),
        })),
      );
      const now = new Date().toISOString();
      await tx.execute(
        sql`update lps_company set name=${input.name},updated_by=${context.actor.id},updated_at=${now}::timestamptz where id=${id}`,
      );
      await this.saveCountries(tx, id, input);
      await tx.execute(
        sql`update lps_entry set updated_by=${context.actor.id},updated_at=${now}::timestamptz where lps_company_id=${id} and deleted_at is null`,
      );
      const after = await this.company(tx, id);
      await this.record(tx, context, 'lps_company', id, before, after, 'update');
      const afterEntries = await readLpsEntries(
        tx,
        affected.rows.map((row) => row.id),
        'kk',
      );
      for (let index = 0; index < affected.rows.length; index += 1000)
        await tx.insert(auditEntries).values(
          affected.rows.slice(index, index + 1000).map((row) => ({
            userId: context.actor.id,
            organizationId: context.actor.organizationId,
            action: 'lps.edit',
            objectType: 'lps_entry',
            objectId: row.id,
            ip: context.ip,
            diff: { operation: 'update', before: beforeEntries.get(row.id), after: afterEntries.get(row.id) },
          })),
        );
      return after;
    });
  }
  private async saveCountries(tx: Database, id: string, input: LpsCompanyWrite) {
    await tx.execute(sql`delete from lps_company_country where lps_company_id=${id}`);
    if (input.countryIds.length)
      await tx.execute(
        sql`insert into lps_company_country(lps_company_id,country_id) select ${id}::uuid,unnest(${sql.param(input.countryIds)}::uuid[])`,
      );
  }
  deleteCompany(context: Context, rawId: unknown) {
    const id = lpsUuidSchema.parse(rawId);
    return this.run(context, 'lps.edit', '/v1/lps/companies/:id', async (tx) => {
      await tx.execute(sql`select id from lps_company where id=${id} for update`);
      const before = await this.company(tx, id);
      const active = await tx.execute(
        sql`select id from lps_entry where lps_company_id=${id} and deleted_at is null limit 1`,
      );
      if (active.rows.length) throw companyInUse();
      const now = new Date().toISOString();
      await tx.execute(
        sql`update lps_company set deleted_at=${now}::timestamptz,deleted_by=${context.actor.id},updated_at=${now}::timestamptz,updated_by=${context.actor.id} where id=${id}`,
      );
      await this.record(
        tx,
        context,
        'lps_company',
        id,
        before,
        { ...before, deletedAt: now, deletedBy: context.actor.id, updatedAt: now, updatedBy: context.actor.id },
        'delete',
      );
    });
  }
  createEntry(context: Context, raw: unknown) {
    const input = lpsEntryWriteSchema.parse(raw);
    return this.run(context, 'lps.edit', '/v1/lps/entries', async (tx) => {
      await tx.execute(sql`select id from lps_company where id=${input.companyId} for update`);
      await this.company(tx, input.companyId);
      let sourceTypeId = input.sourceTypeId;
      if (!sourceTypeId) {
        const defaultType = await tx.execute<{ id: string }>(
          sql`select de.id from dictionary_entry de join dictionary d on d.id=de.dictionary_id where d.code='programme' and de.code='LPS' and de.retired_at is null`,
        );
        sourceTypeId = defaultType.rows[0]?.id;
        if (!sourceTypeId) throw new ProblemException(503, 'lps_default_unavailable', 'Справочник LPS ещё не настроен');
      }
      await this.entryChoices(tx, input, sourceTypeId, null);
      if (input.locations.some((value) => value.id) || input.contacts.some((value) => value.id)) throw childScope();
      const result = await tx.execute<{
        id: string;
      }>(sql`insert into lps_entry(lps_company_id,source_type_id,scope_description,status_id,planned_launch,comment,investment_usd,new_jobs,last_updated_on,created_by,updated_by)
        values(${input.companyId},${sourceTypeId},${input.scopeDescription},${input.statusId},${input.plannedLaunch},${input.comment},${input.investmentUsd}::numeric,${input.newJobs},${input.lastUpdatedOn}::date,${context.actor.id},${context.actor.id}) returning id`);
      const id = result.rows[0]!.id;
      await this.saveChildren(tx, id, input);
      const after = await this.entry(tx, id);
      await this.record(tx, context, 'lps_entry', id, null, after, 'create');
      return after;
    });
  }
  updateEntry(context: Context, rawId: unknown, raw: unknown) {
    const id = lpsUuidSchema.parse(rawId),
      input = lpsEntryWriteSchema.parse(raw);
    return this.run(context, 'lps.edit', '/v1/lps/entries/:id', async (tx) => {
      // Advisory serialization makes the initial company-ID lookup stable; parent locks precede entry locks.
      const old = await tx.execute<{ companyId: string }>(
        sql`select lps_company_id "companyId" from lps_entry where id=${id} and deleted_at is null`,
      );
      if (!old.rows[0]) throw notFound();
      await tx.execute(
        sql`select id from lps_company where id=any(${sql.param([old.rows[0].companyId, input.companyId].sort())}::uuid[]) order by id for update`,
      );
      await this.company(tx, input.companyId);
      await tx.execute(sql`select id from lps_entry where id=${id} for update`);
      const before = await this.entry(tx, id),
        sourceTypeId = input.sourceTypeId ?? before.sourceType.id;
      await this.entryChoices(tx, input, sourceTypeId, before);
      const ownedLocations = new Set(before.locations.map((value) => value.id)),
        ownedContacts = new Set(before.contacts.map((value) => value.id));
      if (
        input.locations.some((value) => value.id && !ownedLocations.has(value.id)) ||
        input.contacts.some((value) => value.id && !ownedContacts.has(value.id))
      )
        throw childScope();
      await tx.execute(
        sql`update lps_entry set lps_company_id=${input.companyId},source_type_id=${sourceTypeId},scope_description=${input.scopeDescription},status_id=${input.statusId},planned_launch=${input.plannedLaunch},comment=${input.comment},investment_usd=${input.investmentUsd}::numeric,new_jobs=${input.newJobs},last_updated_on=${input.lastUpdatedOn}::date,updated_at=clock_timestamp(),updated_by=${context.actor.id} where id=${id}`,
      );
      await this.saveChildren(tx, id, input);
      const after = await this.entry(tx, id);
      await this.record(tx, context, 'lps_entry', id, before, after, 'update');
      return after;
    });
  }
  private async entryChoices(
    tx: Database,
    input: LpsEntryWrite,
    sourceTypeId: string,
    before: Awaited<ReturnType<LpsService['entry']>> | null,
  ) {
    const choices = [
      { id: sourceTypeId, dictionary: 'programme', prior: sourceTypeId === before?.sourceType.id },
      { id: input.statusId, dictionary: 'lps_status', prior: input.statusId === before?.status.id },
      ...input.commodityTypeIds.map((id) => ({
        id,
        dictionary: 'commodity_type',
        prior: before?.commodityTypes.some((value) => value.id === id) ?? false,
      })),
      ...input.locations.flatMap((location) =>
        location.regionId
          ? [
              {
                id: location.regionId,
                dictionary: 'region',
                prior:
                  before?.locations.some(
                    (value) => value.id === location.id && value.region?.id === location.regionId,
                  ) ?? false,
              },
            ]
          : [],
      ),
    ];
    await this.choices(tx, choices);
  }
  private async saveChildren(tx: Database, entryId: string, input: LpsEntryWrite) {
    await tx.execute(sql`delete from lps_entry_commodity where lps_entry_id=${entryId}`);
    if (input.commodityTypeIds.length)
      await tx.execute(
        sql`insert into lps_entry_commodity(lps_entry_id,commodity_type_id) select ${entryId}::uuid,unnest(${sql.param(input.commodityTypeIds)}::uuid[])`,
      );
    // Preserve confirmed child identities, while replacing their ordered business values atomically.
    await tx.execute(sql`delete from lps_location where lps_entry_id=${entryId}`);
    for (let index = 0; index < input.locations.length; index += 1000) {
      const locations = input.locations.slice(index, index + 1000);
      await tx.execute(sql`insert into lps_location(id,lps_entry_id,city,region_id,sort_order)
        select coalesce(id,uuidv7()),${entryId}::uuid,city,region,ordinality+${index}-1
        from unnest(${sql.param(locations.map((value) => value.id))}::uuid[],${sql.param(locations.map((value) => value.city))}::text[],${sql.param(locations.map((value) => value.regionId))}::uuid[])
        with ordinality v(id,city,region,ordinality)`);
    }
    await tx.execute(
      sql`delete from lps_contact_email where lps_contact_id in(select id from lps_contact where lps_entry_id=${entryId})`,
    );
    await tx.execute(
      sql`delete from lps_contact_phone where lps_contact_id in(select id from lps_contact where lps_entry_id=${entryId})`,
    );
    await tx.execute(sql`delete from lps_contact where lps_entry_id=${entryId}`);
    const contactIds = new Map<number, string>();
    for (let index = 0; index < input.contacts.length; index += 1000) {
      const contacts = input.contacts.slice(index, index + 1000);
      const result = await tx.execute<{
        id: string;
        order: number;
      }>(sql`insert into lps_contact(id,lps_entry_id,full_name,role_title,sort_order)
        select coalesce(id,uuidv7()),${entryId}::uuid,name,title,ordinality+${index}-1
        from unnest(${sql.param(contacts.map((value) => value.id))}::uuid[],${sql.param(contacts.map((value) => value.fullName))}::text[],${sql.param(contacts.map((value) => value.roleTitle))}::text[])
        with ordinality v(id,name,title,ordinality) returning id,sort_order "order"`);
      result.rows.forEach((row) => contactIds.set(row.order, row.id));
    }
    for (const field of ['emails', 'phones'] as const) {
      const methods = input.contacts.flatMap((contact, index) =>
        contact[field].map((value, order) => ({ id: contactIds.get(index)!, value, order })),
      );
      for (let index = 0; index < methods.length; index += 1000) {
        const batch = methods.slice(index, index + 1000);
        const table = field === 'emails' ? sql`lps_contact_email` : sql`lps_contact_phone`;
        const column = field === 'emails' ? sql`email` : sql`phone`;
        await tx.execute(sql`insert into ${table}(lps_contact_id,${column},sort_order)
          select id,value,position from unnest(${sql.param(batch.map((value) => value.id))}::uuid[],${sql.param(batch.map((value) => value.value))}::text[],${sql.param(batch.map((value) => value.order))}::int[]) v(id,value,position)`);
      }
    }
  }
  deleteEntry(context: Context, rawId: unknown) {
    const id = lpsUuidSchema.parse(rawId);
    return this.run(context, 'lps.edit', '/v1/lps/entries/:id', async (tx) => {
      const raw = await tx.execute<{ companyId: string }>(
        sql`select lps_company_id "companyId" from lps_entry where id=${id} and deleted_at is null`,
      );
      if (!raw.rows[0]) throw notFound();
      await tx.execute(sql`select id from lps_company where id=${raw.rows[0].companyId} for update`);
      await tx.execute(sql`select id from lps_entry where id=${id} for update`);
      const before = await this.entry(tx, id),
        now = new Date().toISOString();
      await tx.execute(
        sql`update lps_entry set deleted_at=${now}::timestamptz,deleted_by=${context.actor.id},updated_at=${now}::timestamptz,updated_by=${context.actor.id} where id=${id}`,
      );
      await this.record(
        tx,
        context,
        'lps_entry',
        id,
        before,
        { ...before, deletedAt: now, deletedBy: context.actor.id, updatedAt: now, updatedBy: context.actor.id },
        'delete',
      );
    });
  }
}

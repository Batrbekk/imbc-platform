import { createHash } from 'node:crypto';
import {
  imbcNoteCreateSchema, imbcNoteUpdateSchema, imbcEngagementPutSchema, imbcProductContextPutSchema,
  imbcRecordIdempotencyKeySchema, imbcNoteListSchema, imbcRecordListQuerySchema,
  imbcRecordHistoryQuerySchema, imbcRecordHistorySchema, imbcRecordReadSchema,
  imbcRecordProductOptionsSchema, imbcRecordDictionaryCodeSchema, imbcRecordReferenceOptionsSchema, imbcRecordReferenceOptionsQuerySchema,
  imbcRecordContextProductsQuerySchema, imbcRecordContextProductsSchema,
  type ImbcRecordKind, type ImbcRecordRead,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { isUuid } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { uniqueViolation } from '../../database/pg-errors.js';
import type { AuthUser } from '../auth/auth.types.js';
import { profileCandidateRevisionSql } from '../profiles/profile-candidate.js';
import { runRecordsAction, recordsNotFound, type ImbcRecordsScope } from './imbc-records-scope.js';
import { readSnapshot, recordView, recordClock, replaceSnapshot, type NativeSnapshot, type NativeRow, type RecordsMutationHook } from './imbc-records-store.js';

const conflict = () => new ProblemException(409, 'conflict', 'Запись изменилась. Перечитайте её перед сохранением.');
const referenceInvalid = () => new ProblemException(400, 'reference_invalid', 'Недопустимое значение справочника.');
const routeFor = (kind: ImbcRecordKind) => kind === 'note' ? '/v1/profiles/:profileId/imbc-notes' : kind === 'engagement'
  ? '/v1/profiles/:profileId/imbc-engagement' : '/v1/profiles/:profileId/products/:productIdentityId/imbc-context';

@Injectable()
export class ImbcRecordsService {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool, private readonly audit: AuditService) {}
  /** Explicit test-only fault boundary; never resolves business data through a test service. */
  protected async mutationHook(_phase: Parameters<RecordsMutationHook>[0], _tx: Database): Promise<void> {}
  private run<T>(actor: AuthUser, profileId: string, kind: ImbcRecordKind, edit: boolean, ip: string | null,
    work: (tx: Database, scope: ImbcRecordsScope) => Promise<T>, route=routeFor(kind)) {
    return runRecordsAction(this.pool, this.audit, actor, { profileId, route, edit, ip }, work);
  }
  async productOptions(actor: AuthUser, profileId: string, query: unknown, ip: string | null = null) {
    return this.run(actor, profileId, 'product_context', false, ip, async (tx, scope) => {
      const page = parseOrThrow(imbcRecordListQuerySchema, query);
      const payload=(await tx.execute<{sectionRevisionId:string|null;items:unknown[];total:number}>(sql`
        with selected as (select r.id from profile_section s join section_revision r on r.id=${profileCandidateRevisionSql('s')}
          and r.profile_section_id=s.id and r.organization_id=s.organization_id
          where s.profile_id=${scope.profileId} and s.organization_id=${scope.organizationId} and s.kind='products'),
        products as (select p.identity_id,p.name_en,p.name_ru,p.position_in_list from product_line p
          join selected selected_revision on selected_revision.id=p.section_revision_id
          join product_line_identity i on i.id=p.identity_id and i.organization_id=p.organization_id and i.profile_id=${scope.profileId}
          where p.organization_id=${scope.organizationId}),
        page as (select * from products order by position_in_list,identity_id limit ${page.limit} offset ${page.offset})
        select (select id from selected) as "sectionRevisionId",(select count(*)::int from products) as total,
          coalesce((select jsonb_agg(jsonb_build_object('productLineIdentityId',identity_id,'nameEn',name_en,'nameRu',name_ru)
            order by position_in_list,identity_id) from page),'[]'::jsonb) as items`)).rows[0]!;
      return parseResponse(imbcRecordProductOptionsSchema, { profileId: scope.profileId, organizationId: scope.organizationId,
        ...payload, ...page }, 'продукты для записей IMBC');
    }, '/v1/profiles/:profileId/imbc-records/product-options');
  }
  async referenceOptions(actor: AuthUser, profileId: string, code: string, query: unknown, ip: string | null = null) {
    return this.run(actor, profileId, 'product_context', false, ip, async (tx) => {
      const checked=imbcRecordDictionaryCodeSchema.safeParse(code); if(!checked.success)throw recordsNotFound();
      const parsed=parseOrThrow(imbcRecordReferenceOptionsQuerySchema,query);
      const ids='ids' in parsed?parsed.ids.map(id=>id.toLowerCase()):null;
      const page=ids?{offset:0,limit:ids.length}:parsed as {offset:number;limit:number};
      const payload=(await tx.execute<{items:unknown[];total:number}>(sql`
        with entries as (select e.id,e.code,e.sort_order,jsonb_build_object('en',en.name,'ru',ru.name,'kk',kk.name) as names,
          imbc_records_utc6(e.retired_at) as retired_at from dictionary_entry e join dictionary d on d.id=e.dictionary_id
          left join dictionary_entry_translation en on en.dictionary_entry_id=e.id and en.language='en'
          left join dictionary_entry_translation ru on ru.dictionary_entry_id=e.id and ru.language='ru'
          left join dictionary_entry_translation kk on kk.dictionary_entry_id=e.id and kk.language='kk'
          where d.code=${checked.data} ${ids?sql`and e.id=any(${sql.param(ids)}::uuid[])`:sql``}),
        page as (select * from entries order by sort_order,code,id limit ${page.limit} offset ${page.offset})
        select (select count(*)::int from entries) as total,
          coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'names',names,'retiredAt',retired_at)
            order by sort_order,code,id) from page),'[]'::jsonb) as items`)).rows[0]!;
      if(ids && payload.total!==ids.length)throw recordsNotFound();
      return parseResponse(imbcRecordReferenceOptionsSchema,{dictionaryCode:checked.data,...payload,...page},'справочники записей IMBC');
    }, '/v1/profiles/:profileId/imbc-records/reference-options/:dictionaryCode');
  }
  async contextProducts(actor: AuthUser, profileId: string, query: unknown, ip: string | null = null) {
    return this.run(actor,profileId,'product_context',false,ip,async(tx,scope)=>{
      const parsed=parseOrThrow(imbcRecordContextProductsQuerySchema,query),ids='ids' in parsed?parsed.ids.map(id=>id.toLowerCase()):null;
      const page=ids?{offset:0,limit:ids.length}:parsed as {offset:number;limit:number};
      const payload=(await tx.execute<{items:unknown[];total:number}>(sql`
        with selected as (select r.id from profile_section s join section_revision r on r.id=${profileCandidateRevisionSql('s')}
          and r.profile_section_id=s.id and r.organization_id=s.organization_id
          where s.profile_id=${scope.profileId} and s.organization_id=${scope.organizationId} and s.kind='products'),
        records as (select c.* from imbc_product_context c join product_line_identity i on i.id=c.product_line_identity_id
          and i.profile_id=c.profile_id and i.organization_id=c.organization_id
          where c.profile_id=${scope.profileId} and c.organization_id=${scope.organizationId}
            ${ids?sql`and c.product_line_identity_id=any(${sql.param(ids)}::uuid[])`:sql``}),
        page as (select * from records order by created_at,product_line_identity_id limit ${page.limit} offset ${page.offset})
        select (select count(*)::int from records) as total,coalesce((select jsonb_agg(jsonb_build_object(
          'context',imbc_records_view('product_context',jsonb_build_object('row',to_jsonb(c),'sources','[]'::jsonb,'eoiEvents','[]'::jsonb)),
          'product',jsonb_build_object('productLineIdentityId',c.product_line_identity_id,'nameEn',p.name_en,'nameRu',p.name_ru,
            'sectionRevisionId',p.section_revision_id,'isCurrent',coalesce(p.section_revision_id=(select id from selected),false)))
          order by c.created_at,c.product_line_identity_id) from page c left join lateral(
            select p.name_en,p.name_ru,p.section_revision_id from product_line p
            join section_revision r on r.id=p.section_revision_id and r.organization_id=p.organization_id
            join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id and s.kind='products'
            where p.identity_id=c.product_line_identity_id and p.organization_id=c.organization_id and s.profile_id=c.profile_id
            order by case when r.id=(select id from selected) then 0 else 1 end,r.revision_number desc,p.id desc limit 1
          ) p on true),'[]'::jsonb) as items`)).rows[0]!;
      if(ids && payload.total!==ids.length)throw recordsNotFound();
      return parseResponse(imbcRecordContextProductsSchema,{profileId:scope.profileId,organizationId:scope.organizationId,...payload,...page},'исторические контексты продуктов IMBC');
    },'/v1/profiles/:profileId/imbc-records/context-products');
  }
  async listNotes(actor: AuthUser, profileId: string, query: unknown, ip: string | null = null) {
    return this.run(actor, profileId, 'note', false, ip, async (tx, scope) => {
      const page = parseOrThrow(imbcRecordListQuerySchema, query);
      const total = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from imbc_note where profile_id=${scope.profileId} and organization_id=${scope.organizationId}`)).rows[0]!.n;
      const rows = (await tx.execute<{ view: unknown }>(sql`select imbc_records_view('note',imbc_records_snapshot('note',id,profile_id,organization_id)) as view
        from imbc_note where profile_id=${scope.profileId} and organization_id=${scope.organizationId} order by created_at desc,id desc limit ${page.limit} offset ${page.offset}`)).rows;
      return parseResponse(imbcNoteListSchema, { ...scope, canEdit: actor.role === 'expert', items: rows.map(r => r.view), total, ...page }, 'заметки IMBC');
    });
  }
  async read(actor: AuthUser, profileId: string, kind: ImbcRecordKind, recordId: string, ip: string | null = null) {
    return this.run(actor, profileId, kind, false, ip, async (tx, scope) => {
      if (!isUuid(recordId)) throw recordsNotFound();
      if (kind === 'product_context') await this.product(tx, scope, recordId);
      const snapshot = await readSnapshot(tx, scope, kind, recordId.toLowerCase());
      if (!snapshot && kind === 'note') throw recordsNotFound();
      return snapshot ? recordView(tx, kind, snapshot) : null;
    },kind==='note'?routeFor(kind)+'/:recordId':routeFor(kind));
  }
  async createNote(actor: AuthUser, profileId: string, body: unknown, key: unknown, ip: string | null = null) {
    return this.run(actor, profileId, 'note', true, ip, async (tx, scope) => {
      const input = parseOrThrow(imbcNoteCreateSchema, body), idempotencyKey = parseOrThrow(imbcRecordIdempotencyKeySchema, key).toLowerCase();
      const fingerprint = this.fingerprint('note', scope.profileId, null, input);
      const replay = await this.replay(tx, actor, scope, 'note', null, idempotencyKey, fingerprint);
      if (replay) return replay;
      const id = (await tx.execute<{ id: string }>(sql`select uuidv7()::text as id`)).rows[0]!.id;
      const at = await recordClock(tx, null);
      const after: NativeSnapshot = { row: { id, profile_id: scope.profileId, organization_id: scope.organizationId,
        author_id: actor.id, kind: 'general', body: input.body, created_at: at, updated_at: at, source: 'expert' }, sources: [], eoiEvents: [] };
      return this.replace(tx, actor, scope, 'note', id, null, after, idempotencyKey, fingerprint, ip);
    });
  }
  async updateNote(actor: AuthUser, profileId: string, recordId: string, body: unknown, key: unknown, ip: string | null = null) {
    return this.run(actor, profileId, 'note', true, ip, async (tx, scope) => {
      if (!isUuid(recordId)) throw recordsNotFound();
      const id = recordId.toLowerCase(), input = parseOrThrow(imbcNoteUpdateSchema, body);
      const idempotencyKey = parseOrThrow(imbcRecordIdempotencyKeySchema, key).toLowerCase();
      const fingerprint = this.fingerprint('note', scope.profileId, id, input);
      const replay = await this.replay(tx, actor, scope, 'note', id, idempotencyKey, fingerprint);
      if (replay) return replay;
      const before = await readSnapshot(tx, scope, 'note', id);
      if (!before) throw recordsNotFound();
      await this.cas(tx, before, input.expectedUpdatedAt);
      const after = { ...before, row: { ...before.row, body: input.body, updated_at: await recordClock(tx, before) } };
      return this.replace(tx, actor, scope, 'note', id, before, after, idempotencyKey, fingerprint, ip);
    },routeFor('note')+'/:recordId');
  }
  async putEngagement(actor: AuthUser, profileId: string, body: unknown, key: unknown, ip: string | null = null) {
    return this.run(actor, profileId, 'engagement', true, ip, async (tx, scope) => {
      const parsed = parseOrThrow(imbcEngagementPutSchema, body);
      const input = { ...parsed, sourceEntryIds: parsed.sourceEntryIds.map(id => id.toLowerCase()).sort(),
        eoiEvents: parsed.eoiEvents.map(e => ({ ...e, id: e.id.toLowerCase() })).sort((a,b) => a.id.localeCompare(b.id)) };
      const idempotencyKey = parseOrThrow(imbcRecordIdempotencyKeySchema, key).toLowerCase();
      const fingerprint = this.fingerprint('engagement', scope.profileId, scope.profileId, input);
      const replay = await this.replay(tx, actor, scope, 'engagement', scope.profileId, idempotencyKey, fingerprint);
      if (replay) return replay;
      const before = await readSnapshot(tx, scope, 'engagement', scope.profileId);
      await this.cas(tx, before, input.expectedUpdatedAt);
      await this.dictionary(tx, 'acquisition_source', input.sourceEntryIds, before?.sources.map(s => s.source_entry_id!) ?? []);
      const old = new Map(before?.eoiEvents.map(e => [e.id,e]) ?? []);
      if ([...old.keys()].some(id => !input.eoiEvents.some(e => e.id === id)))
        throw new ProblemException(400, 'history_retained', 'Исторические EOI-даты сохраняются. Исправьте дату в существующей записи.');
      const newIds=input.eoiEvents.filter(e=>!old.has(e.id)).map(e=>e.id);
      if(newIds.length && (await tx.execute(sql`select 1 from imbc_eoi_email_event where id=any(${sql.param(newIds)}::uuid[]) order by id for share`)).rows.length) throw recordsNotFound();
      const at = await recordClock(tx, before);
      const row: NativeRow = { ...(before?.row ?? { profile_id: scope.profileId, organization_id: scope.organizationId,
        recorded_by: actor.id, created_at: at, source: 'expert' }), updated_at: at,
        receipt_confirmed: input.receiptConfirmed, response: input.response, response_summary: input.responseSummary,
        ready_for_site_visit: input.readyForSiteVisit, added_to_imbc_year: input.addedToImbcYear, folder_url: input.folderUrl } as NativeRow;
      const events = input.eoiEvents.map(e => {
        const previous = old.get(e.id);
        return previous ? { ...previous, sent_on: e.sentOn, updated_at: previous.sent_on === e.sentOn ? previous.updated_at : at }
          : { id: e.id, profile_id: scope.profileId, organization_id: scope.organizationId, sent_on: e.sentOn,
            recorded_by: actor.id, created_at: at, updated_at: at, source: 'expert' as const };
      });
      const after: NativeSnapshot = { row, sources: input.sourceEntryIds.map(id => ({ profile_id: scope.profileId,
        organization_id: scope.organizationId, source_entry_id: id })), eoiEvents: events };
      return this.replace(tx, actor, scope, 'engagement', scope.profileId, before, after, idempotencyKey, fingerprint, ip);
    });
  }
  async putProductContext(actor: AuthUser, profileId: string, recordId: string, body: unknown, key: unknown, ip: string | null = null) {
    return this.run(actor, profileId, 'product_context', true, ip, async (tx, scope) => {
      if (!isUuid(recordId)) throw recordsNotFound();
      const id = recordId.toLowerCase(), parsed = parseOrThrow(imbcProductContextPutSchema, body);
      const input = { ...parsed, programmeId: parsed.programmeId?.toLowerCase() ?? null, priorityId: parsed.priorityId?.toLowerCase() ?? null };
      const idempotencyKey = parseOrThrow(imbcRecordIdempotencyKeySchema, key).toLowerCase();
      await this.product(tx, scope, id);
      const fingerprint = this.fingerprint('product_context', scope.profileId, id, input);
      const replay = await this.replay(tx, actor, scope, 'product_context', id, idempotencyKey, fingerprint);
      if (replay) return replay;
      const before = await readSnapshot(tx, scope, 'product_context', id);
      await this.cas(tx, before, input.expectedUpdatedAt);
      if(before===null)await this.productMeaning(tx,scope,id);
      await this.dictionary(tx, 'programme', input.programmeId ? [input.programmeId] : [], before?.row.programme_id ? [before.row.programme_id as string] : []);
      await this.dictionary(tx, 'imbc_priority', input.priorityId ? [input.priorityId] : [], before?.row.priority_id ? [before.row.priority_id as string] : []);
      const at = await recordClock(tx, before);
      const after: NativeSnapshot = { row: { ...(before?.row ?? { product_line_identity_id: id, profile_id: scope.profileId,
        organization_id: scope.organizationId, recorded_by: actor.id, created_at: at, source: 'expert' }), updated_at: at,
        programme_id: input.programmeId, priority_id: input.priorityId } as NativeRow, sources: [], eoiEvents: [] };
      return this.replace(tx, actor, scope, 'product_context', id, before, after, idempotencyKey, fingerprint, ip);
    });
  }
  async history(actor: AuthUser, profileId: string, kind: ImbcRecordKind, recordId: string, query: unknown, ip: string | null = null) {
    return this.run(actor, profileId, kind, false, ip, async (tx, scope) => {
      if (!isUuid(recordId)) throw recordsNotFound();
      const id = recordId.toLowerCase(), page = parseOrThrow(imbcRecordHistoryQuerySchema, query);
      if (kind === 'product_context') await this.product(tx, scope, id);
      if (!(await readSnapshot(tx, scope, kind, id))) throw recordsNotFound();
      if (page.beforeId && !(await tx.execute(sql`select 1 from imbc_records_operation where id=${page.beforeId}
        and record_kind=${kind} and record_id=${id} and profile_id=${scope.profileId} and organization_id=${scope.organizationId}`)).rows.length) throw recordsNotFound();
      const rows = (await tx.execute<{ id: string; at: string; action: string; actorId: string; actorName: string | null; before: unknown; after: unknown }>(sql`
        select op.id,imbc_records_utc6(a.at) as at,op.action,op.actor_id as "actorId",actor.full_name as "actorName",
          a.diff->'beforeView' as before,a.diff->'afterView' as after from imbc_records_operation op
        join audit_entries a on a.id=op.audit_entry_id left join user_accounts actor on actor.id=op.actor_id
        where op.record_kind=${kind} and op.record_id=${id} and op.profile_id=${scope.profileId} and op.organization_id=${scope.organizationId}
        ${page.beforeId ? sql`and (a.at,op.id)<(select ea.at,eo.id from imbc_records_operation eo join audit_entries ea on ea.id=eo.audit_entry_id where eo.id=${page.beforeId})` : sql``}
        order by a.at desc,op.id desc limit ${page.limit+1}`)).rows;
      return parseResponse(imbcRecordHistorySchema, { items: rows.slice(0,page.limit), nextCursor: rows.length>page.limit ? rows[page.limit-1]!.id : null }, 'история IMBC');
    },routeFor(kind)+(kind==='note'?'/:recordId/history':'/history'));
  }
  private fingerprint(kind: ImbcRecordKind, profile: string, id: string | null, input: unknown) {
    return createHash('sha256').update(JSON.stringify({ kind, profile, id, input })).digest('hex');
  }
  private async replay(tx: Database, actor: AuthUser, scope: ImbcRecordsScope, kind: ImbcRecordKind, id: string | null, key: string, fingerprint: string): Promise<ImbcRecordRead | null> {
    const row = (await tx.execute<{ kind: string; recordId: string; profileId: string; organizationId: string; fingerprint: string; view: unknown }>(sql`
      select op.record_kind as kind,op.record_id as "recordId",op.profile_id as "profileId",op.organization_id as "organizationId",
      op.request_fingerprint as fingerprint,a.diff->'afterView' as view from imbc_records_operation op join audit_entries a on a.id=op.audit_entry_id
      where op.actor_id=${actor.id} and op.idempotency_key=${key}`)).rows[0];
    if (!row) return null;
    if (row.kind!==kind || (id!==null && row.recordId!==id) || row.profileId!==scope.profileId || row.organizationId!==scope.organizationId || row.fingerprint!==fingerprint) throw conflict();
    return parseResponse(imbcRecordReadSchema, row.view, 'повтор операции IMBC');
  }
  private async cas(tx: Database, before: NativeSnapshot | null, expected: string | null) {
    if (!before) { if (expected!==null) throw conflict(); return; }
    if (expected===null || !(await tx.execute<{ matches: boolean }>(sql`select ${before.row.updated_at}::timestamptz=${expected}::timestamptz as matches`)).rows[0]!.matches) throw conflict();
  }
  private async product(tx: Database, scope: ImbcRecordsScope, id: string) {
    const row = (await tx.execute(sql`select 1 from product_line_identity where id=${id} and profile_id=${scope.profileId} and organization_id=${scope.organizationId} for share`)).rows[0];
    if (!row) throw recordsNotFound();
  }
  /** A reserved identity is not yet a product. Retained canonical rows establish the historical association. */
  private async productMeaning(tx: Database, scope: ImbcRecordsScope, id: string) {
    const row=(await tx.execute(sql`select 1 from product_line p join section_revision r
      on r.id=p.section_revision_id and r.organization_id=p.organization_id
      join profile_section s on s.id=r.profile_section_id and s.organization_id=r.organization_id and s.kind='products'
      where p.identity_id=${id} and p.organization_id=${scope.organizationId} and s.profile_id=${scope.profileId}
      for share of p,r,s`)).rows[0];
    if(!row)throw recordsNotFound();
  }
  private async dictionary(tx: Database, code: string, ids: string[], retained: string[]) {
    if (!ids.length) return;
    const rows = (await tx.execute<{ id: string; code: string; retired: boolean }>(sql`select e.id,d.code,e.retired_at is not null as retired
      from dictionary_entry e join dictionary d on d.id=e.dictionary_id where e.id=any(${sql.param(ids)}::uuid[]) order by e.id for share of e`)).rows;
    if (rows.length!==ids.length || rows.some(r => r.code!==code || r.retired && !retained.includes(r.id))) throw referenceInvalid();
  }
  private async replace(tx: Database, actor: AuthUser, scope: ImbcRecordsScope, kind: ImbcRecordKind, id: string,
    before: NativeSnapshot | null, after: NativeSnapshot, idempotencyKey: string, requestFingerprint: string, ip: string | null) {
    try { return await replaceSnapshot(tx, { scope, kind, id, actorId: actor.id, ip, before, after, idempotencyKey, requestFingerprint,
      hook: (phase, current) => this.mutationHook(phase, current) }); }
    catch (error) {
      if (uniqueViolation(error)) throw conflict();
      throw error;
    }
  }
}

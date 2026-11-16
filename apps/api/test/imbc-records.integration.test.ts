import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ROLES, imbcRecordHistorySchema, referenceFileSchema, type Role, type ImbcNoteRead, type ImbcEngagementRead, type ImbcProductContextRead } from '@imbc/contracts';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import { loadReferenceFile } from '../src/database/reference-data.js';
import { applyImbcRecordsGrants } from '../src/database/imbc-records-grants.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { withQueueTransaction } from '../src/database/transaction.js';
import type { AuthUser } from '../src/modules/auth/auth.types.js';
import { ImbcRecordsService } from '../src/modules/imbc-records/imbc-records.service.js';
import { ImbcNotesController, ImbcEngagementController, ImbcProductContextController, ImbcRecordsOptionsController } from '../src/modules/imbc-records/imbc-records.controller.js';
import { normalizeSnapshot, readSnapshot, recordClock, recordView } from '../src/modules/imbc-records/imbc-records-store.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { startHttp, type HttpStand } from './support/http.js';
import { ORGANIZATION_TYPE } from './support/organization-type.js';
import { seedProfileGraph, type ProfileGraph } from './support/profile-graph.js';

/** Real PG restricted role + real controllers/guard/filter. Session cookie fixture is explicit, not real OIDC. */
describe.skipIf(!process.env.TEST_DATABASE_URL)('IMBC canonical historical records: restricted PG and HTTP', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool, appPool: pg.Pool, db: Database, records: ImbcRecordsService, expert: AuthUser, other: AuthUser;
  let g: ProfileGraph, second: ProfileGraph;
  const actors = {} as Record<Role,AuthUser>, stands: HttpStand[] = [];
  const roleName = 'imbc_records_' + randomUUID().replaceAll('-',''), rolePassword = randomUUID();
  let sourceA: string, sourceB: string, priority: string, programme: string, roleCreated=false;
  const route = () => `/api/v1/profiles/${g.profile}/imbc-notes`;
  const engagementPath = () => `/api/v1/profiles/${g.profile}/imbc-engagement`;
  const product = () => String(g.rows.product_line!.identity_id);
  const contextPath = () => `/api/v1/profiles/${g.profile}/products/${product()}/imbc-context`;
  const base = { receiptConfirmed:null,response:null,responseSummary:null,readyForSiteVisit:null,addedToImbcYear:null,
    folderUrl:null,sourceEntryIds:[] as string[],eoiEvents:[] as {id:string;sentOn:string}[],expectedUpdatedAt:null as string|null };
  const request = (http: HttpStand,path: string,role: Role,payload: unknown,key: string|undefined,method='PUT') => fetch(http.base+path,{
    method,headers:{origin:'https://imbc.example.kz','content-type':'application/json',cookie:`imbc-session=${role}`,
      ...(key?{'idempotency-key':key}:{})},body:JSON.stringify(payload),
  });
  const stand = async (actor: AuthUser) => {
    const h=await startHttp({controllers:[ImbcNotesController,ImbcEngagementController,ImbcProductContextController,ImbcRecordsOptionsController],
      providers:[{provide:ImbcRecordsService,useValue:records}],organizationId:actor.organizationId,accountIds:{[actor.role]:actor.id}});
    stands.push(h);return h;
  };
  const counts = async () => (await pool.query(`select
    (select count(*)::int from imbc_note) as notes,(select count(*)::int from imbc_engagement) as engagement,
    (select count(*)::int from imbc_records_operation) as operations,
    (select count(*)::int from audit_entries where action like 'imbc_note.%' or action like 'imbc_engagement.%' or action like 'imbc_product_context.%') as audits,
    (select count(*)::int from imbc_records_operation_child) as children`)).rows[0];
  beforeAll(async () => {
    if (!['55433','55434','55435'].includes(new URL(process.env.TEST_DATABASE_URL!).port)) throw new Error('IMBC records suite requires an explicitly isolated local PG port');
    pool=openTestPool();await resetDatabase(pool);await migrateThrough(pool,'0030_survey_notice_delivery');
    const baseline=await seedProfileGraph(pool);
    const legacyRow=(await pool.query('insert into imbc_notes(profile_id,text,legacy) values($1,$2,$3::jsonb) returning id,text,legacy',
      [baseline.profile,'Historical fixture note',JSON.stringify({unresolvedSource:'fixture_only',unapprovedPriority:'7'})])).rows[0];
    const baselineFiles=(await pool.query('select count(*)::int n from file_version')).rows[0].n;
    await migrateThrough(pool);
    expect((await pool.query('select id,text,legacy from imbc_notes where id=$1',[legacyRow.id])).rows[0]).toEqual(legacyRow);
    expect((await pool.query('select count(*)::int n from file_version')).rows[0].n).toBe(baselineFiles);
    expect((await pool.query('select count(*)::int n from imbc_note')).rows[0].n).toBe(0);
    db=drizzle(pool,{schema,casing:'snake_case'});
    await loadReferenceFile(db,referenceFileSchema.parse(JSON.parse(readFileSync(new URL('../reference-data/release/imbc_priority.json',import.meta.url),'utf8'))),'release');
    expect((await pool.query("select count(*)::int n from dictionary_entry e join dictionary d on d.id=e.dictionary_id where d.code='acquisition_source'")).rows[0].n).toBe(0);
    expect((await pool.query("select array_agg(e.code order by e.code) codes from dictionary_entry e join dictionary d on d.id=e.dictionary_id where d.code='imbc_priority'")).rows[0].codes).toEqual(['1','2','3','4','5','6']);
    const imbc=(await db.select().from(schema.organizations).where(eq(schema.organizations.type,'imbc')))[0]!;
    for (const role of ROLES) {
      const o=ORGANIZATION_TYPE[role]==='imbc'?imbc:(await db.insert(schema.organizations).values({name:`Fixture ${role}`,type:ORGANIZATION_TYPE[role]}).returning())[0]!;
      const a=(await db.insert(schema.userAccounts).values({organizationId:o.id,role,state:'active',email:`${randomUUID()}@records.local`,fullName:`Fixture ${role}`}).returning())[0]!;
      actors[role]={id:a.id,organizationId:o.id,organizationType:o.type,role,email:a.email,fullName:a.fullName,locale:'en'};
    }
    expert=actors.expert;
    const a=(await db.insert(schema.userAccounts).values({organizationId:imbc.id,role:'expert',state:'active',email:`${randomUUID()}@records.local`,fullName:'Other SME'}).returning())[0]!;
    other={...expert,id:a.id,email:a.email,fullName:a.fullName};
    g=baseline;second=await seedProfileGraph(pool);
    const entry=async(code:string,value:string)=>{
      const d=(await pool.query('select id from dictionary where code=$1',[code])).rows[0];
      return (await pool.query('insert into dictionary_entry(dictionary_id,code) values($1,$2) returning id',[d.id,value])).rows[0].id as string;
    };
    // Synthetic dictionary entries are local test fixtures, never production-approved acquisition aliases.
    priority=(await pool.query("select e.id from dictionary_entry e join dictionary d on d.id=e.dictionary_id where d.code='imbc_priority' and e.code='1'")).rows[0].id;
    programme=await entry('programme','LC');
    await pool.query(`create role ${pg.escapeIdentifier(roleName)} login password ${pg.escapeLiteral(rolePassword)}`);
    roleCreated=true;await applyAppRoleGrants(pool,roleName);
    const client=await pool.connect();try{await client.query('begin');await applyImbcRecordsGrants(client,roleName);await client.query('commit');}finally{client.release();}
    const u=new URL(process.env.TEST_DATABASE_URL!);u.username=roleName;u.password=rolePassword;
    appPool=new pg.Pool({connectionString:u.toString(),max:8});
    records=new ImbcRecordsService(appPool,new AuditService(drizzle(appPool,{schema,casing:'snake_case'})));
    const emptyStand=await stand(expert);
    const empty=await emptyStand.get(`/api/v1/profiles/${g.profile}/imbc-records/reference-options/acquisition_source`,'expert');
    expect(empty.status).toBe(200);expect(await empty.json()).toEqual({dictionaryCode:'acquisition_source',items:[],total:0,offset:0,limit:50});
    sourceA=await entry('acquisition_source','fixture_A');sourceB=await entry('acquisition_source','fixture_B');
  });
  afterAll(async()=>{
    for(const h of stands)await h.close();if(appPool)await appPool.end();
    if(pool){if(roleCreated)await pool.query(`drop owned by ${pg.escapeIdentifier(roleName)}; drop role ${pg.escapeIdentifier(roleName)}`);await pool.end();}
  });
  it('creates, replays and edits notes with exact UTC6 author/history; all6 roles honor ClassC',async()=>{
    const http=await stand(expert),key=randomUUID();
    const response=await request(http,route(),'expert',{body:'Internal record'},key,'POST');expect(response.status).toBe(201);
    const row=await response.json() as ImbcNoteRead;expect(row.authorId).toBe(expert.id);expect(row.createdAt).toMatch(/\.\d{6}Z$/);expect(row.createdAt).toBe(row.updatedAt);
    const replay=await request(http,route(),'expert',{body:'Internal record'},key,'POST');expect(await replay.json()).toEqual(row);
    expect((await request(http,route(),'expert',{body:'Different intent'},key,'POST')).status).toBe(409);
    expect((await request(http,route(),'expert',{body:'Invalid',kind:'legacy_ranking'},randomUUID(),'POST')).status).toBe(400);
    expect((await request(http,route(),'expert',{body:'No key'},undefined,'POST')).status).toBe(400);
    const changed=await request(http,`${route()}/${row.id}`,'expert',{body:'Revised',expectedUpdatedAt:row.updatedAt},randomUUID());
    expect(changed.status).toBe(200);const edited=await changed.json() as ImbcNoteRead;
    expect(edited.authorId).toBe(row.authorId);expect(edited.createdAt).toBe(row.createdAt);expect(edited.updatedAt>row.updatedAt).toBe(true);
    const history=await http.get(`${route()}/${row.id}/history`,'expert');const payload=imbcRecordHistorySchema.parse(await history.json());
    expect(payload.items).toHaveLength(2);expect(payload.items[0]!.before).toEqual(row);expect(payload.items[0]!.after).toEqual(edited);
    expect(payload.items[0]!.actorId).toBe(expert.id);
    for(const role of ROLES){const h=await stand(actors[role]);const status=(await h.get(route(),role)).status;
      expect(status).toBe(['expert','director'].includes(role)?200:403);
      if(role!=='expert')expect((await request(h,route(),role,{body:'denied'},randomUUID(),'POST')).status).toBe(403);}
    expect((await http.get(`/api/v1/profiles/${second.profile}/imbc-notes/${row.id}`,'expert')).status).toBe(404);
    expect((await http.get(`${route()}/${row.id}/history?beforeId=${randomUUID()}`,'expert')).status).toBe(404);
  });
  it('records nullable outreach history, exact normalized source sets and date corrections without email/LPS/survey',async()=>{
    const http=await stand(expert),event=randomUUID();
    expect((await http.get(engagementPath(),'expert')).status).toBe(200);
    const created=await request(http,engagementPath(),'expert',{...base,sourceEntryIds:[sourceB,sourceA],eoiEvents:[{id:event,sentOn:'2020-02-29'}]},randomUUID());
    expect(created.status).toBe(200);const row=await created.json() as ImbcEngagementRead;
    expect(row.receiptConfirmed).toBe(null);expect(row.readyForSiteVisit).toBe(null);expect(row.sourceEntryIds).toEqual([sourceA,sourceB].sort());
    const input={...base,receiptConfirmed:false,readyForSiteVisit:true,addedToImbcYear:2018,folderUrl:'https://sharepoint.example.local/folder',
      sourceEntryIds:[sourceB],eoiEvents:[{id:event,sentOn:'2020-03-01'},{id:randomUUID(),sentOn:'2020-04-01'}],expectedUpdatedAt:row.updatedAt};
    const updated=await request(http,engagementPath(),'expert',input,randomUUID());expect(updated.status).toBe(200);
    const after=await updated.json() as ImbcEngagementRead,old=after.eoiEvents.find(e=>e.id===event)!;
    expect(old.createdAt).toBe(row.eoiEvents[0]!.createdAt);expect(old.recordedBy).toBe(row.eoiEvents[0]!.recordedBy);expect(old.updatedAt).toBe(after.updatedAt);
    expect(after.receiptConfirmed).toBe(false);expect(after.recordedBy).toBe(row.recordedBy);expect(after.createdAt).toBe(row.createdAt);
    const history=await (await http.get(engagementPath()+'/history','director')).json() as {code:string};
    // This stand has no director account override; persisted role/type protection refuses forged cookies.
    expect(history.code).toBe('forbidden');
    const director=await stand(actors.director),h=imbcRecordHistorySchema.parse(await (await director.get(engagementPath()+'/history','director')).json());
    expect(h.items[0]!.before).toEqual(row);expect(h.items[0]!.after).toEqual(after);
    expect((await pool.query('select count(*)::int n from imbc_records_operation_child where operation_id=$1',[h.items[0]!.id])).rows[0].n).toBe(6);
    expect((await request(http,engagementPath(),'expert',{...input,eoiEvents:[],expectedUpdatedAt:after.updatedAt},randomUUID())).status).toBe(400);
    const untouched=await pool.query(`select (select count(*)::int from site_survey_record) surveys,
      (select count(*)::int from lps_entry) lps,(select count(*)::int from site_survey_notice_outbox) notices,(select count(*)::int from notification) emails`);
    expect(untouched.rows[0]).toEqual({surveys:0,lps:0,notices:0,emails:0});
  });
  it('validates product tenant/dictionary references; retains retired references and historical pins',async()=>{
    const http=await stand(expert),body={programmeId:programme,priorityId:priority,expectedUpdatedAt:null};
    const create=await request(http,contextPath(),'expert',body,randomUUID());expect(create.status).toBe(200);
    const row=await create.json() as ImbcProductContextRead;
    expect(row.productLineIdentityId).toBe(product());
    const wrong=`/api/v1/profiles/${g.profile}/products/${String(second.rows.product_line!.identity_id)}/imbc-context`;
    expect((await request(http,wrong,'expert',body,randomUUID())).status).toBe(404);
    expect((await request(http,contextPath(),'expert',{...body,programmeId:sourceA,expectedUpdatedAt:row.updatedAt},randomUUID())).status).toBe(400);
    await pool.query('update dictionary_entry set retired_at=clock_timestamp() where id=$1',[programme]);
    const retained=await request(http,contextPath(),'expert',{...body,expectedUpdatedAt:row.updatedAt},randomUUID());expect(retained.status).toBe(200);
    const another=`/api/v1/profiles/${second.profile}/products/${String(second.rows.product_line!.identity_id)}/imbc-context`;
    expect((await request(http,another,'expert',body,randomUUID())).status).toBe(400);
    await expect(pool.query('delete from dictionary_entry where id=$1',[programme])).rejects.toMatchObject({code:'23503'});
    const h=imbcRecordHistorySchema.parse(await (await http.get(contextPath()+'/history','expert')).json());expect(h.items[0]!.before).toEqual(row);
    await pool.query('update dictionary_entry set retired_at=null where id=$1',[programme]);
  });
  it('refuses new orphan product context in HTTP/native SQL and audits malformed profile scope',async()=>{
    const orphan=(await pool.query('insert into product_line_identity(profile_id,organization_id) values($1,$2) returning id',[g.profile,g.org])).rows[0].id;
    const http=await stand(expert),body={programmeId:null,priorityId:null,expectedUpdatedAt:null};
    expect((await request(http,`/api/v1/profiles/${g.profile}/products/${orphan}/imbc-context`,'expert',body,randomUUID())).status).toBe(404);
    const countsBefore=await counts();
    await expect(withQueueTransaction(appPool,async tx=>{
      const at=await recordClock(tx,null),after=await normalizeSnapshot(tx,'product_context',{row:{product_line_identity_id:orphan,
        profile_id:g.profile,organization_id:g.org,programme_id:null,priority_id:null,recorded_by:expert.id,source:'expert',created_at:at,updated_at:at},sources:[],eoiEvents:[]});
      const operationId=randomUUID(),fingerprint='c'.repeat(64),diff={operationId,actor:{type:'user',id:expert.id},before:null,after,
        beforeView:null,afterView:await recordView(tx,'product_context',after),requestFingerprint:fingerprint};
      const a=(await tx.execute<{id:string}>(sql`insert into audit_entries(at,user_id,organization_id,action,object_type,object_id,outcome,diff)
        values(${after.row.updated_at}::timestamptz,${expert.id},${g.org},'imbc_product_context.created','imbc_product_context',${orphan},'ok',${JSON.stringify(diff)}::jsonb) returning id`)).rows[0]!.id;
      await tx.execute(sql`insert into imbc_records_operation(id,record_kind,record_id,profile_id,organization_id,actor_id,action,idempotency_key,request_fingerprint,audit_entry_id,after_record_hash)
        values(${operationId},'product_context',${orphan},${g.profile},${g.org},${expert.id},'imbc_product_context.created',${randomUUID()},${fingerprint},${a},'derive')`);
    })).rejects.toMatchObject({cause:{code:'23514'}});
    expect(await counts()).toEqual(countsBefore);
    const denied=(await pool.query("select count(*)::int n from audit_entries where outcome='denied'")).rows[0].n;
    expect((await http.get('/api/v1/profiles/not-a-uuid/imbc-notes','expert')).status).toBe(404);
    expect((await pool.query("select count(*)::int n from audit_entries where outcome='denied'")).rows[0].n).toBe(denied+1);
  });
  it('two SME CAS races have one winner; identical key races return one immutable receipt',async()=>{
    const key=randomUUID(),before=await counts();
    const replies=await Promise.all([records.createNote(expert,g.profile,{body:'parallel identical'},key),records.createNote(expert,g.profile,{body:'parallel identical'},key)]);
    expect(replies[0]).toEqual(replies[1]);const after=await counts();expect(after.notes-before.notes).toBe(1);expect(after.operations-before.operations).toBe(1);
    const row=replies[0] as ImbcNoteRead;
    const changed=await Promise.allSettled([records.updateNote(expert,g.profile,row.id,{body:'A',expectedUpdatedAt:row.updatedAt},randomUUID()),
      records.updateNote(other,g.profile,row.id,{body:'B',expectedUpdatedAt:row.updatedAt},randomUUID())]);
    expect(changed.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const rejected=changed.find(r=>r.status==='rejected') as PromiseRejectedResult;expect(rejected.reason.getStatus()).toBe(409);
    const h=await records.history(expert,g.profile,'note',row.id,{});expect(h.items).toHaveLength(2);
  });
  it('aggregate source/date races never mix winners; exact idempotent PUT receipts survive later edits',async()=>{
    const before=await records.read(expert,g.profile,'engagement',g.profile) as ImbcEngagementRead;
    const eventIntents=before.eoiEvents.map(e=>({id:e.id,sentOn:e.sentOn}));
    const left={...base,sourceEntryIds:[sourceA],eoiEvents:eventIntents,responseSummary:'Left',expectedUpdatedAt:before.updatedAt};
    const right={...base,sourceEntryIds:[sourceB],eoiEvents:eventIntents,responseSummary:'Right',expectedUpdatedAt:before.updatedAt};
    const key=randomUUID(),results=await Promise.allSettled([records.putEngagement(expert,g.profile,left,key),records.putEngagement(other,g.profile,right,randomUUID())]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    const winner=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<ImbcEngagementRead>).value;
    const live=await records.read(expert,g.profile,'engagement',g.profile) as ImbcEngagementRead;
    expect(live).toEqual(winner);expect(live.sourceEntryIds).toEqual([live.responseSummary==='Left'?sourceA:sourceB]);
    const count=await counts();
    if(results[0]!.status==='fulfilled')expect(await records.putEngagement(expert,g.profile,left,key)).toEqual(winner);
    expect(await counts()).toEqual(count);
    const swapped=live.eoiEvents.map((e,i)=>({id:e.id,sentOn:live.eoiEvents[1-i]!.sentOn}));
    const changed=await records.putEngagement(expert,g.profile,{...base,sourceEntryIds:live.sourceEntryIds,eoiEvents:swapped,
      expectedUpdatedAt:live.updatedAt},randomUUID()) as ImbcEngagementRead;
    for(const event of changed.eoiEvents){const old=live.eoiEvents.find(e=>e.id===event.id)!;expect(event.createdAt).toBe(old.createdAt);expect(event.recordedBy).toBe(old.recordedBy);expect(event.updatedAt).toBe(changed.updatedAt);}
    const history=await records.history(expert,g.profile,'engagement',g.profile,{limit:1});
    expect(history.items[0]!.before).toEqual(live);expect(history.items[0]!.after).toEqual(changed);expect(history.nextCursor).not.toBeNull();
    const next=await records.history(expert,g.profile,'engagement',g.profile,{beforeId:history.nextCursor!,limit:1});expect(next.items[0]!.after).toEqual(live);
  });
  it('new foreign EOI IDs and retired selections are opaque/rejected; removed current source retains normalized history FK',async()=>{
    const foreign=randomUUID();await records.putEngagement(expert,second.profile,{...base,eoiEvents:[{id:foreign,sentOn:'2019-01-01'}]},randomUUID());
    const live=await records.read(expert,g.profile,'engagement',g.profile) as ImbcEngagementRead;
    const intents=live.eoiEvents.map(e=>({id:e.id,sentOn:e.sentOn}));
    await expect(records.putEngagement(expert,g.profile,{...base,eoiEvents:[...intents,{id:foreign,sentOn:'2019-02-01'}],expectedUpdatedAt:live.updatedAt},randomUUID())).rejects.toMatchObject({code:'not_found'});
    const removed=await records.putEngagement(expert,g.profile,{...base,eoiEvents:intents,expectedUpdatedAt:live.updatedAt},randomUUID()) as ImbcEngagementRead;
    await pool.query('update dictionary_entry set retired_at=clock_timestamp() where id=$1',[sourceA]);
    await expect(records.putEngagement(expert,g.profile,{...base,sourceEntryIds:[sourceA],eoiEvents:intents,expectedUpdatedAt:removed.updatedAt},randomUUID())).rejects.toMatchObject({code:'reference_invalid'});
    await expect(pool.query('delete from dictionary_entry where id=$1',[sourceA])).rejects.toMatchObject({code:'23503'});
    await expect(pool.query('delete from imbc_eoi_email_event where id=$1',[intents[0]!.id])).rejects.toMatchObject({code:'23514'});
    await expect(appPool.query('insert into imbc_engagement_source(profile_id,organization_id,source_entry_id) values($1,$2,$3)',[g.profile,g.org,sourceB])).rejects.toMatchObject({code:'23514'});
    await pool.query('update dictionary_entry set retired_at=null where id=$1',[sourceA]);
  });
  it('fresh persisted role/state/org/class policy defeat the cached HTTP guard and audit denials',async()=>{
    const http=await stand(expert);
    const before=(await pool.query("select count(*)::int n from audit_entries where outcome='denied'")).rows[0].n;
    await pool.query("update user_accounts set state='blocked' where id=$1",[expert.id]);
    expect((await http.get(route(),'expert')).status).toBe(403);
    await pool.query("update user_accounts set state='active',role='director' where id=$1",[expert.id]);
    expect((await request(http,route(),'expert',{body:'forged role'},randomUUID(),'POST')).status).toBe(403);
    await pool.query("update user_accounts set role='expert',organization_id=$2 where id=$1",[expert.id,actors.operator.organizationId]);
    expect((await http.get(route(),'expert')).status).toBe(403);
    await pool.query("update user_accounts set organization_id=$2 where id=$1",[expert.id,other.organizationId]);
    await pool.query("update policy_rule set effect='deny' where role='expert' and action='imbc_records.edit' and data_class='c_imbc'");
    expect((await request(http,route(),'expert',{body:'persisted deny'},randomUUID(),'POST')).status).toBe(403);
    await pool.query("update policy_rule set effect='allow' where role='expert' and action='imbc_records.edit' and data_class='c_imbc'");
    await pool.query("update policy_rule set data_class='a_register' where role='expert' and action='imbc_records.read' and data_class='c_imbc'");
    expect((await http.get(route(),'expert')).status).toBe(403);
    await pool.query("update policy_rule set data_class='c_imbc',condition='own_organisation' where role='expert' and action='imbc_records.read' and data_class='a_register'");
    expect((await http.get(route(),'expert')).status).toBe(403);
    await pool.query("update policy_rule set condition='none' where role='expert' and action='imbc_records.read' and data_class='c_imbc'");
    expect((await pool.query("select count(*)::int n from audit_entries where outcome='denied'")).rows[0].n-before).toBeGreaterThanOrEqual(4);
  });
  it('restricted raw DML, audit/seal rewrite and orphan COMMIT are rejected; complete mutation rollback leaves no residue',async()=>{
    const row=await records.createNote(expert,g.profile,{body:'tamper candidate'},randomUUID()) as ImbcNoteRead;
    await expect(appPool.query('update imbc_note set body=$1 where id=$2',['unsealed',row.id])).rejects.toMatchObject({code:'23514'});
    await expect(appPool.query('delete from imbc_note where id=$1',[row.id])).rejects.toMatchObject({code:'42501'});
    await expect(appPool.query('truncate imbc_note')).rejects.toMatchObject({code:'42501'});
    await expect(appPool.query('update imbc_records_operation set after_record_hash=$1',['fake'])).rejects.toMatchObject({code:'42501'});
    await expect(appPool.query('update audit_entries set outcome=$1',['failed'])).rejects.toMatchObject({code:'42501'});
    const beforeCounts=await counts();
    await expect(withQueueTransaction(appPool,async tx=>{
      const scope={profileId:g.profile,organizationId:g.org,organizationName:'Fixture'},snapshot=await readSnapshot(tx,scope,'note',row.id);
      const after=await normalizeSnapshot(tx,'note',{...snapshot!,row:{...snapshot!.row,body:'not written',updated_at:await recordClock(tx,snapshot)}});
      const operationId=randomUUID(),fingerprint='a'.repeat(64),diff={operationId,actor:{type:'user',id:expert.id},before:snapshot,after,
        beforeView:await recordView(tx,'note',snapshot!),afterView:await recordView(tx,'note',after),requestFingerprint:fingerprint};
      const audit=(await tx.execute<{id:string}>(sql`insert into audit_entries(at,user_id,organization_id,action,object_type,object_id,outcome,diff)
        values(${after.row.updated_at}::timestamptz,${expert.id},${g.org},'imbc_note.updated','imbc_note',${row.id},'ok',${JSON.stringify(diff)}::jsonb) returning id`)).rows[0]!.id;
      await tx.execute(sql`insert into imbc_records_operation(id,record_kind,record_id,profile_id,organization_id,actor_id,action,idempotency_key,
        request_fingerprint,audit_entry_id,after_record_hash) values(${operationId},'note',${row.id},${g.profile},${g.org},${expert.id},'imbc_note.updated',${randomUUID()},${fingerprint},${audit},'derive')`);
      // Deliberately omit the exact final row. The deferred COMMIT guard must fail.
    })).rejects.toBeTruthy();
    expect(await counts()).toEqual(beforeCounts);
    const hook=vi.spyOn(records as unknown as {mutationHook:(phase:string,tx:Database)=>Promise<void>},'mutationHook').mockImplementation(async phase=>{if(phase==='children_written')throw new Error('deliberate rollback');});
    await expect(records.createNote(expert,g.profile,{body:'rolled back'},randomUUID())).rejects.toThrow('deliberate rollback');hook.mockRestore();
    expect(await counts()).toEqual(beforeCounts);
    expect((await records.read(expert,g.profile,'note',row.id) as ImbcNoteRead).body).toBe(row.body);
  });
  it('native SQL rejects altered author/kind/creation, wrong audit actor and old transaction',async()=>{
    const row=await records.createNote(expert,g.profile,{body:'SQL invariant candidate'},randomUUID()) as ImbcNoteRead;
    const countsBefore=await counts();
    const seal=async(patch:Record<string,unknown>,actorId=expert.id,transactionId:string|null=null,kind='note',write=false)=>withQueueTransaction(appPool,async tx=>{
      const scope={profileId:g.profile,organizationId:g.org,organizationName:'Fixture'},id=kind==='note'?row.id:g.profile;
      const snapshot=await readSnapshot(tx,scope,kind as 'note'|'engagement',id),after=await normalizeSnapshot(tx,kind as 'note'|'engagement',{
        ...snapshot!,row:{...snapshot!.row,updated_at:await recordClock(tx,snapshot),...patch},
      });
      const beforeView=(await tx.execute<{view:unknown}>(sql`select imbc_records_view(${kind},${JSON.stringify(snapshot)}::jsonb) as view`)).rows[0]!.view;
      const afterView=(await tx.execute<{view:unknown}>(sql`select imbc_records_view(${kind},${JSON.stringify(after)}::jsonb) as view`)).rows[0]!.view;
      const operationId=randomUUID(),fingerprint='b'.repeat(64),action=`imbc_${kind}.updated`,diff={operationId,actor:{type:'user',id:expert.id},before:snapshot,after,
        beforeView,afterView,requestFingerprint:fingerprint};
      const audit=(await tx.execute<{id:string}>(sql`insert into audit_entries(at,user_id,organization_id,action,object_type,object_id,outcome,diff)
        values(${after.row.updated_at}::timestamptz,${expert.id},${g.org},${action},${'imbc_'+kind},${id},'ok',${JSON.stringify(diff)}::jsonb) returning id`)).rows[0]!.id;
      await tx.execute(sql`insert into imbc_records_operation(id,record_kind,record_id,profile_id,organization_id,actor_id,action,idempotency_key,
        request_fingerprint,audit_entry_id,after_record_hash,transaction_id) values(${operationId},${kind},${id},${g.profile},${g.org},${actorId},${action},${randomUUID()},${fingerprint},${audit},'derive',
        ${transactionId===null?sql`pg_current_xact_id()::text`:sql`${transactionId}`})`);
      if(write){
        await tx.execute(sql`select set_config('imbc.records_operation_id',${operationId},true)`);
        if(kind==='note')await tx.execute(sql`update imbc_note set body=${after.row.body}::text,updated_at=${after.row.updated_at}::timestamptz where id=${row.id}`);
        else await tx.execute(sql`update imbc_engagement set folder_url=${after.row.folder_url}::text,updated_at=${after.row.updated_at}::timestamptz where profile_id=${g.profile}`);
      }
      // Missing final DML is separately enforced at COMMIT; the cases below must fail before it.
    });
    for(const patch of [{author_id:other.id},{kind:'legacy_ranking'},{source:'migration'},{created_at:'2010-01-01T00:00:00.000000Z'}]){
      await expect(seal(patch)).rejects.toMatchObject({cause:{code:'23514'}});
    }
    await expect(seal({},other.id)).rejects.toMatchObject({cause:{code:'23514'}});
    await expect(seal({},expert.id,'0')).rejects.toMatchObject({cause:{code:'23514'}});
    await expect(seal({profile_id:second.profile})).rejects.toMatchObject({cause:{code:'23514'}});
    for(const blank of ['\t','\n','\u00a0\ufeff'])await expect(seal({body:blank},expert.id,null,'note',true)).rejects.toMatchObject({cause:{code:'23514'}});
    for(const link of ['https://user:pass@example.local/folder','https://','https://example.local:65536/folder'])
      await expect(seal({folder_url:link},expert.id,null,'engagement',true)).rejects.toMatchObject({cause:{code:'23514'}});
    const http=await stand(expert),live=await records.read(expert,g.profile,'engagement',g.profile) as ImbcEngagementRead;
    expect((await request(http,engagementPath(),'expert',{...base,eoiEvents:live.eoiEvents.map(e=>({id:e.id,sentOn:e.sentOn})),folderUrl:'https://',expectedUpdatedAt:live.updatedAt},randomUUID())).status).toBe(400);
    expect(await counts()).toEqual(countsBefore);
  });
  it('bounded profile lock contention returns busy without write/audit residue',async()=>{
    const blocker=await pool.connect(),before=await counts();await blocker.query('begin');
    try{
      await blocker.query('select 1 from manufacturer_profile where id=$1 for no key update',[g.profile]);
      await expect(records.createNote(other,g.profile,{body:'busy'},randomUUID())).rejects.toMatchObject({code:'busy'});
      expect(await counts()).toEqual(before);
    }finally{await blocker.query('rollback');blocker.release();}
  });
  it('HTTP stores canonical ordinary IPv6/IDN folder hrefs; SQL and immutable history read the exact value',async()=>{
    const http=await stand(expert);
    for(const [input,expected] of [
      ['HTTPS://Example.local:443','https://example.local/'],
      ['https://[2001:0db8:0:0:0:0:0:1]:443/folder','https://[2001:db8::1]/folder'],
      ['https://[::ffff:192.0.2.128]/folder','https://[::ffff:c000:280]/folder'],
      ['https://пример.рф/папка','https://xn--e1afmkfd.xn--p1ai/%D0%BF%D0%B0%D0%BF%D0%BA%D0%B0'],
      ['https://example.local./folder','https://example.local./folder'],
      ['https://K.local/folder','https://k.local/folder'],
      ['https://ſ.local/folder','https://s.local/folder'],
      ['https://example.local/folder?user=person&password=value@safe','https://example.local/folder?user=person&password=value@safe'],
    ]){
      const live=await records.read(expert,g.profile,'engagement',g.profile) as ImbcEngagementRead,key=randomUUID();
      const intent={...base,folderUrl:input,eoiEvents:live.eoiEvents.map(e=>({id:e.id,sentOn:e.sentOn})),expectedUpdatedAt:live.updatedAt};
      const response=await request(http,engagementPath(),'expert',intent,key);expect(response.status).toBe(200);
      const row=await response.json() as ImbcEngagementRead;expect(row.folderUrl).toBe(expected);
      const stored=(await appPool.query('select folder_url,imbc_records_folder_valid(folder_url) as valid from imbc_engagement where profile_id=$1',[g.profile])).rows[0];
      expect(stored).toEqual({folder_url:expected,valid:true});
      expect(await (await request(http,engagementPath(),'expert',intent,key)).json()).toEqual(row);
      const history=imbcRecordHistorySchema.parse(await (await http.get(engagementPath()+'/history','expert')).json());
      expect((history.items[0]!.after as ImbcEngagementRead).folderUrl).toBe(expected);
    }
    for(const input of ['https://[not-ipv6]/folder','https://@example.local/folder','https://exa\nmple.local/folder']){
      const live=await records.read(expert,g.profile,'engagement',g.profile) as ImbcEngagementRead;
      expect((await request(http,engagementPath(),'expert',{...base,folderUrl:input,
        eoiEvents:live.eoiEvents.map(e=>({id:e.id,sentOn:e.sentOn})),expectedUpdatedAt:live.updatedAt},randomUUID())).status).toBe(400);
    }
  });
  it('SME/director options use the exact current internal revision for hidden/unassigned profiles and readable reference lists',async()=>{
    const http=await stand(expert),options=`/api/v1/profiles/${g.profile}/imbc-records`,read=await http.get(options+'/product-options','expert');
    expect(read.status).toBe(200);const old=await read.json() as {sectionRevisionId:string;items:{productLineIdentityId:string;nameEn:string|null;nameRu:string|null}[];total:number};
    expect(old.sectionRevisionId).toBe(g.revisions.products);expect(old.items.map(p=>p.productLineIdentityId)).toEqual([product()]);
    expect((await pool.query('select status,assigned_expert_id from manufacturer_profile where id=$1',[g.profile])).rows[0]).toMatchObject({status:'draft',assigned_expert_id:null});
    expect((await pool.query('select count(*)::int n from catalog_visible where profile_id=$1',[g.profile])).rows[0].n).toBe(0);
    const transition=await pool.connect();try{await transition.query('begin');await transition.query('update profile_section set working_revision_id=null where profile_id=$1',[g.profile]);await transition.query("update section_revision set state='superseded' where organization_id=$1 and state='working'",[g.org]);await transition.query('commit');}finally{transition.release();}
    const fresh=await seedProfileGraph(pool,{profile:g.profile,org:g.org},true);
    await pool.query('update product_line set name_en=$1,name_ru=$2 where id=$3',['Current EN product','Актуальный продукт',fresh.rows.product_line!.id]);
    const changed=await (await http.get(options+'/product-options','expert')).json() as typeof old;
    expect(changed.sectionRevisionId).toBe(fresh.revisions.products);expect(changed.items).toEqual([{productLineIdentityId:fresh.rows.product_line!.identity_id,nameEn:'Current EN product',nameRu:'Актуальный продукт'}]);
    expect(changed.items.map(p=>p.productLineIdentityId)).not.toContain(product());
    await expect(pool.query("update profile_section set working_revision_id=$1 where profile_id=$2 and kind='products'",[second.revisions.products,g.profile])).rejects.toMatchObject({code:'23503'});
    expect((await http.get(options+'/reference-options/imbc_priority','expert')).status).toBe(200);
    const refs=await (await http.get(options+'/reference-options/imbc_priority','expert')).json() as {items:{code:string;names:{en:string;ru:string;kk:string}}[]};
    expect(refs.items.map(r=>r.code)).toEqual(['1','2','3','4','5','6']);expect(refs.items[0]!.names).toEqual({en:'1',ru:'1',kk:'1'});
    for(const role of ROLES){const h=await stand(actors[role]);for(const path of ['product-options','reference-options/programme','reference-options/acquisition_source']){
      expect((await h.get(options+'/'+path,role)).status).toBe(['expert','director'].includes(role)?200:403);}}
    expect((await http.get(options+'/reference-options/region','expert')).status).toBe(404);
    await pool.query('update dictionary_entry set retired_at=clock_timestamp() where id=$1',[sourceA]);
    const selected=await http.get(options+'/reference-options/acquisition_source?ids='+sourceA,'expert');expect(selected.status).toBe(200);
    const selection=await selected.json() as {items:{id:string;retiredAt:string|null}[];total:number;offset:number;limit:number};expect(selection.items[0]!.id).toBe(sourceA);expect(selection.items[0]!.retiredAt).not.toBeNull();expect(selection.total).toBe(1);expect(selection.limit).toBe(1);
    expect((await http.get(options+'/reference-options/programme?ids='+sourceA,'expert')).status).toBe(404);
    expect((await http.get(options+'/reference-options/programme?ids='+randomUUID(),'expert')).status).toBe(404);
    expect((await http.get(options+'/reference-options/acquisition_source?ids='+sourceA+'&offset=0','expert')).status).toBe(400);
    expect((await http.get(options+'/reference-options/acquisition_source?ids='+sourceA+','+sourceA,'expert')).status).toBe(400);
    await pool.query('update dictionary_entry set retired_at=null where id=$1',[sourceA]);
    expect((await http.get(options+'/product-options?unknown=true','expert')).status).toBe(400);
  });
  it('nonempty migration replay retains native records, source history and legacy/review/file tables',async()=>{
    const before=await counts();
    const identities=(await pool.query('select count(*)::int n from product_line_identity')).rows[0].n;
    const legacy=(await pool.query('select count(*)::int n from imbc_notes')).rows[0].n;
    await migrateThrough(pool);
    expect(await counts()).toEqual(before);
    expect((await pool.query('select count(*)::int n from product_line_identity')).rows[0].n).toBe(identities);
    expect((await pool.query('select count(*)::int n from imbc_notes')).rows[0].n).toBe(legacy);
  });
  it('retained product context remains reachable after working row removal, without fabricated names or foreign lookup',async()=>{
    const graph=await seedProfileGraph(pool),id=String(graph.rows.product_line!.identity_id),line=String(graph.rows.product_line!.id);
    await pool.query('update product_line set name_en=$1,name_ru=$2 where id=$3',['Actual retained product','Исторический продукт',line]);
    const context=await records.putProductContext(expert,graph.profile,id,{programmeId:programme,priorityId:priority,expectedUpdatedAt:null},randomUUID()) as ImbcProductContextRead;
    const listed=await records.contextProducts(expert,graph.profile,{});expect(listed.items[0]!.product).toMatchObject({nameEn:'Actual retained product',nameRu:'Исторический продукт',isCurrent:true});
    await pool.query('delete from product_line_certificate where product_line_id=$1',[line]);
    await pool.query('delete from product_line_kpved where product_line_id=$1',[line]);
    await pool.query('delete from product_line where id=$1',[line]);
    expect((await records.productOptions(expert,graph.profile,{})).items).toEqual([]);
    const retained=await records.contextProducts(actors.director,graph.profile,{ids:id});
    expect(retained.items[0]!.context).toEqual(context);expect(retained.items[0]!.product).toEqual({productLineIdentityId:id,nameEn:null,nameRu:null,sectionRevisionId:null,isCurrent:false});
    await expect(records.contextProducts(expert,g.profile,{ids:id})).rejects.toMatchObject({code:'not_found'});
    const changed=await records.putProductContext(expert,graph.profile,id,{programmeId:null,priorityId:null,expectedUpdatedAt:context.updatedAt},randomUUID()) as ImbcProductContextRead;
    expect(changed.recordedBy).toBe(context.recordedBy);expect(changed.createdAt).toBe(context.createdAt);
    const history=await records.history(actors.director,graph.profile,'product_context',id,{});expect(history.items[0]!.before).toEqual(context);expect(history.items[0]!.after).toEqual(changed);
    const http=await stand(expert),path=`/api/v1/profiles/${graph.profile}/imbc-records/context-products?ids=${id}`;
    expect((await http.get(path,'expert')).status).toBe(200);
    const operator=await stand(actors.operator);expect((await operator.get(path,'operator')).status).toBe(403);
  });
});

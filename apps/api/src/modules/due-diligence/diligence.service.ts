import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  diligenceReadSchema,
  diligenceOverrideWriteSchema,
  diligenceEnhancedWriteSchema,
  diligenceHistorySchema,
  type DiligenceRead,
  type DiligenceOverrideWrite,
  type DiligenceEnhancedWrite,
  type DiligenceHistory,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { actorTransaction, isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { policyForTransaction } from '../../common/policy.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { boundLockWaits } from '../../database/lock-waits.js';
import { withQueueTransaction } from '../../database/transaction.js';
import type { AuthUser } from '../auth/auth.types.js';
import { captureDiligenceReport } from './report-files.js';
import { evaluateReceivedDiligence, type DiligenceEvidence, type DiligenceEvaluation } from './scoring.js';
import {
  diligenceOperationClock,
  replaceDiligenceState,
  storedDiligenceState,
  type DiligenceOperationHook,
  type DiligenceStoredRecord,
  type DiligenceStoredState,
} from './diligence-operation.js';

const denied = () => new ProblemException(403, 'forbidden', 'Нет прав на due diligence');
const changed = () => new ProblemException(409, 'diligence_changed', 'Проверка уже изменена. Обновите данные.');
type ActorInput = { actor: AuthUser; ip?: string | null };
type Scope = { profileId: string; organizationId: string };
type Snapshot = {
  id: string;
  normalizedState: string;
  evidence: DiligenceEvidence[];
  evaluation: DiligenceEvaluation | null;
  checkedOn: string;
};

/** Strict Class C DD access, persisted actor and policy checked again under the operation locks. */
export async function lockDiligenceScope(
  tx: Database,
  actor: AuthUser,
  profileId: string,
  write: boolean,
): Promise<Scope> {
  const actual = (
    await tx.execute<{ role: 'expert' | 'director'; organizationId: string }>(sql`
    select a.role,a.organization_id as "organizationId" from user_accounts a join organizations o on o.id=a.organization_id
    where a.id=${actor.id} and a.state='active' and o.type='imbc' and a.role in ('expert','director') for share of o`)
  ).rows[0];
  if (
    !actual ||
    actual.role !== actor.role ||
    actual.organizationId !== actor.organizationId ||
    (write && actual.role !== 'expert')
  )
    throw denied();
  if (
    (await policyForTransaction(tx)).can(actual.role, write ? 'imbc_records.edit' : 'imbc_records.read', 'c_imbc') !==
    'all'
  )
    throw denied();
  const scope = (
    await tx.execute<Scope>(sql`select id as "profileId",organization_id as "organizationId" from manufacturer_profile
    where id=${profileId} for no key update`)
  ).rows[0];
  if (!scope) throw notFound();
  return scope;
}

/** One scoped statement yields business rows and latest normalized completion in the same snapshot. */
export async function readDiligence(tx: Database, scope: Scope): Promise<DiligenceRead> {
  const result = (
    await tx.execute<DiligenceRead>(sql`
    select ${scope.profileId}::text as "profileId",${scope.organizationId}::text as "organizationId",
      (select jsonb_build_object('profileId',r.profile_id,'organizationId',r.organization_id,'checkedOn',r.checked_on::text,
        'adataResult',r.adata_result,'result',r.result,'comment',r.comment,'reportFileId',r.report_file_id,
        'reportFileVersionId',r.report_file_version_id,
        'reportFileVersionNumber',(select version_number from file_version where id=r.report_file_version_id and file_object_id=r.report_file_id),
        'overriddenBy',r.overridden_by,'overriddenAt',case when r.overridden_at is null then null else
          to_char(r.overridden_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'enhanced',r.enhanced,'enhancedComment',r.enhanced_comment,'enhancedReportFileId',r.enhanced_report_file_id,
        'enhancedReportFileVersionId',r.enhanced_report_file_version_id,
        'enhancedReportFileVersionNumber',(select version_number from file_version where id=r.enhanced_report_file_version_id and file_object_id=r.enhanced_report_file_id),
        'sourceSnapshotId',r.source_snapshot_id,
        'checkedAt',case when pinned.completed_at is null then null else to_char(pinned.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'sourceIsTestData',pinned.is_test_data,
        'updatedAt',to_char(r.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
        from due_diligence_record r left join diligence_source_snapshot pinned on pinned.id=r.source_snapshot_id
          and pinned.profile_id=r.profile_id and pinned.organization_id=r.organization_id
        where r.profile_id=${scope.profileId} and r.organization_id=${scope.organizationId}) as record,
      coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'profileId',c.profile_id,'organizationId',c.organization_id,
        'groupName',c.group_name,'subjectName',c.subject_name,'checkName',c.check_name,'adataValue',c.adata_value,'mark',c.mark,'attention',c.attention,'position',c.position)
        order by c.position,c.id) from due_diligence_check c where c.profile_id=${scope.profileId} and c.organization_id=${scope.organizationId}),'[]'::jsonb) as checks,
      (select jsonb_build_object('attemptId',a.id,'snapshotId',s.id,
        'state',coalesce(s.normalized_state,case when a.state in ('queued','polling') then 'waiting'
          when a.state='received' then 'unavailable' else a.state::text end),
        'requestedAt',to_char(a.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'completedAt',case when a.completed_at is null then null else to_char(a.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
        'isTestData',a.is_test_data)
        from external_check e join external_check_attempt a on a.id=e.latest_attempt_id and a.external_check_id=e.id
        left join diligence_source_snapshot s on s.attempt_id=a.id and s.completed_at=a.completed_at and s.terminal_state=a.state::text
          and s.profile_id=e.profile_id and s.organization_id=e.organization_id
        where e.profile_id=${scope.profileId} and e.organization_id=${scope.organizationId} and e.connector='adata') as "lastRun"`)
  ).rows[0]!;
  return parseResponse(diligenceReadSchema, result, 'due diligence');
}

function initialRecord(
  scope: Scope,
  at: string,
  date: string,
  result: DiligenceStoredRecord['result'],
): DiligenceStoredRecord {
  return {
    profile_id: scope.profileId,
    organization_id: scope.organizationId,
    checked_on: date,
    adata_result: null,
    result,
    comment: null,
    report_file_id: null,
    report_file_version_id: null,
    overridden_by: null,
    overridden_at: null,
    enhanced: 'not_done',
    enhanced_comment: null,
    enhanced_report_file_id: null,
    enhanced_report_file_version_id: null,
    source_snapshot_id: null,
    updated_at: at,
  };
}

@Injectable()
export class DiligenceService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}

  private async run<T>(
    input: ActorInput,
    profileId: string,
    write: boolean,
    callback: (tx: Database, scope: Scope) => Promise<T>,
  ): Promise<T> {
    if (!isUuid(profileId)) throw notFound();
    return actorTransaction(
      this.pool,
      this.audit,
      input.actor,
      {
        action: write ? 'imbc_records.edit' : 'imbc_records.read',
        route: 'v1/profiles/:profileId/due-diligence',
        ip: input.ip ?? null,
      },
      async (tx) => callback(tx, await lockDiligenceScope(tx, input.actor, profileId, write)),
    );
  }
  read(input: ActorInput, profileId: string): Promise<DiligenceRead> {
    return this.run(input, profileId, false, readDiligence);
  }

  /** Full operation snapshots; fixed bounded pagination, IDs/timestamps remain exact and reports stay Class C. */
  history(input: ActorInput, profileId: string, beforeId?: string): Promise<DiligenceHistory> {
    if (beforeId !== undefined && !isUuid(beforeId)) throw notFound();
    return this.run(input, profileId, false, async (tx, scope) =>
      parseResponse(
        diligenceHistorySchema,
        (
          await tx.execute(sql`
      select a.id,to_char(a.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,a.user_id as "actorId",
        account.full_name as "actorName",a.action,a.diff,
        coalesce((select jsonb_agg(jsonb_build_object('fileId',refs.file_id,'versionId',refs.version_id,'versionNumber',refs.version_number)
          order by refs.file_id,refs.version_number,refs.version_id) from (
            select distinct f.id as file_id,v.id as version_id,v.version_number
            from jsonb_array_elements(jsonb_build_array(a.diff#>'{before,record}',a.diff#>'{after,record}')) old_record
            cross join lateral (values
              (old_record->>'report_file_id',old_record->>'report_file_version_id','due_diligence_report'),
              (old_record->>'enhanced_report_file_id',old_record->>'enhanced_report_file_version_id','enhanced_due_diligence_report')) pin(file_id,version_id,purpose)
            join file_object f on f.id::text=pin.file_id and f.organization_id=op.organization_id
              and f.data_class='c_imbc' and f.purpose::text=pin.purpose
            join file_version v on v.id::text=pin.version_id and v.file_object_id=f.id
            where old_record->>'profile_id'=op.profile_id::text and old_record->>'organization_id'=op.organization_id::text
          ) refs),'[]'::jsonb) as reports,
        coalesce((select jsonb_agg(jsonb_build_object('snapshotId',pins.id,
          'checkedAt',to_char(pins.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'isTestData',pins.is_test_data) order by pins.completed_at,pins.id) from (
            select distinct source.id,source.completed_at,source.is_test_data
            from jsonb_array_elements(jsonb_build_array(a.diff#>'{before,record}',a.diff#>'{after,record}')) old_record
            join diligence_source_snapshot source on source.id::text=old_record->>'source_snapshot_id'
              and source.profile_id=op.profile_id and source.organization_id=op.organization_id
            where old_record->>'profile_id'=op.profile_id::text and old_record->>'organization_id'=op.organization_id::text
          ) pins),'[]'::jsonb) as "sourceSnapshots"
      from diligence_operation op join audit_entries a on a.id=op.audit_entry_id
      left join user_accounts account on account.id=a.user_id
      where op.profile_id=${scope.profileId} and op.organization_id=${scope.organizationId}
      ${
        beforeId
          ? sql`and (a.at,a.id)<(select at,id from audit_entries where id=${beforeId}
        and organization_id=${scope.organizationId} and object_type='due_diligence' and object_id=${scope.profileId})`
          : sql``
      }
      order by a.at desc,a.id desc limit 50`)
        ).rows,
        'история DD',
      ),
    );
  }

  override(input: ActorInput, profileId: string, body: unknown, hook?: DiligenceOperationHook): Promise<DiligenceRead> {
    const write: DiligenceOverrideWrite = diligenceOverrideWriteSchema.parse(body);
    return this.run(input, profileId, true, async (tx, scope) => {
      const before = await storedDiligenceState(tx, scope.profileId, scope.organizationId);
      const current = await readDiligence(tx, scope);
      if ((current.record?.updatedAt ?? null) !== write.expectedUpdatedAt) throw changed();
      const clock = await diligenceOperationClock(tx, before.record);
      const versionId = await captureDiligenceReport(tx, {
        organizationId: scope.organizationId,
        fileId: write.reportFileId,
        purpose: 'due_diligence_report',
      });
      const record = {
        ...(before.record ?? initialRecord(scope, clock.at, clock.date, write.result)),
        result: write.result,
        comment: write.comment,
        report_file_id: write.reportFileId,
        report_file_version_id: versionId,
        overridden_by: input.actor.id,
        overridden_at: clock.at,
        updated_at: clock.at,
      };
      await replaceDiligenceState(tx, {
        ...scope,
        before,
        after: { record, checks: before.checks },
        action: 'due_diligence.override',
        actorId: input.actor.id,
        ip: input.ip,
        hook,
      });
      return readDiligence(tx, scope);
    });
  }

  enhanced(input: ActorInput, profileId: string, body: unknown, hook?: DiligenceOperationHook): Promise<DiligenceRead> {
    const write: DiligenceEnhancedWrite = diligenceEnhancedWriteSchema.parse(body);
    return this.run(input, profileId, true, async (tx, scope) => {
      const before = await storedDiligenceState(tx, scope.profileId, scope.organizationId);
      const current = await readDiligence(tx, scope);
      if ((current.record?.updatedAt ?? null) !== write.expectedUpdatedAt) throw changed();
      if (!before.record) throw new ProblemException(409, 'diligence_missing', 'Сначала задайте результат проверки');
      const clock = await diligenceOperationClock(tx, before.record);
      const versionId = await captureDiligenceReport(tx, {
        organizationId: scope.organizationId,
        fileId: write.reportFileId,
        purpose: 'enhanced_due_diligence_report',
      });
      const record = {
        ...before.record,
        enhanced: write.enhanced,
        enhanced_comment: write.comment,
        enhanced_report_file_id: write.reportFileId,
        enhanced_report_file_version_id: versionId,
        updated_at: clock.at,
      };
      await replaceDiligenceState(tx, {
        ...scope,
        before,
        after: { record, checks: before.checks },
        action: 'due_diligence.enhanced',
        actorId: input.actor.id,
        ip: input.ip,
        hook,
      });
      return readDiligence(tx, scope);
    });
  }

  /** Worker path: profile → immutable receipt → outbox. No attempt lock, source transaction or HTTP call. */
  async refresh(profileId: string, organizationId: string, hook?: DiligenceOperationHook): Promise<boolean> {
    if (![profileId, organizationId].every(isUuid)) return false;
    return withQueueTransaction(this.pool, async (tx) => {
      await boundLockWaits(tx);
      const profile = (
        await tx.execute(
          sql`select id from manufacturer_profile where id=${profileId} and organization_id=${organizationId} for no key update`,
        )
      ).rows[0];
      if (!profile) return false;
      const snapshot = (
        await tx.execute<Snapshot>(sql`
        select s.id,s.normalized_state as "normalizedState",s.evidence,s.evaluation,
          (s.completed_at at time zone 'Asia/Almaty')::date::text as "checkedOn"
        from diligence_source_snapshot s join external_check c on c.profile_id=s.profile_id and c.organization_id=s.organization_id and c.connector='adata'
        join external_check_attempt a on a.id=c.latest_attempt_id and a.external_check_id=c.id
          and a.id=s.attempt_id and a.completed_at=s.completed_at and a.state::text=s.terminal_state
        where s.profile_id=${profileId} and s.organization_id=${organizationId} for share of c`)
      ).rows[0];
      if (!snapshot) return false;
      const outbox = (
        await tx.execute<{ requestedSnapshotId: string; appliedSnapshotId: string | null }>(sql`
        select requested_snapshot_id as "requestedSnapshotId",applied_snapshot_id as "appliedSnapshotId"
        from diligence_refresh_outbox where profile_id=${profileId} and organization_id=${organizationId} for update`)
      ).rows[0];
      if (!outbox || outbox.requestedSnapshotId !== snapshot.id || outbox.appliedSnapshotId === snapshot.id)
        return false;
      // Recheck after outbox wait: a newer completion can arrive without taking the profile lock.
      const latest =
        (
          await tx.execute(sql`select 1 from diligence_source_snapshot s join external_check c on c.profile_id=s.profile_id
        and c.organization_id=s.organization_id and c.connector='adata' join external_check_attempt a on a.id=c.latest_attempt_id
        and a.id=s.attempt_id and a.completed_at=s.completed_at and a.state::text=s.terminal_state where s.id=${snapshot.id}`)
        ).rows.length === 1;
      if (!latest) return false;
      if (snapshot.normalizedState === 'received' && snapshot.evaluation !== null) {
        const evaluated = evaluateReceivedDiligence(snapshot.evidence);
        if (!evaluated.checks.some((check) => check.mark !== 'no_answer'))
          throw new Error('Received diligence snapshot has no answered checks');
        if (!isDeepStrictEqual(evaluated, snapshot.evaluation)) throw new Error('Stored diligence evaluation mismatch');
        const scope = { profileId, organizationId };
        const before = await storedDiligenceState(tx, profileId, organizationId);
        const clock = await diligenceOperationClock(tx, before.record);
        const record = {
          ...(before.record ?? initialRecord(scope, clock.at, snapshot.checkedOn, evaluated.automaticResult)),
          checked_on: snapshot.checkedOn,
          adata_result: evaluated.automaticResult,
          result: evaluated.automaticResult,
          comment: null,
          report_file_id: null,
          report_file_version_id: null,
          overridden_by: null,
          overridden_at: null,
          source_snapshot_id: snapshot.id,
          updated_at: clock.at,
        };
        const after: DiligenceStoredState = {
          record,
          checks: evaluated.checks.map((c) => ({
            id: randomUUID(),
            profile_id: profileId,
            organization_id: organizationId,
            group_name: c.group,
            subject_name: c.subjectName,
            check_name: c.checkName,
            adata_value: c.adataValue,
            mark: c.mark,
            attention: c.attention,
            position: c.position,
          })),
        };
        await replaceDiligenceState(tx, {
          ...scope,
          before,
          after,
          action: 'due_diligence.received',
          actorId: null,
          hook,
        });
      }
      // Unavailable/all-no-answer changes only the technical cursor, preserving the prior business result.
      await tx.execute(sql`update diligence_refresh_outbox set applied_snapshot_id=${snapshot.id},state='applied',
        attempt_count=attempt_count+1,last_attempt_at=clock_timestamp() where profile_id=${profileId}
          and organization_id=${organizationId} and requested_snapshot_id=${snapshot.id}`);
      return true;
    });
  }
}

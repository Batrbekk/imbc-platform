import { randomUUID } from 'node:crypto';
import { DEFAULT_LOCALE, type Locale, type ProfileFile } from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { policyForTransaction } from '../../common/policy.js';
import { ENV, type Env } from '../../config/env.js';
import { DB, PG_POOL, type Database } from '../../database/database.module.js';
import { databaseErrorSummary } from '../../database/pg-errors.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES } from '../../jobs/queues.js';
import { MailService } from '../../mail/mail.service.js';
import { renderNotification } from '../../mail/templates.js';
import { notifyJobSchema, type NotifyJob } from '../../notifications/enqueue.js';
import { appLink } from '../../notifications/links.js';
import { rebuildVerifiedCatalogProjection } from '../due-diligence/catalog-projection.js';
import { loadCurrentCompanySurvey } from './site-survey-company.js';
import { loadSiteSurveyState, siteSurveyedPredicate } from './survey-state.js';

const noticeParams = z.strictObject({
  schema: z.literal('survey-notice-v1'),
  generation: z.string().regex(/^[1-9][0-9]{0,18}$/),
  dispatchId: z.uuid(),
});
type SurveyNoticeJob = NotifyJob & {
  profileId: string;
  organizationId: string;
  related: { type: 'site_survey_notice'; id: string };
  params: z.infer<typeof noticeParams>;
};
type Scope = { profileId: string; organizationId: string };
type NoticeState = 'pending' | 'queued' | 'completed' | 'obsolete';
type CurrentNotice = {
  state: NoticeState;
  dispatchId: string | null;
  generation: string;
  currentGeneration: string;
  siteSurveyed: boolean;
};
export type SurveyNoticeResult = {
  sent: number;
  duplicates: number;
  skippedRecipients: number;
  state: NoticeState | 'stale';
};
class DeferredNotice extends Error {
  constructor(readonly reason = 'company_hidden') {
    super('Survey notice deferred');
  }
}
class ObsoleteNotice extends Error {
  constructor() {
    super('Survey notice obsolete');
  }
}
class StaleNotice extends Error {
  constructor() {
    super('Survey dispatch superseded');
  }
}

function parseSurveyNotice(data: unknown): SurveyNoticeJob | null {
  const parsed = notifyJobSchema.safeParse(data);
  if (!parsed.success) return null;
  const job = parsed.data,
    params = noticeParams.safeParse(job.params);
  if (
    job.rule !== 'NOT-11' ||
    !job.profileId ||
    !job.organizationId ||
    job.accountId ||
    job.related?.type !== 'site_survey_notice' ||
    !params.success ||
    BigInt(params.data.generation) > 9223372036854775807n ||
    job.eventKey !== `site-surveyed:${job.profileId}:${params.data.generation}`
  )
    return null;
  return {
    ...job,
    profileId: job.profileId,
    organizationId: job.organizationId,
    related: { type: 'site_survey_notice', id: job.related.id },
    params: params.data,
  };
}

/** NOT-11/34 recovery owns a durable dispatch token. Each recipient keeps its own SMTP/journal transaction. */
@Injectable()
export class SiteSurveyNoticeWorker {
  private readonly logger = new Logger(SiteSurveyNoticeWorker.name);
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async refreshPending(limit = 25) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid Survey recovery batch size');
    const candidates = (
      await this.db.execute<Scope>(sql`
      with candidates as (
        select s.profile_id from site_survey_publication_state s where
          s.next_refresh_on <= (clock_timestamp() at time zone 'Asia/Almaty')::date
          or s.site_surveyed is distinct from ${siteSurveyedPredicate(sql`s.profile_id`, sql`s.organization_id`)}
        union select distinct r.profile_id from site_survey_record r where not exists
          (select 1 from site_survey_publication_state s where s.profile_id=r.profile_id)
        union select n.profile_id from site_survey_notice_outbox n where n.state in ('pending','queued')
          and (n.last_attempt_at is null or n.last_attempt_at < clock_timestamp()-interval '30 seconds')
      ) select p.id as "profileId",p.organization_id as "organizationId" from candidates c
      join manufacturer_profile p on p.id=c.profile_id left join site_survey_publication_state s on s.profile_id=p.id
      order by s.last_checked_at asc nulls first,p.id limit ${limit}`)
    ).rows;
    const result = { checked: 0, queued: 0, deferred: 0, recovered: 0, obsolete: 0, failed: 0 };
    for (const scope of candidates) {
      try {
        const outcome = await this.refreshProfile(scope);
        result.checked++;
        result.queued += outcome.queued;
        result.deferred += outcome.deferred;
        result.recovered += outcome.recovered;
        result.obsolete += outcome.obsolete;
      } catch (error) {
        result.failed++;
        this.logger.warn(
          databaseErrorSummary(error) ?? { error: error instanceof Error ? error.name : 'Error' },
          'Survey recovery candidate failed; durable event will be retried',
        );
        // Failed candidates move behind peers without changing business generation or queued dispatch ownership.
        try {
          await this.db.execute(sql`update site_survey_publication_state set last_checked_at=clock_timestamp()
          where profile_id=${scope.profileId} and organization_id=${scope.organizationId}`);
        } catch {
          /* next scheduled retry */
        }
      }
    }
    return result;
  }

  private async lockProfile(tx: Database, scope: Scope) {
    const row = (
      await tx.execute(sql`select id from manufacturer_profile where id=${scope.profileId}
      and organization_id=${scope.organizationId} for no key update`)
    ).rows[0];
    if (!row) throw new StaleNotice();
  }

  private async refreshProfile(scope: Scope) {
    return withQueueTransaction(this.pool, async (tx, queueDb) => {
      await tx.execute(sql`set local lock_timeout='2s'`);
      await tx.execute(sql`set local statement_timeout='15s'`);
      await this.lockProfile(tx, scope);
      await rebuildVerifiedCatalogProjection(tx, scope);
      await tx.execute(
        sql`update site_survey_publication_state set last_checked_at=clock_timestamp() where profile_id=${scope.profileId}`,
      );
      const effective = await loadSiteSurveyState(tx, scope);
      const state = (
        await tx.execute<{ generation: string }>(sql`select generation::text as generation
        from site_survey_publication_state where profile_id=${scope.profileId}`)
      ).rows[0]!;
      const notices = (
        await tx.execute<{ id: string; generation: string; state: NoticeState; notificationJobId: string | null }>(sql`
        select id,generation::text as generation,state,notification_job_id as "notificationJobId" from site_survey_notice_outbox
        where profile_id=${scope.profileId} and organization_id=${scope.organizationId} and state in ('pending','queued')
        order by generation for no key update`)
      ).rows;
      const result = { queued: 0, deferred: 0, recovered: 0, obsolete: 0 };
      for (const notice of notices) {
        if (notice.generation !== state.generation || !effective.summary.siteSurveyed) {
          await tx.execute(sql`update site_survey_notice_outbox set state='obsolete',dispatch_id=null,notification_job_id=null,
            resolved_at=clock_timestamp(),last_attempt_at=clock_timestamp(),last_outcome='obsolete' where id=${notice.id}`);
          result.obsolete++;
          continue;
        }
        if (notice.state === 'queued') {
          const queued = await this.queue.getJobById(QUEUES.notify, notice.notificationJobId!, { db: queueDb });
          if (queued && ['created', 'retry', 'active'].includes(queued.state)) continue;
          await tx.execute(sql`update site_survey_notice_outbox set state='pending',queued_at=null,dispatch_id=null,notification_job_id=null
            where id=${notice.id}`);
          result.recovered++;
        }
        const visible = await loadCurrentCompanySurvey(tx, scope);
        if (!visible.visible || !visible.current) {
          await tx.execute(sql`update site_survey_notice_outbox set last_attempt_at=clock_timestamp(),attempt_count=attempt_count+1,last_outcome='company_hidden'
            where id=${notice.id}`);
          result.deferred++;
          continue;
        }
        const configured = (
          await tx.execute<{ enabled: boolean; recipientRule: string }>(sql`
          select enabled,recipient_rule as "recipientRule" from notification_rule where code='NOT-11'`)
        ).rows[0];
        const policy = await policyForTransaction(tx);
        const deferredReason =
          !configured || configured.recipientRule !== 'operator_accounts_not_blocked'
            ? 'configuration_unavailable'
            : !configured.enabled
              ? 'rule_disabled'
              : !['visible', 'all'].includes(policy.can('operator', 'catalog.search', 'a_register') ?? '')
                ? 'policy_denied'
                : null;
        if (deferredReason) {
          await tx.execute(sql`update site_survey_notice_outbox set last_attempt_at=clock_timestamp(),attempt_count=attempt_count+1,last_outcome=${deferredReason}
            where id=${notice.id}`);
          result.deferred++;
          continue;
        }
        const dispatchId = randomUUID();
        const job = notifyJobSchema.parse({
          rule: 'NOT-11',
          ...scope,
          eventKey: `site-surveyed:${scope.profileId}:${notice.generation}`,
          related: { type: 'site_survey_notice', id: notice.id },
          params: { schema: 'survey-notice-v1', generation: notice.generation, dispatchId },
        });
        const jobId = await this.queue.send(QUEUES.notify, job, { db: queueDb });
        if (!jobId) throw new Error('Survey notification enqueue not accepted');
        await tx.execute(sql`update site_survey_notice_outbox set state='queued',queued_at=clock_timestamp(),dispatch_id=${dispatchId},
          notification_job_id=${jobId},last_attempt_at=clock_timestamp(),attempt_count=attempt_count+1,last_outcome='queued' where id=${notice.id}`);
        result.queued++;
      }
      return result;
    });
  }

  private async current(tx: Database, job: SurveyNoticeJob): Promise<CurrentNotice & { report: ProfileFile }> {
    const row = (
      await tx.execute<CurrentNotice>(sql`
      select n.state,n.dispatch_id as "dispatchId",n.generation::text as generation,s.generation::text as "currentGeneration",s.site_surveyed as "siteSurveyed"
      from site_survey_notice_outbox n join site_survey_publication_state s on s.profile_id=n.profile_id and s.organization_id=n.organization_id
      where n.id=${job.related.id} and n.profile_id=${job.profileId} and n.organization_id=${job.organizationId}`)
    ).rows[0];
    if (
      !row ||
      row.generation !== job.params.generation ||
      row.state !== 'queued' ||
      row.dispatchId !== job.params.dispatchId
    )
      throw new StaleNotice();
    if (row.currentGeneration !== job.params.generation || !row.siteSurveyed) throw new ObsoleteNotice();
    const effective = await loadSiteSurveyState(tx, job);
    if (!effective.summary.siteSurveyed) throw new ObsoleteNotice();
    const visible = await loadCurrentCompanySurvey(tx, job);
    if (!visible.visible || !visible.current) throw new DeferredNotice();
    return { ...row, report: visible.current.report };
  }

  async runJob(
    data: unknown,
  ): Promise<SurveyNoticeResult | { rule: 'NOT-11'; refused: 'invalid_job'; reason: string }> {
    const job = parseSurveyNotice(data);
    if (!job) return { rule: 'NOT-11', refused: 'invalid_job', reason: 'invalid survey event context' };
    const result: SurveyNoticeResult = { sent: 0, duplicates: 0, skippedRecipients: 0, state: 'queued' };
    try {
      await this.current(this.db, job);
    } catch (error) {
      return this.resolveFailure(job, error, result);
    }
    const [rule] = (
      await this.db.execute<{ enabled: boolean; recipientRule: string }>(sql`
      select enabled,recipient_rule as "recipientRule" from notification_rule where code='NOT-11'`)
    ).rows;
    if (!rule || rule.recipientRule !== 'operator_accounts_not_blocked')
      throw new Error('Invalid NOT-11 recipient rule');
    if (!rule.enabled) {
      await this.resolve(job, 'pending', undefined, 'rule_disabled');
      return { ...result, state: 'pending' };
    }
    const recipients = (
      await this.db.execute<{ id: string; organizationId: string; email: string; locale: Locale }>(sql`
      select a.id,a.organization_id as "organizationId",a.email,a.locale from user_accounts a join organizations o on o.id=a.organization_id
      where a.role='operator' and o.type='operator' and a.state<>'blocked' order by a.created_at,a.id`)
    ).rows;
    let failed = 0;
    let deferred = false;
    let deferredReason = 'company_hidden';
    let obsolete = false;
    let stale = false;
    const addresses = new Set<string>();
    for (const recipient of recipients) {
      const address = recipient.email.trim().toLowerCase();
      if (addresses.has(address) || !z.email().safeParse(address).success) {
        result.skippedRecipients++;
        continue;
      }
      addresses.add(address);
      const language = recipient.locale ?? DEFAULT_LOCALE;
      try {
        const outcome = await this.mail.sendOnceGuarded(
          {
            ruleCode: 'NOT-11',
            eventKey: job.eventKey,
            to: recipient.email,
            accountId: recipient.id,
            language,
            related: job.related,
          },
          renderNotification('NOT-11', language, { link: appLink(this.env.PUBLIC_URL, `/companies/${job.profileId}`) }),
          async (tx) => {
            await tx.execute(sql`set local lock_timeout='2s'`);
            const current = (
              await tx.execute<{
                email: string;
                locale: Locale;
                role: string;
                state: string;
                organizationId: string;
              }>(sql`
            select email,locale,role,state,organization_id as "organizationId" from user_accounts where id=${recipient.id} for no key update`)
            ).rows[0];
            if (!current || current.state === 'blocked' || current.role !== 'operator') return false;
            const org = (
              await tx.execute<{ type: string }>(
                sql`select type from organizations where id=${current.organizationId} for share`,
              )
            ).rows[0];
            if (org?.type !== 'operator') return false;
            if (current.email.trim().toLowerCase() !== address || current.locale !== language)
              throw new DeferredNotice('recipient_changed');
            await this.lockProfile(tx, job);
            await tx.execute(sql`select site_survey_lock_notification_policy()`);
            const policy = await policyForTransaction(tx);
            if (!['visible', 'all'].includes(policy.can('operator', 'catalog.search', 'a_register') ?? ''))
              throw new DeferredNotice('policy_denied');
            const enabled = (
              await tx.execute<{ enabled: boolean; recipientRule: string }>(sql`
            select enabled,recipient_rule as "recipientRule" from notification_rule where code='NOT-11'`)
            ).rows[0];
            if (!enabled?.enabled || enabled.recipientRule !== 'operator_accounts_not_blocked')
              throw new DeferredNotice('rule_disabled');
            const selected = await this.current(tx, job);
            await tx.execute(sql`select id from file_object where id=${selected.report.fileId} for share`);
            await tx.execute(
              sql`select id from file_version where id=${selected.report.versionId} and file_object_id=${selected.report.fileId} for share`,
            );
            const protectedNotice = await this.current(tx, job);
            if (protectedNotice.report.versionId !== selected.report.versionId)
              throw new DeferredNotice('report_changed');
            return true;
          },
        );
        if (outcome === 'sent') result.sent++;
        else if (outcome === 'duplicate') result.duplicates++;
        else result.skippedRecipients++;
      } catch (error) {
        if (error instanceof DeferredNotice) {
          deferred = true;
          deferredReason = error.reason;
        } else if (error instanceof ObsoleteNotice) obsolete = true;
        else if (error instanceof StaleNotice) stale = true;
        else failed++;
      }
    }
    // Temporary failures keep the durable token. A dead/forgotten queue job is recovered by the scheduler.
    if (failed) {
      await this.db
        .execute(sql`update site_survey_notice_outbox set last_outcome='delivery_failed',last_attempt_at=clock_timestamp()
        where id=${job.related.id} and state='queued' and dispatch_id=${job.params.dispatchId}`);
      throw new Error(`Survey notification delivery failed for ${failed} recipients`);
    }
    if (stale) return { ...result, state: 'stale' };
    if (obsolete) {
      await this.resolve(job, 'obsolete');
      return { ...result, state: 'obsolete' };
    }
    if (deferred) {
      await this.resolve(job, 'pending', undefined, deferredReason);
      return { ...result, state: 'pending' };
    }
    try {
      await this.db.transaction(async (raw) => {
        const tx = raw as unknown as Database;
        await this.lockProfile(tx, job);
        await this.current(tx, job);
        await this.resolve(job, 'completed', tx, recipients.length === 0 ? 'no_recipients' : 'delivered');
      });
      return { ...result, state: 'completed' };
    } catch (error) {
      return this.resolveFailure(job, error, result);
    }
  }

  private async resolveFailure(
    job: SurveyNoticeJob,
    error: unknown,
    result: SurveyNoticeResult,
  ): Promise<SurveyNoticeResult> {
    if (error instanceof StaleNotice) return { ...result, state: 'stale' };
    const state = error instanceof DeferredNotice ? 'pending' : error instanceof ObsoleteNotice ? 'obsolete' : null;
    if (!state) throw error;
    await this.resolve(job, state, undefined, error instanceof DeferredNotice ? error.reason : 'obsolete');
    return { ...result, state };
  }

  private async resolve(
    job: SurveyNoticeJob,
    state: Exclude<NoticeState, 'queued'>,
    tx?: Database,
    reason: string = state,
  ) {
    const update = async (db: Database) => {
      await this.lockProfile(db, job);
      await db.execute(sql`update site_survey_notice_outbox set state=${state},dispatch_id=null,notification_job_id=null,
        queued_at=${state === 'pending' ? sql`null` : sql`queued_at`},resolved_at=${state === 'pending' ? sql`null` : sql`clock_timestamp()`},
        last_attempt_at=clock_timestamp(),last_outcome=${reason} where id=${job.related.id} and profile_id=${job.profileId} and organization_id=${job.organizationId}
        and state='queued' and dispatch_id=${job.params.dispatchId} and generation=${job.params.generation}::bigint`);
    };
    if (tx) await update(tx);
    else await this.db.transaction((raw) => update(raw as unknown as Database));
  }
}

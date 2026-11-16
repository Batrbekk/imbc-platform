import {
  QUEUE_STATUSES,
  reviewQueueFilterSchema,
  reviewOperationalQueueSchema,
  reviewAssignmentQueueFilterSchema,
  reviewAssignmentQueueSchema,
  reviewExpertOptionsSchema,
  type QueueStatus,
  type ReviewOperationalQueue,
  type ReviewAssignmentQueue,
  type ReviewExpertOptions,
  type ReviewQueueFilter,
  type ReviewAssignmentQueueFilter,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import type { AuthUser } from '../auth/auth.types.js';
import { runReviewAction } from './review-scope.js';

/** Sent pointers or a real all-retained assignment establish pending changes; the legacy flag does not. */
export const sentReviewChanges = sql`(exists (select 1 from profile_section s where s.profile_id=p.id
  and s.organization_id=p.organization_id and s.pending_revision_id is not null)
  or (a.id is not null and a.submission_mode='verified_changes'))`;
const statusCondition = (status: QueueStatus): SQL =>
  status === 'pending_changes'
    ? sql`(p.status='verified' and ${sentReviewChanges})`
    : sql`p.status=${status}::profile_status`;
export const queueScopeCondition = sql`(p.status in ('submitted','under_review') or (p.status='verified' and ${sentReviewChanges}))`;
const expertId = sql`case when a.id is null then p.assigned_expert_id else a.expert_id end`;
const escapeLike = (value: string) => value.replace(/[!%_]/g, '!$&');
function predicate(filter: ReviewQueueFilter | ReviewAssignmentQueueFilter): SQL {
  const conditions: SQL[] = [];
  const statuses = filter.status?.length ? filter.status : QUEUE_STATUSES;
  conditions.push(sql`(${sql.join(statuses.map(statusCondition), sql` or `)})`);
  if (filter.q) conditions.push(sql`o.name ilike ${`%${escapeLike(filter.q)}%`} escape '!'`);
  if (filter.assignee?.length) {
    const ids = filter.assignee.filter((value) => value !== 'unassigned');
    const choices = [
      ...(ids.length ? [sql`${expertId}=any(${sql.param(ids)}::uuid[])`] : []),
      ...(filter.assignee.includes('unassigned') ? [sql`${expertId} is null`] : []),
    ];
    conditions.push(sql`(${sql.join(choices, sql` or `)})`);
  }
  if ('receivedFrom' in filter && filter.receivedFrom)
    conditions.push(sql`(a.received_at at time zone 'Asia/Almaty')::date>=${filter.receivedFrom}::date`);
  if ('receivedTo' in filter && filter.receivedTo)
    conditions.push(sql`(a.received_at at time zone 'Asia/Almaty')::date<=${filter.receivedTo}::date`);
  return sql.join(conditions, sql` and `);
}

/** One statement owns both total and page, avoiding count/page drift during concurrent queue changes. */
async function queuePayload(
  tx: Database,
  filter: ReviewQueueFilter | ReviewAssignmentQueueFilter,
  administration: boolean,
) {
  const metadata = sql`'profileId',page.profile_id,'organizationName',page.organization_name,
    'status',page.status,'hasPendingChanges',page.pending_changes,'assignmentId',page.assignment_id,
    'assignedExpertId',page.expert_id,'assignedExpert',page.expert_label,'unresolved',page.assignment_id is null`;
  const order = administration ? sql`organization_name,profile_id` : sql`received_at asc nulls last,profile_id`;
  const result = await tx.execute(sql`
    with filtered as (
      select p.id as profile_id,o.name as organization_name,p.status,(p.status='verified' and ${sentReviewChanges}) as pending_changes,
        a.id as assignment_id,${expertId} as expert_id,coalesce(nullif(e.full_name,''),e.email) as expert_label,
        a.received_at
        ${administration ? sql`` : sql`,o.bin,p.registered_at`}
      from manufacturer_profile p join organizations o on o.id=p.organization_id
      left join review_assignment a on a.profile_id=p.id and a.organization_id=p.organization_id and a.closed_at is null
      left join user_accounts e on e.id=${expertId}
      where ${predicate(filter)}
    ), page as (select * from filtered order by ${order} limit ${filter.limit} offset ${filter.offset})
    select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(${metadata}
      ${
        administration
          ? sql``
          : sql`,'bin',page.bin,'registeredAt',to_char(page.registered_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'receivedAt',to_char(page.received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
      }) order by ${order}) from page),'[]'::jsonb),
      'total',(select count(*) from filtered),'offset',${filter.offset}::integer,'limit',${filter.limit}::integer) as payload`);
  return result.rows[0]?.payload;
}

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}

  queue(actor: AuthUser, query: unknown, ip: string | null = null): Promise<ReviewOperationalQueue> {
    const filter = parseOrThrow(reviewQueueFilterSchema, query);
    return runReviewAction(
      this.pool,
      this.audit,
      actor,
      { action: 'review.take', role: 'expert', route: 'v1/reviews/queue', ip },
      async (tx) =>
        parseResponse(reviewOperationalQueueSchema, await queuePayload(tx, filter, false), 'очередь проверки'),
    );
  }
  assignmentQueue(actor: AuthUser, query: unknown, ip: string | null = null): Promise<ReviewAssignmentQueue> {
    const filter = parseOrThrow(reviewAssignmentQueueFilterSchema, query);
    return runReviewAction(
      this.pool,
      this.audit,
      actor,
      { action: 'review.assign', role: 'administrator', route: 'v1/reviews/assignment-queue', ip },
      async (tx) =>
        parseResponse(reviewAssignmentQueueSchema, await queuePayload(tx, filter, true), 'назначения проверки'),
    );
  }
  experts(actor: AuthUser, ip: string | null = null): Promise<ReviewExpertOptions> {
    return runReviewAction(
      this.pool,
      this.audit,
      actor,
      { action: 'review.assign', role: 'administrator', route: 'v1/reviews/experts', ip },
      async (tx) =>
        parseResponse(
          reviewExpertOptionsSchema,
          (
            await tx.execute(sql`
        select a.id,coalesce(nullif(a.full_name,''),a.email) as label from user_accounts a
        join organizations o on o.id=a.organization_id where a.role='expert' and a.state='active' and o.type='imbc'
        order by coalesce(nullif(a.full_name,''),a.email),a.id`)
          ).rows,
          'эксперты для назначения',
        ),
    );
  }
  queueExperts(actor: AuthUser, ip: string | null = null): Promise<ReviewExpertOptions> {
    return runReviewAction(
      this.pool,
      this.audit,
      actor,
      { action: 'review.take', role: 'expert', route: 'v1/reviews/queue/experts', ip },
      async (tx) =>
        parseResponse(
          reviewExpertOptionsSchema,
          (
            await tx.execute(sql`
        with assigned as (
          select ${expertId} as id from manufacturer_profile p
          left join review_assignment a on a.profile_id=p.id and a.organization_id=p.organization_id and a.closed_at is null
          where ${queueScopeCondition}
        )
        select e.id,coalesce(nullif(e.full_name,''),e.email) as label from user_accounts e
        join organizations o on o.id=e.organization_id
        where (e.role='expert' and e.state='active' and o.type='imbc') or e.id in (select id from assigned where id is not null)
        order by coalesce(nullif(e.full_name,''),e.email),e.id`)
          ).rows,
          'эксперты в очереди',
        ),
    );
  }
}

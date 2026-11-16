import { type DiligenceRead } from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { actorTransaction, isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { policyForTransaction } from '../../common/policy.js';
import { ProblemException } from '../../common/problem.js';
import { PG_POOL } from '../../database/database.module.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES } from '../../jobs/queues.js';
import type { AuthUser } from '../auth/auth.types.js';
import { lockDiligenceScope, readDiligence } from './diligence.service.js';
const rerunBody = z.strictObject({});

/** Explicit SME intent schedules the same Adata read used by Main prefill; no provider request on GET. */
@Injectable()
export class DiligenceRunService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
    @Inject(QUEUE) private readonly queue: PgBoss,
  ) {}
  async request(actor: AuthUser, profileId: string, body: unknown, ip: string | null): Promise<DiligenceRead> {
    rerunBody.parse(body);
    if (!isUuid(profileId)) throw notFound();
    return actorTransaction(
      this.pool,
      this.audit,
      actor,
      { action: 'external_checks.run', route: 'v1/profiles/:profileId/due-diligence/runs', ip },
      async (tx, queueDb) => {
        const scope = await lockDiligenceScope(tx, actor, profileId, false);
        if (
          actor.role !== 'expert' ||
          (await policyForTransaction(tx)).can(actor.role, 'external_checks.run', 'c_imbc') !== 'all'
        )
          throw new ProblemException(403, 'forbidden', 'Нет прав на повторную внешнюю проверку');
        const target = (
          await tx.execute<{ bin: string | null }>(
            sql`select bin from organizations where id=${scope.organizationId} for share`,
          )
        ).rows[0];
        if (!target?.bin || !/^\d{12}$/u.test(target.bin))
          throw new ProblemException(409, 'bin_missing', 'Для проверки нужен БИН профиля');
        await tx.execute(sql`insert into external_check(profile_id,organization_id,connector) values (${profileId},${scope.organizationId},'adata')
          on conflict(profile_id,connector) do nothing`);
        const check = (
          await tx.execute<{
            id: string;
            latestAttemptId: string | null;
          }>(sql`select id,latest_attempt_id as "latestAttemptId"
          from external_check where profile_id=${profileId} and organization_id=${scope.organizationId} and connector='adata' for no key update`)
        ).rows[0]!;
        const previous = check.latestAttemptId
          ? (
              await tx.execute<{ id: string; state: string; requestSentAt: string | null }>(sql`
          select id,state,request_sent_at::text as "requestSentAt" from external_check_attempt
          where id=${check.latestAttemptId} and external_check_id=${check.id} for update`)
            ).rows[0]
          : undefined;
        if (previous && ['queued', 'polling'].includes(previous.state)) return readDiligence(tx, scope);
        let attemptId: string,
          requeued = false;
        if (
          previous &&
          ['not_configured', 'quota_exhausted'].includes(previous.state) &&
          previous.requestSentAt === null
        ) {
          attemptId = previous.id;
          requeued = true;
          await tx.execute(sql`update external_check_attempt set state='queued',requested_at=clock_timestamp(),completed_at=null,
            failure=null,value=null,poll_token=null where id=${attemptId} and external_check_id=${check.id}`);
        } else {
          attemptId = (
            await tx.execute<{ id: string }>(sql`insert into external_check_attempt(external_check_id,trigger,state,bin)
            values (${check.id},'sme_rerun','queued',${target.bin}) returning id`)
          ).rows[0]!.id;
          await tx.execute(sql`update external_check set latest_attempt_id=${attemptId} where id=${check.id}`);
        }
        await this.queue.send(QUEUES.adataPrefill, { attemptId }, { db: queueDb, singletonKey: attemptId });
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: scope.organizationId,
            action: 'due_diligence.run_requested',
            objectType: 'external_check_attempt',
            objectId: attemptId,
            diff: { profileId, trigger: 'sme_rerun', requeued },
            ip,
          },
          tx,
        );
        return readDiligence(tx, scope);
      },
    );
  }
}

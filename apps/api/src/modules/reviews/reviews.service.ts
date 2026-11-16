import {
  QUEUE_STATUSES,
  type QueueStatus,
  type ReviewQueue,
  type ReviewQueueFilter,
  reviewQueueSchema,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, or, sql, type SQL } from 'drizzle-orm';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import { manufacturerProfiles, organizations, profileSection, userAccounts } from '../../database/schema/index.js';

const p = manufacturerProfiles;

/** MAN-45 / reply 29: only a submitted section pointer means changes were sent to SME. */
const sentPendingChanges = sql<boolean>`exists (
  select 1 from ${profileSection}
  where ${profileSection.profileId} = ${p.id}
    and ${profileSection.organizationId} = ${p.organizationId}
    and ${profileSection.pendingRevisionId} is not null
)`;

/** REV-03: section pointers are authoritative; a stale transitional profile flag cannot admit a queue row. */
function queueCondition(status: QueueStatus): SQL {
  if (status === 'pending_changes') return and(eq(p.status, 'verified'), sentPendingChanges)!;
  return eq(p.status, status);
}

/**
 * Очередь проверки SME (REV-01, REV-04). Читает рабочие таблицы первых отправок и отправленных
 * изменений Verified; каталог сохраняет прежние проверенные значения. Draft и returned не входят; разблокированный профиль уходит
 * из неё вместе со сменой статуса (MAN-43). Фильтры по SME и дате получения — этап 5.
 */
@Injectable()
export class ReviewsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async queue(filter: ReviewQueueFilter): Promise<ReviewQueue> {
    const statuses = filter.status?.length ? filter.status : QUEUE_STATUSES;
    const rows = await this.db
      .select({
        profileId: p.id,
        organizationName: organizations.name,
        bin: organizations.bin,
        status: p.status,
        // The queue badge describes sent changes; it must agree with the pending_changes filter.
        hasPendingChanges: sql<boolean>`${p.status} = 'verified' and ${sentPendingChanges}`,
        expertName: userAccounts.fullName,
        expertEmail: userAccounts.email,
        registeredAt: p.registeredAt,
      })
      .from(p)
      .innerJoin(organizations, eq(organizations.id, p.organizationId))
      .leftJoin(userAccounts, eq(userAccounts.id, p.assignedExpertId))
      .where(or(...statuses.map(queueCondition)))
      .orderBy(asc(p.registeredAt), asc(p.id));

    const items = rows.map(({ expertName, expertEmail, registeredAt, ...row }) => ({
      ...row,
      assignedExpert: expertName || expertEmail,
      registeredAt: registeredAt.toISOString(),
    }));
    return parseResponse(reviewQueueSchema, { items, total: items.length }, 'очередь проверки');
  }
}

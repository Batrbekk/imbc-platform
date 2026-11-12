import {
  QUEUE_STATUSES,
  type QueueStatus,
  type ReviewQueue,
  type ReviewQueueFilter,
  reviewQueueSchema,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, or, type SQL } from 'drizzle-orm';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import { manufacturerProfiles, organizations, userAccounts } from '../../database/schema/index.js';

const p = manufacturerProfiles;

/** Условие отбора по статусу очереди; pending_changes — verified с ожидающими изменениями (REV-03). */
function queueCondition(status: QueueStatus): SQL {
  if (status === 'pending_changes') return and(eq(p.status, 'verified'), eq(p.hasPendingChanges, true))!;
  return eq(p.status, status);
}

/**
 * Очередь проверки SME (REV-01, REV-04). Читает рабочие таблицы, а не проекцию каталога: профили
 * в очереди ещё не видимы. Draft и returned в очередь не входят; разблокированный профиль уходит
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
        hasPendingChanges: p.hasPendingChanges,
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

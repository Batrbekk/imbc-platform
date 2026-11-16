import { sql } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { renderNotification } from '../mail/templates.js';
import { loadReviewResultNotification } from '../modules/reviews/review-result-notification.js';
import { defaultNotificationRenderer, type NotificationRenderer } from './dispatcher.js';
import type { NotifyJob } from './enqueue.js';
import { PermanentNotificationError } from './errors.js';
import { appLink } from './links.js';

/** Worker rendering loads business text from its immutable event; queued params remain IDs/codes only. */
export function createDatabaseNotificationRenderer(db: Database, publicUrl: string): NotificationRenderer {
  return async (rule, language, params, job) => {
    if (!['NOT-04', 'NOT-05', 'NOT-10'].includes(rule)) return defaultNotificationRenderer(rule, language, params);
    if (!job || job.rule !== rule) throw new PermanentNotificationError(`notification ${rule}: missing event context`);
    if (rule === 'NOT-05') {
      const context = await loadReviewResultNotification(db, job);
      return renderNotification('NOT-05', language, {
        mode: context.mode,
        status: context.status,
        sections: JSON.stringify(
          context.sections.map((section) => ({
            kind: section.kind,
            outcome: section.outcome,
            comment: section.comment,
            reviewRequired: section.reviewRequired,
            notificationRelevant: section.notificationRelevant,
            publication: section.publication,
          })),
        ),
        link: appLink(publicUrl, '/profile'),
      });
    }
    const context = await reviewLifecycleContext(db, job);
    return renderNotification(rule as 'NOT-04' | 'NOT-10', language, {
      name: context.name,
      link: appLink(publicUrl, '/reviews'),
    });
  };
}

async function reviewLifecycleContext(db: Database, job: NotifyJob): Promise<{ name: string }> {
  if (
    job.related?.type !== 'review_assignment' ||
    !job.profileId ||
    !job.organizationId ||
    Object.keys(job.params).length !== 0 ||
    job.eventKey !== `${job.rule === 'NOT-04' ? 'profile_submitted' : 'profile-unlocked'}:${job.related.id}`
  )
    throw new PermanentNotificationError(`notification ${job.rule}: missing review assignment context`);
  const context = (
    await db.execute<{ name: string; closeReason: string | null; closedAt: string | null; sectionCount: number }>(sql`
    select o.name,a.close_reason as "closeReason",a.closed_at::text as "closedAt",
      (select count(*)::integer from review_assignment_section s
        where s.review_assignment_id=a.id and s.profile_id=a.profile_id and s.organization_id=a.organization_id) as "sectionCount"
    from review_assignment a join manufacturer_profile p on p.id=a.profile_id and p.organization_id=a.organization_id
      join organizations o on o.id=a.organization_id and o.type='manufacturer'
    where a.id=${job.related.id} and a.profile_id=${job.profileId} and a.organization_id=${job.organizationId}`)
  ).rows[0];
  if (
    !context ||
    context.sectionCount !== 7 ||
    (job.rule === 'NOT-10' && (context.closeReason !== 'manufacturer_unlock' || context.closedAt === null))
  )
    throw new PermanentNotificationError(`notification ${job.rule}: invalid review assignment context`);
  return { name: context.name };
}

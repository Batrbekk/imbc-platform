import { z } from 'zod';
import { csv } from './catalog.js';
import { PROFILE_STATUSES } from './enums.js';

/**
 * Статусы очереди SME (REV-01, REV-04): submitted, under_review и verified с pending changes (REV-03).
 * Draft и returned в очередь не входят; разблокированный профиль из неё уходит (MAN-43).
 */
export const QUEUE_STATUSES = ['submitted', 'under_review', 'pending_changes'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** Фильтр очереди: список статусов через запятую; нет значения — вся очередь. */
export const reviewQueueFilterSchema = z.object({ status: csv(z.enum(QUEUE_STATUSES)) });
export type ReviewQueueFilter = z.infer<typeof reviewQueueFilterSchema>;

/** Строка очереди проверки, только для чтения (REV-04). */
export const reviewQueueItemSchema = z.object({
  /** manufacturer_profiles.id */
  profileId: z.uuid(),
  /** organizations.name, organizations.bin */
  organizationName: z.string(),
  bin: z.string(),
  /** manufacturer_profiles.status, .has_pending_changes */
  status: z.enum(PROFILE_STATUSES),
  hasPendingChanges: z.boolean(),
  /** user_accounts.full_name, при пустом имени — email; null — не назначен. */
  assignedExpert: z.string().nullable(),
  /** manufacturer_profiles.registered_at, ISO. */
  registeredAt: z.string(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

export const reviewQueueSchema = z.object({ items: z.array(reviewQueueItemSchema), total: z.number().int() });
export type ReviewQueue = z.infer<typeof reviewQueueSchema>;

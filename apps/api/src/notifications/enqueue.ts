import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { QueueDb } from '../database/transaction.js';
import { QUEUES } from '../jobs/queues.js';
import { NOTIFICATION_RULE_CODES } from './rules.js';

/** Похоже на адрес электронной почты: такой строке в задании не место (NFR-11). */
const ADDRESS_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * Задание очереди `notify`: событие, по которому диспетчер находит получателей по правилу (раздел 8.2).
 * Строка задания хранится в pg-boss, поэтому в ней только код правила, ключ события, id и параметры.
 *
 * Правило для постановщиков: в `params` — только коды, id, числа и ссылки `appLink`. Имена, названия
 * организаций и адреса в задание не кладутся: их читает рендерер из базы по id в момент отправки, адреса
 * получателей — резолверы. Значение с `@` в `params` или в ключе события — ошибка постановщика, а не данных:
 * разбор отклоняет его (значение в текст ошибки не попадает). `related.type` — код объекта (`otp_code`,
 * `profile`), только `[a-z_]`.
 */
export const notifyJobSchema = z
  .object({
    rule: z.enum(NOTIFICATION_RULE_CODES),
    /** Ключ события: с кодом правила и адресом образует ключ журнала — одно письмо на событие и адрес (NOT-18). */
    eventKey: z.string().min(1).max(200),
    accountId: z.uuid().optional(),
    organizationId: z.uuid().optional(),
    profileId: z.uuid().optional(),
    related: z
      .object({ type: z.string().regex(/^[a-z_]{1,64}$/), id: z.uuid() })
      .strict()
      .optional(),
    params: z.record(z.string(), z.string().max(500)).default({}),
  })
  .strict()
  .superRefine((job, ctx) => {
    if (ADDRESS_LIKE.test(job.eventKey))
      ctx.addIssue({ code: 'custom', path: ['eventKey'], message: 'адрес электронной почты в задании notify' });
    for (const [name, value] of Object.entries(job.params))
      if (ADDRESS_LIKE.test(name) || ADDRESS_LIKE.test(value))
        ctx.addIssue({ code: 'custom', path: ['params'], message: 'адрес электронной почты в задании notify' });
  });

export type NotifyJob = z.infer<typeof notifyJobSchema>;

/**
 * Ставит письмо события в очередь `notify`. С `queueDb` — в транзакции вызывающего: задание появится,
 * только если событие зафиксировано. Неверное задание — исключение до постановки.
 */
export async function enqueueNotification(queue: PgBoss, job: NotifyJob, queueDb?: QueueDb): Promise<void> {
  const data = notifyJobSchema.parse(job);
  await queue.send(QUEUES.notify, data, { db: queueDb });
}

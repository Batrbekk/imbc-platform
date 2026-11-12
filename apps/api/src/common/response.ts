import type { z } from 'zod';

/**
 * Сверяет ответ сервера с его схемой. Нарушение — сбой сервера, а не ошибка запроса: обычный Error
 * (ZodError — в cause), поэтому ProblemDetailsFilter отвечает 500 без списка полей и пишет в журнал.
 */
export function parseResponse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(`Ответ «${what}» не соответствует схеме`, { cause: result.error });
  return result.data;
}

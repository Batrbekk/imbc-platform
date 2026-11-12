import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';
import { parseResponse } from '../src/common/response.js';

// Ответ сервера сверяется со своей схемой: нарушение — сбой сервера (500 и журнал), а не ошибка запроса (400).
describe('parseResponse', () => {
  const schema = z.object({ name: z.string() });

  it('значение по схеме возвращается разобранным', () => {
    expect(parseResponse(schema, { name: 'IMBC', extra: 1 }, 'проба')).toEqual({ name: 'IMBC' });
  });

  it('нарушение схемы — обычный Error с названием ответа, ZodError — в cause', () => {
    const error = (() => {
      try {
        parseResponse(schema, { name: null }, 'проба');
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ZodError);
    expect((error as Error).message).toContain('проба');
    expect((error as Error).cause).toBeInstanceOf(ZodError);
  });
});

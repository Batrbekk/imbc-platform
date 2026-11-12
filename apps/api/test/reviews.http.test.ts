import { type ReviewQueue, reviewQueueSchema } from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseResponse } from '../src/common/response.js';
import { ReviewsController } from '../src/modules/reviews/reviews.controller.js';
import { ReviewsService } from '../src/modules/reviews/reviews.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP очереди SME: настоящий SessionGuard, право review.take только у SME (GEN-08, REV-04).
const QUEUE: ReviewQueue = {
  items: [
    {
      profileId: '00000000-0000-4000-8000-000000000001',
      organizationName: 'ТОО «Жаңа Демо Құрылыс»',
      bin: '240100000901',
      status: 'submitted',
      hasPendingChanges: false,
      assignedExpert: null,
      registeredAt: '2026-11-01T10:00:00.000Z',
    },
  ],
  total: 1,
};

const queue = vi.fn(async (): Promise<ReviewQueue> => structuredClone(QUEUE));

describe('GET /api/v1/reviews/queue', () => {
  let http: HttpStand;
  const URL_PATH = '/api/v1/reviews/queue';

  beforeAll(async () => {
    http = await startHttp({
      controllers: [ReviewsController],
      providers: [{ provide: ReviewsService, useValue: { queue } }],
    });
  });

  beforeEach(() => {
    queue.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    await http?.close();
  });

  it('SME — 200', async () => {
    const res = await http.get(`${URL_PATH}?status=submitted,pending_changes`, 'expert');
    expect(res.status).toBe(200);
    expect(reviewQueueSchema.parse(await res.json())).toEqual(QUEUE);
    expect(queue).toHaveBeenCalledExactlyOnceWith({ status: ['submitted', 'pending_changes'] });
  });

  it('без фильтра — вся очередь', async () => {
    const res = await http.get(URL_PATH, 'expert');
    expect(res.status).toBe(200);
    expect(queue).toHaveBeenCalledExactlyOnceWith({ status: undefined });
  });

  it.each(['director', 'administrator', 'operator', 'observer', 'manufacturer'] as const)(
    'директор, администратор, оператор, наблюдатель, производитель — 403 и аудит (GEN-08): %s',
    async (role) => {
      const res = await http.get(URL_PATH, role);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 403, code: 'forbidden' });
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied', action: 'review.take' }),
      );
      expect(queue).not.toHaveBeenCalled();
    },
  );

  it('неизвестный статус — 400', async () => {
    for (const status of ['draft', 'returned', 'verified', 'submitted,unknown']) {
      const res = await http.get(`${URL_PATH}?status=${status}`, 'expert');
      expect(res.status, status).toBe(400);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 400, code: 'validation' });
    }
    expect(queue).not.toHaveBeenCalled();
  });

  it('ответ сервиса не проходит схему — 500 problem+json без списка полей', async () => {
    queue.mockImplementationOnce(async () =>
      parseResponse(reviewQueueSchema, { items: [{ ...QUEUE.items[0], bin: null }], total: 1 }, 'очередь проверки'),
    );
    const res = await http.get(URL_PATH, 'expert');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 500, code: 'internal' });
    expect(Object.keys(body)).not.toContain('errors');
    expect(JSON.stringify(body)).not.toContain('bin');
  });
});

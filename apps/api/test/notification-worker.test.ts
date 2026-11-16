import 'reflect-metadata';
import type { FactoryProvider, Provider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFY_QUEUE_OPTIONS, QUEUES } from '../src/jobs/queues.js';
import { MailService } from '../src/mail/mail.service.js';
import {
  defaultNotificationRenderer,
  NOTIFICATION_RENDERER,
  NotificationDispatcher,
  type NotificationRefusal,
  type NotificationRenderer,
} from '../src/notifications/dispatcher.js';
import { DB } from '../src/database/database.module.js';
import { ENV } from '../src/config/env.js';
import { PermanentNotificationError } from '../src/notifications/errors.js';
import { DEFAULT_RECIPIENT_RESOLVERS, RECIPIENT_RESOLVERS } from '../src/notifications/recipients.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { WorkerModule } from '../src/worker/worker.module.js';

// Сборка worker: очередь notify и опрос Keycloak (NOT-03) идут через один диспетчер с правилами-данными.
describe('worker: письма событий', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('WorkerModule передаёт диспетчеру резолверы и рендерер с БД; у JobHandlers диспетчера нет — опрос Keycloak ставит задание notify', async () => {
    const providers = (Reflect.getMetadata('providers', WorkerModule) ?? []) as Provider[];
    const value = (token: symbol) => {
      const provider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === token);
      return provider && 'useValue' in provider ? provider.useValue : undefined;
    };
    expect(providers).toContain(NotificationDispatcher);
    expect(providers).toContain(MailService);
    expect(value(RECIPIENT_RESOLVERS)).toBe(DEFAULT_RECIPIENT_RESOLVERS);
    const rendererProvider = providers.find(p => typeof p === 'object' && 'provide' in p && p.provide === NOTIFICATION_RENDERER) as FactoryProvider<NotificationRenderer>;
    expect(rendererProvider.inject).toEqual([DB, ENV]);
    const renderer = await rendererProvider.useFactory({}, { PUBLIC_URL: 'https://imbc.local' });
    expect((await renderer('NOT-03', 'en', { minutes: '15', link: 'https://imbc.local/login' })).subject)
      .toBe('Your IMBC Platform account is temporarily locked');
    await expect(renderer('NOT-05', 'en', {})).rejects.toThrow('missing event context');
    // Внедрение по типу: почта — вторым параметром диспетчера. Опрос Keycloak письма не шлёт, а ставит
    // задание notify: диспетчера у JobHandlers нет.
    expect((Reflect.getMetadata('design:paramtypes', NotificationDispatcher) as unknown[])[1]).toBe(MailService);
    expect(Reflect.getMetadata('design:paramtypes', JobHandlers) as unknown[]).not.toContain(NotificationDispatcher);
    // Повторы временных сбоев SMTP и базы — у задания notify.
    expect(NOTIFY_QUEUE_OPTIONS).toEqual({ retryLimit: 10, retryDelay: 30, retryBackoff: true });
  });

  it('очередь notify: результат runJob — результат обработчика pg-boss, его pg-boss кладёт в output задания (причина постоянного отказа, итог отправки); остальные очереди результата не возвращают', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const handlers = new Map<string, (jobs: { data: unknown }[]) => Promise<unknown>>();
    const boss = {
      createQueue: vi.fn(async () => undefined),
      work: vi.fn(async (name: string, handler: (jobs: { data: unknown }[]) => Promise<unknown>) => {
        handlers.set(name, handler);
        return name;
      }),
      schedule: vi.fn(async () => undefined),
    };
    const refusal: NotificationRefusal = {
      rule: 'NOT-04',
      refused: 'permanent_failure',
      reason: 'notification NOT-04: нет текста письма',
    };
    const sent = { sent: 1, duplicates: 0, skippedObservers: 0, invalid: 0, skipped: null };
    const runJob = vi.fn().mockResolvedValueOnce(refusal).mockResolvedValueOnce(sent);
    const jobs = { purgeSessions: vi.fn(async () => 'не результат задания') };
    const cleanup = { run: vi.fn(async () => 'purged'), sweep: vi.fn(async () => ({ enqueued: 1 })) };
    const worker = new WorkerModule(
      boss as never,
      jobs as never,
      {} as never,
      {} as never,
      {} as never,
      { runJob } as never,
      cleanup as never,
      {
        daily: async () => ({ state: 'disabled', accepted: 0, rejected: 0 }),
        refreshPending: async () => ({ processed: 0, deferred: 0, ambiguous: 0, failed: 0 }),
      } as never,
      { refreshPending: async () => ({ processed: 0, deferred: 0, failed: 0 }) } as never,
      { refreshPending: async () => ({ processed: 0, deferred: 0, failed: 0 }) } as never,
      { refresh: async () => false } as never,
    );
    await worker.onApplicationBootstrap();

    const job = { rule: 'NOT-04', eventKey: 'submitted:1', params: {} };
    expect(await handlers.get(QUEUES.notify)!([{ data: job }])).toEqual(refusal);
    expect(runJob).toHaveBeenCalledWith(job);
    expect(await handlers.get(QUEUES.notify)!([{ data: job }])).toEqual(sent);
    expect(await handlers.get(QUEUES.purgeSessions)!([{ data: null }])).toBeUndefined();
    expect(jobs.purgeSessions).toHaveBeenCalledOnce();
    expect(await handlers.get(QUEUES.fileCleanup)!([{ data: { fileObjectId: 'fixture-id' } }])).toBeUndefined();
    expect(cleanup.run).toHaveBeenCalledWith({ fileObjectId: 'fixture-id' });
    expect(await handlers.get(QUEUES.fileCleanupSweep)!([{ data: null }])).toBeUndefined();
    expect(cleanup.sweep).toHaveBeenCalledOnce();
    expect(await handlers.get(QUEUES.eOndirisDaily)!([{ data: null }])).toEqual({
      state: 'disabled',
      accepted: 0,
      rejected: 0,
    });
    expect(await handlers.get(QUEUES.eOndirisProfileRefresh)!([{ data: null }])).toEqual({
      processed: 0,
      deferred: 0,
      ambiguous: 0,
      failed: 0,
    });
    expect(await handlers.get(QUEUES.mainSourceRefresh)!([{ data: null }])).toEqual({
      processed: 0,
      deferred: 0,
      failed: 0,
    });
  });

  it('письмо без текста или обязательной подстановки отклоняется, а готовый шаблон работает', () => {
    expect(() => defaultNotificationRenderer('NOT-01', 'kk', {})).toThrow(PermanentNotificationError);
    expect(() => defaultNotificationRenderer('NOT-01', 'kk', {})).toThrow('notification NOT-01: нет текста письма');
    expect(() => defaultNotificationRenderer('NOT-04', 'kk', {})).toThrow(PermanentNotificationError);
    expect(defaultNotificationRenderer('NOT-04', 'en', { name: 'Manufacturer', link: 'https://imbc.local/reviews' }).text)
      .toContain('Manufacturer');
    expect(() => defaultNotificationRenderer('NOT-03', 'kk', { minutes: '15' })).toThrow(PermanentNotificationError);
    expect(
      defaultNotificationRenderer('NOT-03', 'en', { minutes: '15', link: 'https://imbc.local/login' }).subject,
    ).toBe('Your IMBC Platform account is temporarily locked');
  });
});

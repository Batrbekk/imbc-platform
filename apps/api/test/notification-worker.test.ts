import 'reflect-metadata';
import type { Provider } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { NOTIFY_QUEUE_OPTIONS } from '../src/jobs/queues.js';
import { MailService } from '../src/mail/mail.service.js';
import {
  defaultNotificationRenderer,
  NOTIFICATION_RENDERER,
  NotificationDispatcher,
} from '../src/notifications/dispatcher.js';
import { PermanentNotificationError } from '../src/notifications/errors.js';
import { DEFAULT_RECIPIENT_RESOLVERS, RECIPIENT_RESOLVERS } from '../src/notifications/recipients.js';
import { JobHandlers } from '../src/worker/handlers.service.js';
import { WorkerModule } from '../src/worker/worker.module.js';

// Сборка worker: очередь notify и опрос Keycloak (NOT-03) идут через один диспетчер с правилами-данными.
describe('worker: письма событий', () => {
  it('WorkerModule передаёт диспетчеру резолверы по умолчанию и тексты из языковых файлов; JobHandlers получает диспетчер', () => {
    const providers = (Reflect.getMetadata('providers', WorkerModule) ?? []) as Provider[];
    const value = (token: symbol) => {
      const provider = providers.find((p) => typeof p === 'object' && 'provide' in p && p.provide === token);
      return provider && 'useValue' in provider ? provider.useValue : undefined;
    };
    expect(providers).toContain(NotificationDispatcher);
    expect(providers).toContain(MailService);
    expect(value(RECIPIENT_RESOLVERS)).toBe(DEFAULT_RECIPIENT_RESOLVERS);
    expect(value(NOTIFICATION_RENDERER)).toBe(defaultNotificationRenderer);
    // Внедрение по типу: почта — вторым параметром диспетчера. Опрос Keycloak письма не шлёт, а ставит
    // задание notify: диспетчера у JobHandlers нет.
    expect((Reflect.getMetadata('design:paramtypes', NotificationDispatcher) as unknown[])[1]).toBe(MailService);
    expect(Reflect.getMetadata('design:paramtypes', JobHandlers) as unknown[]).not.toContain(NotificationDispatcher);
    // Повторы временных сбоев SMTP и базы — у задания notify.
    expect(NOTIFY_QUEUE_OPTIONS).toEqual({ retryLimit: 10, retryDelay: 30, retryBackoff: true });
  });

  it('письмо без текста или подстановки — постоянный отказ, а не пустое письмо: NOT-04 до своего этапа', () => {
    expect(() => defaultNotificationRenderer('NOT-04', 'kk', {})).toThrow(PermanentNotificationError);
    expect(() => defaultNotificationRenderer('NOT-04', 'kk', {})).toThrow('notification NOT-04: нет текста письма');
    expect(() => defaultNotificationRenderer('NOT-03', 'kk', { minutes: '15' })).toThrow(PermanentNotificationError);
    expect(
      defaultNotificationRenderer('NOT-03', 'en', { minutes: '15', link: 'https://imbc.local/login' }).subject,
    ).toBe('Your IMBC Platform account is temporarily locked');
  });
});

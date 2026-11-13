import 'reflect-metadata';
import type { Provider } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { MailService } from '../src/mail/mail.service.js';
import {
  defaultNotificationRenderer,
  NOTIFICATION_RENDERER,
  NotificationDispatcher,
} from '../src/notifications/dispatcher.js';
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
    // Внедрение по типу: почта — вторым параметром диспетчера, диспетчер — последним у JobHandlers.
    expect((Reflect.getMetadata('design:paramtypes', NotificationDispatcher) as unknown[])[1]).toBe(MailService);
    expect((Reflect.getMetadata('design:paramtypes', JobHandlers) as unknown[]).at(-1)).toBe(NotificationDispatcher);
  });

  it('письмо без текста — ошибка задания, а не пустое письмо: NOT-04 до своего этапа', () => {
    expect(() => defaultNotificationRenderer('NOT-04', 'kk', {})).toThrow('notification NOT-04: нет текста письма');
    expect(
      defaultNotificationRenderer('NOT-03', 'en', { minutes: '15', link: 'https://imbc.local/login' }).subject,
    ).toBe('Your IMBC Platform account is temporarily locked');
  });
});

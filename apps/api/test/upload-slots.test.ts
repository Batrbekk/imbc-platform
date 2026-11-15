import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { UploadSlots } from '../src/modules/files/upload-slots.js';

describe('одновременные загрузки до чтения тела (DATA-06, NFR-09)', () => {
  it('два места на аккаунт и четыре на процесс; личный предел проверяется первым', () => {
    const slots = new UploadSlots({ process: 4, account: 2 });
    const a1 = slots.tryAcquire('account-a');
    const a2 = slots.tryAcquire('account-a');
    expect(a1).not.toBeTypeOf('string');
    expect(a2).not.toBeTypeOf('string');
    expect(slots.tryAcquire('account-a')).toBe('account_limit');

    const b = slots.tryAcquire('account-b');
    const c = slots.tryAcquire('account-c');
    expect(b).not.toBeTypeOf('string');
    expect(c).not.toBeTypeOf('string');
    expect(slots.inUse).toBe(4);
    expect(slots.tryAcquire('account-a')).toBe('account_limit');
    expect(slots.tryAcquire('account-d')).toBe('busy');
    expect(slots.inUse).toBe(4);
  });

  it('освобождение возвращает оба места; повторный release не освобождает более новую загрузку', () => {
    const slots = new UploadSlots({ process: 1, account: 1 });
    const first = slots.tryAcquire('account-a');
    if (typeof first === 'string') throw new Error('Первое место должно быть свободным');
    expect(slots.tryAcquire('account-a')).toBe('account_limit');
    expect(slots.tryAcquire('account-b')).toBe('busy');

    first.release();
    expect(slots.inUse).toBe(0);
    const second = slots.tryAcquire('account-a');
    if (typeof second === 'string') throw new Error('Освобождённое место должно быть доступным');
    first.release();
    expect(slots.inUse).toBe(1);
    expect(slots.tryAcquire('account-a')).toBe('account_limit');
    expect(slots.tryAcquire('account-b')).toBe('busy');

    second.release();
    second.release();
    expect(slots.inUse).toBe(0);
    expect(slots.tryAcquire('account-b')).not.toBeTypeOf('string');
  });

  it('места разных аккаунтов освобождаются независимо', () => {
    const slots = new UploadSlots({ process: 3, account: 1 });
    const a = slots.tryAcquire('account-a');
    const b = slots.tryAcquire('account-b');
    if (typeof a === 'string' || typeof b === 'string') throw new Error('Места должны быть свободными');
    a.release();
    expect(slots.inUse).toBe(1);
    expect(slots.tryAcquire('account-b')).toBe('account_limit');
    expect(slots.tryAcquire('account-a')).not.toBeTypeOf('string');
    b.release();
    expect(slots.inUse).toBe(1);
    expect(slots.tryAcquire('account-b')).not.toBeTypeOf('string');
  });
});

const source: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PUBLIC_URL: 'https://imbc.example',
  DATABASE_URL: 'postgresql://unused',
  S3_ENDPOINT: 'http://storage:9000',
  S3_ACCESS_KEY: 'unused',
  S3_SECRET_KEY: 'unused',
  OIDC_ISSUER: 'https://imbc.example/kc/realms/imbc',
  OIDC_CLIENT_SECRET: 'unused',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'unused',
  SESSION_SECRET: 'test-only-session-secret-with-32-characters',
};

describe('пределы памяти загрузок в конфигурации (DATA-06, NFR-09)', () => {
  it('по умолчанию четыре загрузки на процесс и две на аккаунт; допускаются заданные границы', () => {
    const defaults = loadEnv(source);
    expect(defaults.UPLOAD_CONCURRENCY).toBe(4);
    expect(defaults.UPLOAD_CONCURRENCY_PER_ACCOUNT).toBe(2);
    for (const [process, account] of [
      ['1', '1'],
      ['32', '8'],
    ]) {
      const env = loadEnv({ ...source, UPLOAD_CONCURRENCY: process, UPLOAD_CONCURRENCY_PER_ACCOUNT: account });
      expect(env.UPLOAD_CONCURRENCY).toBe(Number(process));
      expect(env.UPLOAD_CONCURRENCY_PER_ACCOUNT).toBe(Number(account));
    }
  });

  it.each([
    ['UPLOAD_CONCURRENCY', '0'],
    ['UPLOAD_CONCURRENCY', '33'],
    ['UPLOAD_CONCURRENCY', '2.5'],
    ['UPLOAD_CONCURRENCY', ''],
    ['UPLOAD_CONCURRENCY_PER_ACCOUNT', '0'],
    ['UPLOAD_CONCURRENCY_PER_ACCOUNT', '9'],
    ['UPLOAD_CONCURRENCY_PER_ACCOUNT', '1.5'],
    ['UPLOAD_CONCURRENCY_PER_ACCOUNT', 'unlimited'],
  ])('%s=%s — ошибочная конфигурация останавливает старт', (key, value) => {
    expect(() => loadEnv({ ...source, [key]: value })).toThrow(key);
  });
});

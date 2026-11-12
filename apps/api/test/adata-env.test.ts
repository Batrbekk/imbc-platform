import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

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

describe('Конфигурация коннектора Adata (EXT-02, NFR-10)', () => {
  it('пустой токен — коннектор выключен, лимит по умолчанию 3000', () => {
    for (const token of [undefined, '']) {
      const env = loadEnv({ ...source, ADATA_API_TOKEN: token });
      expect(env.ADATA_API_TOKEN).toBeUndefined();
      expect(env.ADATA_MONTHLY_LIMIT).toBe(3000);
    }
    const token = randomBytes(16).toString('hex');
    const env = loadEnv({ ...source, ADATA_API_TOKEN: ` ${token} `, ADATA_MONTHLY_LIMIT: '0' });
    expect(env.ADATA_API_TOKEN === token).toBe(true);
    expect(env.ADATA_MONTHLY_LIMIT).toBe(0);
  });

  it('токен из одних пробелов — коннектор выключен, worker стартует (EXT-02)', () => {
    for (const token of [' ', '   ', '\t', ' \n\t ']) {
      const env = loadEnv({ ...source, ADATA_API_TOKEN: token });
      expect(env.ADATA_API_TOKEN).toBeUndefined();
    }
  });

  it('лимит: пустая строка — по умолчанию 3000; больше 3000 — ошибка конфигурации (IMBC-07)', () => {
    expect(loadEnv({ ...source, ADATA_MONTHLY_LIMIT: '' }).ADATA_MONTHLY_LIMIT).toBe(3000);
    expect(loadEnv({ ...source, ADATA_MONTHLY_LIMIT: '3000' }).ADATA_MONTHLY_LIMIT).toBe(3000);
    expect(loadEnv({ ...source, ADATA_MONTHLY_LIMIT: '25' }).ADATA_MONTHLY_LIMIT).toBe(25);
    for (const limit of ['3001', '30000'])
      expect(() => loadEnv({ ...source, ADATA_MONTHLY_LIMIT: limit })).toThrow(/ADATA_MONTHLY_LIMIT/);
  });

  it('отрицательный лимит — ошибка конфигурации, в тексте ошибки нет значения токена', () => {
    const token = randomBytes(16).toString('hex');
    for (const input of [
      { ADATA_API_TOKEN: token, ADATA_MONTHLY_LIMIT: '-1' },
      { ADATA_API_TOKEN: token, ADATA_MONTHLY_LIMIT: '2.5' },
      { ADATA_API_TOKEN: `${token}${'x'.repeat(512)}`, ADATA_MONTHLY_LIMIT: '-1' },
    ]) {
      let message = '';
      try {
        loadEnv({ ...source, ...input });
      } catch (error) {
        message = `${String(error)}\n${(error as Error).stack}`;
      }
      expect(message).toContain('Некорректная конфигурация окружения');
      expect(message).toContain('ADATA_MONTHLY_LIMIT');
      expect(message.includes(token), 'текст ошибки содержит токен').toBe(false);
    }
  });
});

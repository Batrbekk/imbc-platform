import { describe, expect, it } from 'vitest';
import { ROLES } from '@imbc/contracts';
import { loadEnv } from '../src/config/env.js';
import { otpDeliveryFor } from '../src/modules/auth/development-otp.js';

const accountId = '3e265c25-d7a5-41a8-8dab-220a81050c10';
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

describe('explicit development OTP configuration', () => {
  it('defaults to production deployment and normal email delivery, independently of NODE_ENV', () => {
    const env = loadEnv({ ...source, NODE_ENV: 'development', DEV_FIXED_OTP_USER_ID: '' });
    expect(env.DEPLOYMENT_ENV).toBe('production');
    expect(env.DEV_FIXED_OTP_ENABLED).toBe(false);
    expect(env.DEV_FIXED_OTP_ACCOUNTS).toEqual([]);
    expect(otpDeliveryFor(env, { id: accountId, role: 'administrator' })).toBe('email');
  });

  it.each([
    { DEV_FIXED_OTP_ENABLED: 'true', DEV_FIXED_OTP_USER_ID: accountId },
    { DEPLOYMENT_ENV: 'production', DEV_FIXED_OTP_ENABLED: 'true', DEV_FIXED_OTP_USER_ID: accountId },
    { DEPLOYMENT_ENV: 'development', DEV_FIXED_OTP_ENABLED: 'true' },
    { DEPLOYMENT_ENV: 'development', DEV_FIXED_OTP_ENABLED: 'true', DEV_FIXED_OTP_USER_ID: 'not-a-uuid' },
    { DEPLOYMENT_ENV: 'development', DEV_FIXED_OTP_ENABLED: 'yes', DEV_FIXED_OTP_USER_ID: accountId },
  ])('rejects an unsafe or incomplete fixed-code configuration %#', (input) => {
    expect(() => loadEnv({ ...source, ...input })).toThrow('Некорректная конфигурация окружения');
  });

  it('requires every scope condition even when NODE_ENV uses production optimizations', () => {
    const env = loadEnv({
      ...source,
      DEPLOYMENT_ENV: 'development',
      DEV_FIXED_OTP_ENABLED: 'true',
      DEV_FIXED_OTP_USER_ID: accountId.toUpperCase(),
    });
    const admin = { id: accountId, role: 'administrator' as const };
    expect(otpDeliveryFor(env, admin)).toBe('development_code');
    expect(otpDeliveryFor({ ...env, DEPLOYMENT_ENV: 'production' }, admin)).toBe('email');
    expect(otpDeliveryFor({ ...env, DEV_FIXED_OTP_ENABLED: false }, admin)).toBe('email');
    expect(otpDeliveryFor({ ...env, DEV_FIXED_OTP_USER_ID: undefined }, admin)).toBe('email');
    expect(otpDeliveryFor(env, { ...admin, id: '09544cc6-ef1f-41fb-916e-cab7f50da4dc' })).toBe('email');
    expect(otpDeliveryFor(env, { ...admin, role: 'operator' })).toBe('email');
  });

  it.each(ROLES)('allows only the exact configured UUID and %s role', (role) => {
    const env = loadEnv({
      ...source,
      DEPLOYMENT_ENV: 'development',
      DEV_FIXED_OTP_ENABLED: 'true',
      DEV_FIXED_OTP_ACCOUNTS: JSON.stringify([{ id: accountId.toUpperCase(), role }]),
    });
    const account = { id: accountId, role };
    expect(env.DEV_FIXED_OTP_ACCOUNTS).toEqual([account]);
    expect(otpDeliveryFor(env, account)).toBe('development_code');
    for (const differentRole of ROLES.filter((candidate) => candidate !== role))
      expect(otpDeliveryFor(env, { ...account, role: differentRole })).toBe('email');
    expect(otpDeliveryFor(env, { ...account, id: '09544cc6-ef1f-41fb-916e-cab7f50da4dc' })).toBe('email');
    expect(otpDeliveryFor({ ...env, DEV_FIXED_OTP_ENABLED: false }, account)).toBe('email');
    expect(otpDeliveryFor({ ...env, DEPLOYMENT_ENV: 'production' }, account)).toBe('email');
  });

  it('accepts the legacy spectator role name from a pre-v1.3 server .env as observer', () => {
    const env = loadEnv({
      ...source,
      DEPLOYMENT_ENV: 'development',
      DEV_FIXED_OTP_ENABLED: 'true',
      DEV_FIXED_OTP_ACCOUNTS: JSON.stringify([{ id: accountId, role: 'spectator' }]),
    });
    expect(env.DEV_FIXED_OTP_ACCOUNTS).toEqual([{ id: accountId, role: 'observer' }]);
    expect(otpDeliveryFor(env, { id: accountId, role: 'observer' })).toBe('development_code');
  });

  it('combines listed accounts with the separate administrator-only legacy setting', () => {
    const listedId = '09544cc6-ef1f-41fb-916e-cab7f50da4dc';
    const env = loadEnv({
      ...source,
      DEPLOYMENT_ENV: 'development',
      DEV_FIXED_OTP_ENABLED: 'true',
      DEV_FIXED_OTP_USER_ID: accountId,
      DEV_FIXED_OTP_ACCOUNTS: JSON.stringify([{ id: listedId, role: 'expert' }]),
    });
    expect(otpDeliveryFor(env, { id: listedId, role: 'expert' })).toBe('development_code');
    expect(otpDeliveryFor(env, { id: accountId, role: 'administrator' })).toBe('development_code');
    expect(otpDeliveryFor(env, { id: accountId, role: 'expert' })).toBe('email');
    expect(otpDeliveryFor(env, { id: listedId, role: 'administrator' })).toBe('email');
  });

  it.each([
    '{',
    '{}',
    'null',
    '["not-an-account"]',
    JSON.stringify([{ id: 'not-a-uuid', role: 'operator' }]),
    JSON.stringify([{ id: accountId, role: 'viewer' }]),
    JSON.stringify([{ id: accountId }]),
    JSON.stringify([{ role: 'operator' }]),
    JSON.stringify([{ id: accountId, role: 'operator', email: 'unused@example.invalid' }]),
    JSON.stringify([
      { id: accountId, role: 'operator' },
      { id: accountId, role: 'operator' },
    ]),
    JSON.stringify([
      { id: accountId, role: 'operator' },
      { id: accountId.toUpperCase(), role: 'director' },
    ]),
  ])('rejects malformed or ambiguous account configuration even with the feature disabled %#', (value) => {
    expect(() => loadEnv({ ...source, DEV_FIXED_OTP_ACCOUNTS: value })).toThrow('Некорректная конфигурация окружения');
  });

  it('rejects a collision with the legacy UUID and production enablement for a list-only configuration', () => {
    const list = JSON.stringify([{ id: accountId.toUpperCase(), role: 'administrator' }]);
    expect(() => loadEnv({ ...source, DEV_FIXED_OTP_USER_ID: accountId, DEV_FIXED_OTP_ACCOUNTS: list })).toThrow(
      'legacy administrator',
    );
    expect(() => loadEnv({ ...source, DEV_FIXED_OTP_ENABLED: 'true', DEV_FIXED_OTP_ACCOUNTS: list })).toThrow(
      'development deployment tier',
    );
  });
});

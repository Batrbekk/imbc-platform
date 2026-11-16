import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { KeycloakAdminService } from '../src/modules/auth/keycloak-admin.service.js';

const subject = 'initial-subject';
const email = 'manufacturer@initial.local';
const user = { id: subject, email, username: email, enabled: true, requiredActions: ['UPDATE_PASSWORD'] };
const env = {
  OIDC_ISSUER: 'https://identity.local/realms/imbc',
  KEYCLOAK_REALM: 'imbc',
  KEYCLOAK_ADMIN_CLIENT_ID: 'synthetic-test',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'synthetic-not-a-secret',
} as Env;

function fixture(credentials: unknown, representation: unknown = user, failure?: 'credentials' | 'user') {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path.endsWith('/token')) return Response.json({ access_token: 'synthetic-token', expires_in: 60 });
    if (path.endsWith('/credentials'))
      return Response.json(credentials, { status: failure === 'credentials' ? 503 : 200 });
    if (path.endsWith(`/users/${subject}`))
      return Response.json(representation, { status: failure === 'user' ? 503 : 200 });
    throw new Error('Unexpected fixture request');
  });
  vi.stubGlobal('fetch', fetcher);
  return { service: new KeycloakAdminService(env), fetcher };
}
afterEach(() => vi.unstubAllGlobals());

describe('MAN-02 strict initial-password evidence', () => {
  it.each([
    { type: 'password' },
    { type: 'password', createdDate: null },
    { type: 'password', createdDate: 'unknown' },
    { type: 'password', createdDate: Number.MAX_VALUE },
    { type: 'password', createdDate: 1 },
  ])('a password exists independently of createdDate: %j', async (credential) => {
    const { service, fetcher } = fixture([credential, {}]);
    expect(await service.hasPasswordCredential(subject)).toBe(true);
    expect(await service.awaitingInitialPasswordSetup(subject, email)).toBe(false);
    expect(fetcher.mock.calls.some(([path]) => String(path).endsWith(`/users/${subject}`))).toBe(false);
  });
  it.each([null, {}, 'unknown', [null], [{}], [{ type: '' }], [{ type: 2 }], [[]]])(
    'unknown credentials do not prove absence: %j',
    async (credentials) => {
      await expect(fixture(credentials).service.awaitingInitialPasswordSetup(subject, email)).rejects.toThrow();
    },
  );
  it('accepts well-formed password-free credentials only with matching enabled initial IdP identity', async () => {
    expect(await fixture([]).service.awaitingInitialPasswordSetup(subject, email.toUpperCase())).toBe(true);
    expect(await fixture([{ type: 'otp' }]).service.awaitingInitialPasswordSetup(subject, email)).toBe(true);
  });
  it.each([
    { ...user, id: 'other-subject' },
    { ...user, email: 'other@initial.local' },
    { ...user, username: 'other@initial.local' },
    { ...user, enabled: false },
    { ...user, requiredActions: [] },
  ])('known non-initial IdP identity refuses reuse: %j', async (representation) => {
    expect(await fixture([], representation).service.awaitingInitialPasswordSetup(subject, email)).toBe(false);
  });
  it.each([null, [], {}, { ...user, requiredActions: null }, { ...user, requiredActions: [1] }])(
    'malformed identity does not prove an initial invitation: %j',
    async (representation) => {
      await expect(fixture([], representation).service.awaitingInitialPasswordSetup(subject, email)).rejects.toThrow();
    },
  );
  it.each(['credentials', 'user'] as const)('IdP %s transport failure is not password absence', async (failure) => {
    await expect(fixture([], user, failure).service.awaitingInitialPasswordSetup(subject, email)).rejects.toThrow();
  });
});

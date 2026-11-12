import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { OidcService } from '../src/modules/auth/oidc.service.js';

describe('signed OIDC backchannel logout', () => {
  const issuer = 'https://imbc.example/kc/realms/imbc';
  let server: Server;
  let oidc: OidcService;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  let otherKeys: Awaited<ReturnType<typeof generateKeyPair>>;
  const event = { 'http://schemas.openid.net/event/backchannel-logout': {} };

  beforeAll(async () => {
    keys = await generateKeyPair('RS256');
    otherKeys = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
    server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    oidc = new OidcService({
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: 'imbc-bff',
      PUBLIC_URL: 'https://imbc.example',
      OIDC_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
    } as Env);
    vi.spyOn(oidc, 'configuration').mockResolvedValue({
      serverMetadata: () => ({
        jwks_uri: issuer + '/protocol/openid-connect/certs',
        end_session_endpoint: issuer + '/protocol/openid-connect/logout',
      }),
    } as never);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const token = async (overrides: Record<string, unknown> = {}, wrongKey = false) =>
    new SignJWT({
      iss: issuer,
      aud: 'imbc-bff',
      iat: Math.floor(Date.now() / 1000),
      jti: 'test-notification',
      sid: 'idp-session-one',
      sub: 'subject-one',
      events: event,
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .sign(wrongKey ? otherKeys.privateKey : keys.privateKey);

  it('accepts only a signed notification for this issuer and client', async () => {
    expect(await oidc.verifyLogoutToken(await token())).toEqual({
      jti: 'test-notification',
      sid: 'idp-session-one',
      sub: 'subject-one',
      iat: expect.any(Number),
    });
  });

  it.each([
    { iss: 'https://other.invalid' },
    { aud: 'another-client' },
    { nonce: 'not-allowed' },
    { events: {} },
    { events: { 'http://schemas.openid.net/event/backchannel-logout': true } },
    { sid: undefined, sub: undefined },
    { sid: '' },
    { jti: '' },
    { iat: Math.floor(Date.now() / 1000) - 600 },
    { exp: Math.floor(Date.now() / 1000) - 60 },
  ])('rejects invalid notification claims', async (overrides) => {
    await expect(oidc.verifyLogoutToken(await token(overrides))).rejects.toThrow();
  });

  it('rejects an otherwise valid notification signed by another key', async () => {
    await expect(oidc.verifyLogoutToken(await token({}, true))).rejects.toThrow();
  });

  it('uses the supported reset entry and restarts PKCE at the BFF after reset', () => {
    const url = oidc.passwordResetUrl('ru');
    expect(url.origin).toBe('https://imbc.example');
    expect(url.pathname).toBe('/kc/realms/imbc/login-actions/reset-credentials');
    expect(url.searchParams.get('redirect_uri')).toBe('https://imbc.example/api/auth/login');
    expect(url.searchParams.get('client_id')).toBe('imbc-bff');
  });

  it('posts RP logout server-to-server without placing the ID token in a URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'https://imbc.example/' },
      }),
    );
    try {
      await expect(oidc.logout('server-only-test-token')).resolves.toBeUndefined();
      const [url, options] = fetchMock.mock.calls[0]!;
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(String(url)).not.toContain('server-only-test-token');
      expect(options?.method).toBe('POST');
      expect(new URLSearchParams(String(options?.body)).get('id_token_hint')).toBe('server-only-test-token');
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      await expect(oidc.logout('server-only-test-token')).rejects.toThrow();
    } finally {
      fetchMock.mockRestore();
    }
  });
});

import { Inject, Injectable } from '@nestjs/common';
import * as client from 'openid-client';
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ENV, type Env } from '../../config/env.js';

/**
 * OIDC-клиент BFF (Authorization Code + PKCE, ADR-04). Токены не покидают сервер.
 * Браузер ходит к провайдеру по публичному адресу, API — по внутреннему:
 * customFetch подменяет origin публичного issuer на OIDC_INTERNAL_URL.
 */
@Injectable()
export class OidcService {
  private config?: Promise<client.Configuration>;
  private logoutKeys?: JWTVerifyGetKey;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get redirectUri(): string {
    return new URL('/api/auth/callback', this.env.PUBLIC_URL).toString();
  }

  configuration(): Promise<client.Configuration> {
    this.config ??= this.discover().catch((error: unknown) => {
      this.config = undefined;
      throw error;
    });
    return this.config;
  }

  private async discover(): Promise<client.Configuration> {
    const fetchImpl = this.internalFetch();
    const insecure =
      new URL(this.env.OIDC_ISSUER).protocol === 'http:' || this.env.OIDC_INTERNAL_URL?.startsWith('http:');
    const config = await client.discovery(
      new URL(this.env.OIDC_ISSUER),
      this.env.OIDC_CLIENT_ID,
      undefined,
      client.ClientSecretPost(this.env.OIDC_CLIENT_SECRET),
      {
        [client.customFetch]: fetchImpl,
        execute: insecure ? [client.allowInsecureRequests] : [],
        timeout: 5,
      },
    );
    config[client.customFetch] = fetchImpl;
    return config;
  }

  private internalFetch(): client.CustomFetch {
    const internal = this.env.OIDC_INTERNAL_URL;
    const publicOrigin = new URL(this.env.OIDC_ISSUER).origin;
    return (url, options) => {
      const target =
        internal && url.startsWith(publicOrigin) ? url.replace(publicOrigin, new URL(internal).origin) : url;
      return fetch(target, options as RequestInit);
    };
  }

  async authorizationUrl(params: {
    state: string;
    codeChallenge: string;
    locale: string;
    prompt?: 'login';
  }): Promise<URL> {
    return client.buildAuthorizationUrl(await this.configuration(), {
      redirect_uri: this.redirectUri,
      scope: 'openid email profile',
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      state: params.state,
      ui_locales: params.locale,
      max_age: '43200',
      ...(params.prompt ? { prompt: params.prompt } : {}),
    });
  }

  async exchange(currentUrl: URL, checks: { codeVerifier: string; state: string }) {
    const tokens = await client.authorizationCodeGrant(await this.configuration(), currentUrl, {
      pkceCodeVerifier: checks.codeVerifier,
      expectedState: checks.state,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error('Провайдер не вернул id_token');
    return {
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' ? claims.name : null,
      idToken: tokens.id_token ?? null,
      sessionId: typeof claims.sid === 'string' ? claims.sid : null,
      authTime: new Date((typeof claims.auth_time === 'number' ? claims.auth_time : 0) * 1000),
    };
  }

  /** Keycloak supports direct reset entry; return starts a fresh PKCE login. */
  passwordResetUrl(locale: string): URL {
    const issuer = new URL(this.env.OIDC_ISSUER);
    const url = new URL(`${issuer.pathname}/login-actions/reset-credentials`, issuer.origin);
    url.search = new URLSearchParams({
      client_id: this.env.OIDC_CLIENT_ID,
      redirect_uri: new URL('/api/auth/login', this.env.PUBLIC_URL).toString(),
      kc_locale: locale,
    }).toString();
    return url;
  }

  /** Verify Keycloak's signed OIDC Back-Channel Logout token, never a browser token. */
  async verifyLogoutToken(token: string): Promise<{ jti: string; iat: number; sid?: string; sub?: string }> {
    if (!this.logoutKeys) {
      const metadata = (await this.configuration()).serverMetadata();
      if (!metadata.jwks_uri) throw new Error('OIDC provider has no JWKS endpoint');
      const fetchInternal = this.internalFetch();
      this.logoutKeys = createRemoteJWKSet(new URL(metadata.jwks_uri), {
        [customFetch]: (url, options) =>
          fetchInternal(String(url), {
            ...options,
            body: undefined,
            headers: Object.fromEntries(options.headers.entries()),
          }),
        timeoutDuration: 5000,
      });
    }
    const { payload } = await jwtVerify(token, this.logoutKeys, {
      issuer: this.env.OIDC_ISSUER,
      audience: this.env.OIDC_CLIENT_ID,
      algorithms: ['RS256', 'PS256', 'ES256'],
      requiredClaims: ['iat', 'jti'],
      maxTokenAge: '5 minutes',
      clockTolerance: 30,
    });
    const events = payload.events as Record<string, unknown> | undefined;
    const logoutEvent = events?.['http://schemas.openid.net/event/backchannel-logout'];
    if (
      typeof payload.jti !== 'string' ||
      !payload.jti ||
      'nonce' in payload ||
      typeof logoutEvent !== 'object' ||
      logoutEvent === null ||
      Array.isArray(logoutEvent) ||
      Object.keys(logoutEvent).length !== 0 ||
      (!payload.sid && !payload.sub) ||
      (payload.sid !== undefined && (typeof payload.sid !== 'string' || !payload.sid)) ||
      (payload.sub !== undefined && (typeof payload.sub !== 'string' || !payload.sub))
    ) {
      throw new Error('Invalid logout token claims');
    }
    return {
      jti: payload.jti,
      iat: payload.iat!,
      ...(typeof payload.sid === 'string' ? { sid: payload.sid } : {}),
      ...(payload.sub ? { sub: payload.sub } : {}),
    };
  }

  async logout(idTokenHint: string | null): Promise<void> {
    if (!idTokenHint) throw new Error('Session has no ID token for RP logout');
    const endpoint = (await this.configuration()).serverMetadata().end_session_endpoint;
    if (!endpoint) throw new Error('OIDC provider has no logout endpoint');
    const response = await this.internalFetch()(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        id_token_hint: idTokenHint,
        client_id: this.env.OIDC_CLIENT_ID,
        post_logout_redirect_uri: this.env.PUBLIC_URL,
      }).toString(),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    const location = response.headers.get('location');
    if (
      ![302, 303].includes(response.status) ||
      !location ||
      new URL(location).origin !== new URL(this.env.PUBLIC_URL).origin
    ) {
      throw new Error('OIDC logout did not confirm completion');
    }
  }

  static newPkce() {
    const codeVerifier = client.randomPKCECodeVerifier();
    return { codeVerifier, state: client.randomState(), challenge: client.calculatePKCECodeChallenge(codeVerifier) };
  }
}

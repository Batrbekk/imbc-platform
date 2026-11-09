import { Inject, Injectable } from '@nestjs/common';
import * as client from 'openid-client';
import { ENV, type Env } from '../../config/env.js';

/**
 * OIDC-клиент BFF (Authorization Code + PKCE, ADR-04). Токены не покидают сервер.
 * Браузер ходит к провайдеру по публичному адресу, API — по внутреннему:
 * customFetch подменяет origin публичного issuer на OIDC_INTERNAL_URL.
 */
@Injectable()
export class OidcService {
  private config?: Promise<client.Configuration>;

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

  async authorizationUrl(params: { state: string; codeChallenge: string; locale: string }): Promise<URL> {
    return client.buildAuthorizationUrl(await this.configuration(), {
      redirect_uri: this.redirectUri,
      scope: 'openid email profile',
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
      state: params.state,
      ui_locales: params.locale,
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
      name: typeof claims.name === 'string' ? claims.name : null,
      idToken: tokens.id_token ?? null,
    };
  }

  async endSessionUrl(idTokenHint: string | null): Promise<string> {
    const params: Record<string, string> = { post_logout_redirect_uri: this.env.PUBLIC_URL };
    if (idTokenHint) params.id_token_hint = idTokenHint;
    return client.buildEndSessionUrl(await this.configuration(), params).toString();
  }

  static newPkce() {
    const codeVerifier = client.randomPKCECodeVerifier();
    return { codeVerifier, state: client.randomState(), challenge: client.calculatePKCECodeChallenge(codeVerifier) };
  }
}

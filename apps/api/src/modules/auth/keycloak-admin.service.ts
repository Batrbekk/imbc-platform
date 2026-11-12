import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';

/** Срок ссылки установки пароля — 72 часа (AUTH-01). */
export const PASSWORD_LINK_LIFESPAN_S = 72 * 60 * 60;

export class KeycloakRequestError extends Error {
  constructor(
    readonly status: number,
    operation: string,
  ) {
    super(`Keycloak ${operation}: ${status}`);
  }
}

export interface KeycloakEvent {
  id?: string;
  time: number;
  userId?: string;
  type: string;
  error?: string;
  details?: Record<string, string>;
}

/**
 * Минимальный клиент Keycloak Admin REST API (сервисный клиент imbc-admin-api,
 * роли realm-management: manage-users, view-users). Keycloak остаётся стандартным,
 * без Java-расширений (ADR-20): регистрация и приглашения идут через этот клиент.
 */
@Injectable()
export class KeycloakAdminService {
  private readonly logger = new Logger(KeycloakAdminService.name);
  private token?: { value: string; expiresAt: number };

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** База Keycloak внутри сети: origin из OIDC_INTERNAL_URL + путь из публичного issuer до /realms/. */
  private get base(): string {
    const issuer = new URL(this.env.OIDC_ISSUER);
    const path = issuer.pathname.split('/realms/')[0] ?? '';
    const origin = this.env.OIDC_INTERNAL_URL ? new URL(this.env.OIDC_INTERNAL_URL).origin : issuer.origin;
    return `${origin}${path}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) return this.token.value;
    const response = await fetch(`${this.base}/realms/${this.env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.env.KEYCLOAK_ADMIN_CLIENT_ID,
        client_secret: this.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Keycloak token: ${response.status}`);
    const json = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(`${this.base}/admin/realms/${this.env.KEYCLOAK_REALM}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(10000),
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
    return response;
  }

  /** Создаёт пользователя и возвращает его id (sub). Пароль задаётся только по ссылке из письма. */
  async createUser(input: { email: string; firstName?: string; locale: string }): Promise<string> {
    const response = await this.call('/users', {
      method: 'POST',
      body: JSON.stringify({
        username: input.email.toLowerCase(),
        email: input.email.toLowerCase(),
        firstName: input.firstName,
        enabled: true,
        emailVerified: false,
        requiredActions: ['VERIFY_EMAIL', 'UPDATE_PASSWORD'],
        attributes: { locale: [input.locale] },
      }),
    });
    if (!response.ok) throw new KeycloakRequestError(response.status, 'create user');
    const location = response.headers.get('location');
    const id = location?.split('/').pop();
    if (!id) throw new Error('Keycloak не вернул id пользователя');
    return id;
  }

  /** Письмо NOT-01 со ссылкой установки пароля (AUTH-01). Один поток для регистрации и приглашения. */
  async sendPasswordEmail(userId: string): Promise<void> {
    const params = new URLSearchParams({
      lifespan: String(PASSWORD_LINK_LIFESPAN_S),
      client_id: this.env.OIDC_CLIENT_ID,
      redirect_uri: new URL('/api/auth/login', this.env.PUBLIC_URL).toString(),
    });
    const response = await this.call(`/users/${userId}/execute-actions-email?${params}`, {
      method: 'PUT',
      body: JSON.stringify(['VERIFY_EMAIL', 'UPDATE_PASSWORD']),
    });
    if (!response.ok) throw new Error(`Keycloak execute-actions-email: ${response.status}`);
  }

  /** Неактивность после трёх месяцев (AUTH-07): пароль задаётся заново. */
  async requirePasswordReset(userId: string): Promise<void> {
    const response = await this.call(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ requiredActions: ['UPDATE_PASSWORD'] }),
    });
    if (!response.ok) throw new Error(`Keycloak required action: ${response.status}`);
  }

  /** Блокировка: отключить пользователя и завершить его сеансы в IdP (AUTH-06). */
  async disableUser(userId: string): Promise<void> {
    await this.call(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    await this.call(`/users/${userId}/logout`, { method: 'POST' });
  }

  async deleteUser(userId: string): Promise<void> {
    const response = await this.call(`/users/${userId}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new KeycloakRequestError(response.status, 'delete user');
  }

  async securityEvents(since: Date): Promise<KeycloakEvent[]> {
    const events: KeycloakEvent[] = [];
    const types = ['UPDATE_PASSWORD', 'RESET_PASSWORD', 'UPDATE_CREDENTIAL', 'USER_DISABLED_BY_TEMPORARY_LOCKOUT'];
    for (let first = 0; ; first += 500) {
      const params = new URLSearchParams({
        dateFrom: since.toISOString().slice(0, 10),
        first: String(first),
        max: '500',
      });
      for (const type of types) params.append('type', type);
      const response = await this.call(`/events?${params}`);
      if (!response.ok) throw new KeycloakRequestError(response.status, 'events');
      const page = (await response.json()) as KeycloakEvent[];
      events.push(...page.filter((event) => event.time >= since.getTime()));
      if (page.length < 500) return events;
    }
  }

  /** События входа за сутки (AUTH-04): нужна роль realm-management view-events. */
  async lockoutEvents(since: Date): Promise<Array<{ time: number; userId?: string; type: string }>> {
    const params = new URLSearchParams({
      type: 'USER_DISABLED_BY_TEMPORARY_LOCKOUT',
      dateFrom: since.toISOString().slice(0, 10),
      max: '500',
    });
    const response = await this.call(`/events?${params}`);
    if (!response.ok) throw new Error(`Keycloak events: ${response.status}`);
    return (await response.json()) as Array<{ time: number; userId?: string; type: string }>;
  }
}

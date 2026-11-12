import {
  type AdminAccountResult,
  type AdminOrganizationResult,
  can,
  type ImbcMailboxResult,
  ROLES,
} from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { AccountsController } from '../src/modules/admin/accounts.controller.js';
import { AccountsService } from '../src/modules/admin/accounts.service.js';
import { InvitationsService } from '../src/modules/admin/invitations.service.js';
import { OrganizationsController } from '../src/modules/admin/organizations.controller.js';
import { OrganizationsService } from '../src/modules/admin/organizations.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP действий администратора: настоящий SessionGuard; права — из матрицы, accounts.manage (GEN-08, GEN-10).
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000010';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000011';

const ORGANIZATION: AdminOrganizationResult = {
  organization: { id: ORGANIZATION_ID, name: 'Оператор', type: 'operator', isMajorOperator: false },
};
const ACCOUNT: AdminAccountResult = {
  account: {
    id: ACCOUNT_ID,
    email: 'new@operator.local',
    fullName: 'Новый оператор',
    role: 'operator',
    state: 'invited',
    lastSignInAt: null,
  },
};
const MAILBOX: ImbcMailboxResult = { imbcMailbox: 'mail@imbc.local' };

const organizations = {
  create: vi.fn(async () => structuredClone(ORGANIZATION)),
  setMajorOperator: vi.fn(async () => structuredClone(ORGANIZATION)),
  setImbcMailbox: vi.fn(async () => structuredClone(MAILBOX)),
};
const invitations = {
  invite: vi.fn(async () => structuredClone(ACCOUNT)),
  resend: vi.fn(async () => ({ status: 'password_email_queued' as const })),
};
const accounts = { list: vi.fn() };

interface Route {
  method: 'POST' | 'PUT';
  path: string;
  body?: unknown;
  /** Тело, которое схема отклоняет (400 validation). */
  invalid?: unknown;
  status: number;
  response: unknown;
  service: Mock;
  /** Аргументы сервиса после исполнителя и до IP. */
  args: unknown[];
}

const ROUTES: Route[] = [
  {
    method: 'POST',
    path: '/api/v1/admin/organizations',
    body: { name: 'Оператор', type: 'operator' },
    invalid: { name: 'Оператор', type: 'manufacturer' },
    status: 201,
    response: ORGANIZATION,
    service: organizations.create,
    args: [{ name: 'Оператор', type: 'operator', isMajorOperator: false }],
  },
  {
    method: 'PUT',
    path: `/api/v1/admin/organizations/${ORGANIZATION_ID}/major-operator`,
    body: { isMajorOperator: true },
    invalid: { isMajorOperator: 'yes' },
    status: 200,
    response: ORGANIZATION,
    service: organizations.setMajorOperator,
    args: [ORGANIZATION_ID, true],
  },
  {
    method: 'PUT',
    path: '/api/v1/admin/imbc-mailbox',
    body: { email: 'Mail@IMBC.local' },
    invalid: { email: 'not-an-email' },
    status: 200,
    response: MAILBOX,
    service: organizations.setImbcMailbox,
    args: ['mail@imbc.local'],
  },
  {
    method: 'POST',
    path: '/api/v1/admin/accounts',
    body: {
      email: 'new@operator.local',
      fullName: 'Новый оператор',
      organizationId: ORGANIZATION_ID,
      role: 'operator',
    },
    invalid: { email: 'new@operator.local', fullName: 'Новый оператор', organizationId: ORGANIZATION_ID },
    status: 201,
    response: ACCOUNT,
    service: invitations.invite,
    args: [
      { email: 'new@operator.local', fullName: 'Новый оператор', organizationId: ORGANIZATION_ID, role: 'operator' },
    ],
  },
  {
    method: 'POST',
    path: `/api/v1/admin/accounts/${ACCOUNT_ID}/invitation`,
    status: 202,
    response: { status: 'password_email_queued' },
    service: invitations.resend,
    args: [ACCOUNT_ID],
  },
];

const ALLOWED = ROLES.filter((role) => can(role, 'accounts.manage'));
const DENIED = ROLES.filter((role) => !can(role, 'accounts.manage'));
const services = [...Object.values(organizations), ...Object.values(invitations)];

describe('действия администратора: организации, приглашения, ящик IMBC (ADM-01, ADM-03, GEN-08)', () => {
  let http: HttpStand;

  beforeAll(async () => {
    http = await startHttp({
      controllers: [OrganizationsController, AccountsController],
      providers: [
        { provide: OrganizationsService, useValue: organizations },
        { provide: InvitationsService, useValue: invitations },
        { provide: AccountsService, useValue: accounts },
      ],
    });
  });

  beforeEach(() => {
    for (const service of services) service.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    await http?.close();
  });

  it('матрица: accounts.manage — только у администратора (раздел 4, «Accounts of all organisations»)', () => {
    expect(ALLOWED).toEqual(['administrator']);
  });

  it.each(ROUTES.flatMap((route) => ALLOWED.map((role) => [route.method, route.path, role, route] as const)))(
    '%s %s: администратор — сервис вызван (%s)',
    async (method, path, role, route) => {
      const res = await http.send(method, path, role, route.body);
      expect(res.status).toBe(route.status);
      expect(await res.json()).toEqual(route.response);
      expect(route.service).toHaveBeenCalledOnce();
      expect(route.service).toHaveBeenCalledWith(
        expect.objectContaining({ role, id: '00000000-0000-4000-8000-0000000000a2' }),
        ...route.args,
        expect.any(String),
      );
      expect(http.audit.record).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES.flatMap((route) => DENIED.map((role) => [route.method, route.path, role, route] as const)))(
    "%s %s: %s — 403 problem+json, outcome 'denied' и action 'accounts.manage' в аудите, сервис не вызван (GEN-08)",
    async (method, path, role, route) => {
      const res = await http.send(method, path, role, route.body);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 403, code: 'forbidden' });
      expect(http.audit.record).toHaveBeenCalledOnce();
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied', action: 'accounts.manage', userId: expect.any(String) }),
      );
      for (const service of services) expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES.map((route) => [route.method, route.path, route] as const))(
    '%s %s: без сеанса — 401',
    async (method, path, route) => {
      const res = await http.send(method, path, undefined, route.body);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ status: 401, code: 'unauthenticated' });
      for (const service of services) expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES.map((route) => [route.method, route.path, route] as const))(
    '%s %s: чужой Origin — 403 bad_origin',
    async (method, path, route) => {
      const res = await fetch(`${http.base}${path}`, {
        method,
        headers: {
          origin: 'https://evil.example',
          'content-type': 'application/json',
          cookie: 'imbc-session=administrator',
        },
        body: route.body === undefined ? undefined : JSON.stringify(route.body),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ status: 403, code: 'bad_origin' });
      for (const service of services) expect(service).not.toHaveBeenCalled();
    },
  );

  it.each(
    ROUTES.filter((route) => route.invalid !== undefined).map((route) => [route.method, route.path, route] as const),
  )('%s %s: неверное тело — 400 validation, сервис не вызван', async (method, path, route) => {
    const res = await http.send(method, path, 'administrator', route.invalid);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: 400, code: 'validation' });
    for (const service of services) expect(service).not.toHaveBeenCalled();
  });
});

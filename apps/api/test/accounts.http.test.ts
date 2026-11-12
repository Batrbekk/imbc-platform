import { type AdminAccounts, adminAccountsSchema } from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountLifecycleService } from '../src/modules/admin/account-lifecycle.service.js';
import { AccountsController } from '../src/modules/admin/accounts.controller.js';
import { AccountsService } from '../src/modules/admin/accounts.service.js';
import { InvitationsService } from '../src/modules/admin/invitations.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP списка аккаунтов: настоящий SessionGuard, право accounts.manage только у администратора (GEN-08, ADM-02).
const ACCOUNTS: AdminAccounts = {
  organizations: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'IMBC',
      type: 'imbc',
      isMajorOperator: false,
      accounts: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          email: 'admin@imbc.local',
          fullName: 'Администратор IMBC',
          role: 'administrator',
          state: 'active',
          lastSignInAt: '2026-11-12T08:00:00.000Z',
        },
      ],
    },
  ],
  imbcMailbox: 'mail@imbc.local',
};

const list = vi.fn(async (): Promise<AdminAccounts> => structuredClone(ACCOUNTS));

describe('GET /api/v1/admin/accounts', () => {
  let http: HttpStand;
  const URL_PATH = '/api/v1/admin/accounts';

  beforeAll(async () => {
    http = await startHttp({
      controllers: [AccountsController],
      providers: [
        { provide: AccountsService, useValue: { list } },
        // Приглашения, блокировка, роль и почта — admin.http.test.ts.
        { provide: InvitationsService, useValue: {} },
        { provide: AccountLifecycleService, useValue: {} },
      ],
    });
  });

  beforeEach(() => {
    list.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    await http?.close();
  });

  it('администратор — 200', async () => {
    const res = await http.get(URL_PATH, 'administrator');
    expect(res.status).toBe(200);
    const body = (await res.json()) as object;
    expect(Object.keys(body)).toEqual(['organizations', 'imbcMailbox']);
    expect(adminAccountsSchema.parse(body)).toEqual(ACCOUNTS);
    expect(list).toHaveBeenCalledOnce();
  });

  it.each(['expert', 'director', 'operator', 'observer', 'manufacturer'] as const)(
    'SME, директор, оператор, наблюдатель, производитель — 403 и аудит (GEN-08): %s',
    async (role) => {
      const res = await http.get(URL_PATH, role);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 403, code: 'forbidden' });
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied', action: 'accounts.manage' }),
      );
      expect(list).not.toHaveBeenCalled();
    },
  );
});

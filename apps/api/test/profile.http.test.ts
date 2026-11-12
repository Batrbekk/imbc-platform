import { type OwnProfile, ownProfileSchema } from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemException } from '../src/common/problem.js';
import { parseResponse } from '../src/common/response.js';
import { ProfilesController } from '../src/modules/profiles/profiles.controller.js';
import { ProfilesService } from '../src/modules/profiles/profiles.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP своего профиля: настоящий SessionGuard, профиль только своей организации (GEN-08, GEN-11).
const MANUFACTURER_ORG = '00000000-0000-4000-8000-0000000000aa';
const IMBC_ORG = '00000000-0000-4000-8000-0000000000bb';
const PROFILE: OwnProfile = {
  profileId: '00000000-0000-4000-8000-000000000001',
  organizationName: 'ТОО «Демо Металл Конструкция»',
  bin: '240100000001',
  status: 'verified',
  hasPendingChanges: false,
  updateStatus: 'active',
  tier: 'tier_2',
  completenessPct: 100,
  registeredAt: '2026-10-01T10:00:00.000Z',
  verifiedAt: '2026-11-03T10:00:00.000Z',
};

/** Заглушка сервиса: профиль есть только у организации производителя. */
const own = vi.fn(async (organizationId: string): Promise<OwnProfile> => {
  if (organizationId === MANUFACTURER_ORG) return { ...PROFILE };
  throw new ProblemException(404, 'not_found', 'Профиль не найден');
});

describe('GET /api/v1/profiles/own', () => {
  let http: HttpStand;
  let imbc: HttpStand;
  const URL_PATH = '/api/v1/profiles/own';
  const providers = [{ provide: ProfilesService, useValue: { own } }];

  beforeAll(async () => {
    http = await startHttp({ controllers: [ProfilesController], providers, organizationId: MANUFACTURER_ORG });
    imbc = await startHttp({ controllers: [ProfilesController], providers, organizationId: IMBC_ORG });
  });

  beforeEach(() => {
    own.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    await http?.close();
    await imbc?.close();
  });

  it('производитель — 200, сервис вызван с его organizationId (GEN-11)', async () => {
    const res = await http.get(`${URL_PATH}?organizationId=${IMBC_ORG}`, 'manufacturer');
    expect(res.status).toBe(200);
    expect(ownProfileSchema.parse(await res.json())).toEqual(PROFILE);
    // Чужой id в запросе не принимается: ищется только организация сеанса.
    expect(own).toHaveBeenCalledExactlyOnceWith(MANUFACTURER_ORG);
  });

  it.each(['operator', 'observer', 'administrator'] as const)(
    '%s — 403 problem+json, отказ в аудите, сервис не вызван (GEN-08)',
    async (role) => {
      const res = await http.get(URL_PATH, role);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 403, code: 'forbidden' });
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied', action: 'profile.read' }),
      );
      expect(own).not.toHaveBeenCalled();
    },
  );

  it.each(['expert', 'director'] as const)('%s без профиля в организации — 404', async (role) => {
    const res = await imbc.get(URL_PATH, role);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await res.json()).toMatchObject({ status: 404, code: 'not_found' });
    expect(own).toHaveBeenCalledExactlyOnceWith(IMBC_ORG);
  });

  it('ответ сервиса не проходит схему — 500 problem+json без списка полей', async () => {
    own.mockImplementationOnce(async () => parseResponse(ownProfileSchema, { ...PROFILE, bin: null }, 'свой профиль'));
    const res = await http.get(URL_PATH, 'manufacturer');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ status: 500, code: 'internal' });
    expect(Object.keys(body)).not.toContain('errors');
    expect(JSON.stringify(body)).not.toContain('bin');
  });
});

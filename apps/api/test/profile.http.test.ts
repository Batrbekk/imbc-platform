import { type OwnAdataRead, ownAdataReadSchema, type OwnProfile, ownProfileSchema } from '@imbc/contracts';
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

/** Полученное чтение Adata: ФИО руководителя — персональные данные, видит только производитель (GEN-11). */
const READ: OwnAdataRead = {
  state: 'received',
  requestedAt: '2026-11-12T09:00:00.000Z',
  readAt: '2026-11-12T09:01:30.000Z',
  fields: [
    {
      field: 'director_full_name',
      source: 'adata',
      readAt: '2026-11-12T09:01:30.000Z',
      items: [{ value: 'Тестов Тест Тестович', label: null }],
    },
  ],
};

const ownAdata = vi.fn(async (organizationId: string): Promise<OwnAdataRead> => {
  if (organizationId === MANUFACTURER_ORG) return structuredClone(READ);
  throw new ProblemException(404, 'not_found', 'Профиль не найден');
});

const providers = [{ provide: ProfilesService, useValue: { own, ownAdata } }];

describe('GET /api/v1/profiles/own', () => {
  let http: HttpStand;
  let imbc: HttpStand;
  const URL_PATH = '/api/v1/profiles/own';

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

// Чтение Adata своего профиля: только производитель и только своя организация (GEN-08, GEN-11, ADM-06).
describe('GET /api/v1/profiles/own/adata', () => {
  let http: HttpStand;
  let imbc: HttpStand;
  const URL_PATH = '/api/v1/profiles/own/adata';
  /** Строка-сторож токена Adata: её нет ни в одном ответе (EXT-02). */
  const TOKEN = 'adata-token-sentinel-5b7e1c94';

  beforeAll(async () => {
    vi.stubEnv('ADATA_API_TOKEN', TOKEN);
    http = await startHttp({ controllers: [ProfilesController], providers, organizationId: MANUFACTURER_ORG });
    imbc = await startHttp({ controllers: [ProfilesController], providers, organizationId: IMBC_ORG });
  });

  beforeEach(() => {
    ownAdata.mockClear();
    own.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await http?.close();
    await imbc?.close();
  });

  it('производитель — 200, сервис вызван с его organizationId (GEN-11)', async () => {
    const res = await http.get(`${URL_PATH}?organizationId=${IMBC_ORG}&profileId=${PROFILE.profileId}`, 'manufacturer');
    expect(res.status).toBe(200);
    expect(ownAdataReadSchema.parse(await res.json())).toEqual(READ);
    // Чужой id в запросе не принимается: ищется только организация сеанса.
    expect(ownAdata).toHaveBeenCalledExactlyOnceWith(MANUFACTURER_ORG);
    expect(own).not.toHaveBeenCalled();
  });

  it.each(['operator', 'observer', 'administrator'] as const)(
    '%s — 403 problem+json, отказ в аудите, сервис не вызван (GEN-08, ADM-06)',
    async (role) => {
      const res = await http.get(URL_PATH, role);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      const body = await res.text();
      expect(JSON.parse(body)).toMatchObject({ status: 403, code: 'forbidden' });
      expect(body).not.toContain('Тестов');
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied', action: 'profile.read' }),
      );
      expect(ownAdata).not.toHaveBeenCalled();
    },
  );

  it.each(['expert', 'director'] as const)('%s без профиля в организации — 404', async (role) => {
    const res = await imbc.get(URL_PATH, role);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await res.json()).toMatchObject({ status: 404, code: 'not_found' });
    expect(ownAdata).toHaveBeenCalledExactlyOnceWith(IMBC_ORG);
  });

  it('ответ чтения и problem+json без токена', async () => {
    const ok = await http.get(URL_PATH, 'manufacturer');
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain('adata.kz');

    // Внутренние колонки и адрес с токеном не проходят строгую схему ответа: 500 без значений и списка полей.
    const url = `https://api.adata.kz/api/company/info/${TOKEN}?iinBin=240100000001`;
    ownAdata.mockImplementationOnce(async () =>
      parseResponse(ownAdataReadSchema, { ...READ, failure: 'network', pollToken: '123456', url }, 'чтение Adata'),
    );
    // Сбой с адресом в тексте и в cause — тот же 500 без подробностей.
    ownAdata.mockImplementationOnce(async () => {
      throw new Error(`fetch ${url}`, { cause: new Error(url) });
    });
    for (let i = 0; i < 2; i++) {
      const res = await http.get(URL_PATH, 'manufacturer');
      expect(res.status).toBe(500);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      const body = await res.text();
      expect(JSON.parse(body)).toMatchObject({ status: 500, code: 'internal' });
      expect(Object.keys(JSON.parse(body) as object)).not.toContain('errors');
      for (const leaked of [TOKEN, 'adata.kz', '123456', 'network', 'Тестов']) expect(body).not.toContain(leaked);
    }
    expect(ownAdata).toHaveBeenCalledTimes(3);
  });
});

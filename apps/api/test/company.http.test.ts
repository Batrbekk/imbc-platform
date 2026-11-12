import { type CompanyPage, companyPageSchema, type Role } from '@imbc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemException } from '../src/common/problem.js';
import { CatalogController } from '../src/modules/catalog/catalog.controller.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { type HttpStand, startHttp } from './support/http.js';

// Граница HTTP страницы компании: настоящий SessionGuard, разбор :profileId и ответ по роли (GEN-08, GEN-13).
const ID = '00000000-0000-4000-8000-000000000001';
const PAGE: Omit<CompanyPage, 'focalPoint'> = {
  profileId: ID,
  bin: '240100000001',
  nameEn: 'Demo Metal Structures LLP',
  nameRu: 'ТОО «Демо Металл Конструкция»',
  region: 'KZ-ATY',
  commodityGroups: ['A'],
  tnvedCodes: ['7308909809'],
  mainTnved: '7308909809',
  headcountTotal: 240,
  certificates: [{ type: 'ISO 9001', validUntil: '2027-11-12' }],
  siteSurveyed: true,
  tier: 'tier_2',
  unifiedRegister: true,
  worksWithCount: 1,
  updateStatus: 'active',
  pendingChanges: false,
  verifiedAt: '2026-11-03T10:00:00.000Z',
  companyPhone: '+7 700 000 00 01',
  companyEmail: 'info@company1.demo.local',
};
const FOCAL_POINT = {
  fullName: 'Айгерим Сапарова',
  position: 'Коммерческий директор',
  email: 'focal@company1.demo.local',
  phone: '+7 701 000 00 01',
};

/** Заглушка сервиса: отдаёт focal point только роли, которой его отдал бы сервис. */
const company = vi.fn(async (_id: string, role: Role): Promise<CompanyPage> =>
  role === 'observer' ? { ...PAGE } : { ...PAGE, focalPoint: FOCAL_POINT },
);

describe('GET /api/v1/catalog/companies/:profileId', () => {
  let http: HttpStand;
  const url = (id: string) => `/api/v1/catalog/companies/${id}`;

  beforeAll(async () => {
    http = await startHttp({
      controllers: [CatalogController],
      providers: [{ provide: CatalogService, useValue: { company } }],
    });
  });

  beforeEach(() => {
    company.mockClear();
    http.audit.record.mockClear();
  });

  afterAll(async () => {
    await http?.close();
  });

  it('оператор — 200 и focalPoint (OPR-09)', async () => {
    const res = await http.get(url(ID), 'operator');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(companyPageSchema.parse(body).focalPoint).toEqual(FOCAL_POINT);
    expect(company).toHaveBeenCalledWith(ID, 'operator');
  });

  it('наблюдатель — 200, ключа focalPoint нет, телефон и email компании есть (GEN-13)', async () => {
    const res = await http.get(url(ID), 'observer');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(company).toHaveBeenCalledWith(ID, 'observer');
    expect(Object.keys(body)).not.toContain('focalPoint');
    expect(body).toMatchObject({ companyPhone: PAGE.companyPhone, companyEmail: PAGE.companyEmail, tier: 'tier_2' });
    expect(companyPageSchema.parse(body)).toEqual(PAGE);
  });

  it.each(['manufacturer', 'administrator'] as const)(
    '%s — 403 problem+json, отказ в аудите, сервис не вызван (GEN-08)',
    async (role) => {
      const res = await http.get(url(ID), role);
      expect(res.status).toBe(403);
      expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
      expect(await res.json()).toMatchObject({ status: 403, code: 'forbidden' });
      expect(http.audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'denied', action: 'catalog.search' }),
      );
      expect(company).not.toHaveBeenCalled();
    },
  );

  it('без сеанса — 401, сервис не вызван', async () => {
    const res = await http.get(url(ID));
    expect(res.status).toBe(401);
    expect(company).not.toHaveBeenCalled();
  });

  it('не uuid — 400', async () => {
    const res = await http.get(url('123'), 'operator');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ status: 400, code: 'validation' });
    expect(company).not.toHaveBeenCalled();
  });

  it('нет в проекции — 404 not_found', async () => {
    company.mockRejectedValueOnce(new ProblemException(404, 'not_found', 'Компания не найдена'));
    const res = await http.get(url(ID), 'expert');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await res.json()).toMatchObject({ status: 404, code: 'not_found' });
  });
});

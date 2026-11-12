import 'reflect-metadata';
import { type CanActivate, type ExecutionContext, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureHttp } from '../src/common/http.js';
import { ProblemDetailsFilter } from '../src/common/problem.js';
import { CatalogController } from '../src/modules/catalog/catalog.controller.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';

// Граница HTTP поиска: разбор адреса через parseOrThrow и ответ ProblemDetailsFilter (OPR-05).
const search = vi.fn();

/** Вместо SessionGuard: сеанс оператора уже проверен. */
class OperatorSession implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().auth = { scope: 'visible' };
    return true;
  }
}

@Module({
  controllers: [CatalogController],
  providers: [
    { provide: CatalogService, useValue: { search } },
    { provide: APP_GUARD, useClass: OperatorSession },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
class CatalogHttpModule {}

describe('GET /api/v1/catalog/search', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestExpressApplication>(CatalogHttpModule, { logger: false });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  beforeEach(() => {
    search.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('неизвестный тир — 400 problem+json, поиск не вызывается', async () => {
    const res = await fetch(`${base}/api/v1/catalog/search?tier=tier_3`);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/^application\/problem\+json/);
    expect(await res.json()).toMatchObject({ status: 400, code: 'validation', errors: [{ path: 'tier.0' }] });
    expect(search).not.toHaveBeenCalled();
  });

  it('пустой tier — 200 и поиск без фильтра по тиру', async () => {
    const res = await fetch(`${base}/api/v1/catalog/search?tier=`);
    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    // Только значения выдачи по умолчанию: tier не задан, других фильтров нет.
    expect(search.mock.calls[0]).toEqual([{ sort: 'name', page: 1, pageSize: 25 }, 'visible']);
    expect(search.mock.calls[0]![0].tier).toBeUndefined();
  });
});

import { catalogFilterSchema } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { CatalogService, catalogOrder } from '../src/modules/catalog/catalog.service.js';

const orderText = (sort: Parameters<typeof catalogOrder>[0]) =>
  new PgDialect().sqlToQuery(sql.join(catalogOrder(sort), sql`, `)).sql;

describe('порядок выдачи каталога (UPD-04, OPR-01, OPR-33)', () => {
  it.each(['name', 'verified_at', 'region'] as const)(
    'сортировка %s сначала опускает unresponsive (UPD-04)',
    (sort) => {
      expect(orderText(sort)).toMatch(/^\(?"catalog_visible"\."update_status" = 'unresponsive'\)? asc/);
    },
  );

  it.each([
    ['name', '"catalog_visible"."name_ru" asc'],
    ['verified_at', '"catalog_visible"."verified_at" desc'],
    ['region', '"catalog_visible"."region" asc, "catalog_visible"."name_ru" asc'],
  ] as const)('после статуса — прежние ключи сортировки %s, без ключа между active и outdated', (sort, rest) => {
    expect(orderText(sort)).toBe(
      `("catalog_visible"."update_status" = 'unresponsive') asc, ${rest}, "catalog_visible"."profile_id" asc`,
    );
  });

  it.each(['name', 'verified_at', 'region'] as const)(
    'сортировка %s заканчивается уникальным profile_id: страницы устойчивы при равных ключах (OPR-01)',
    (sort) => {
      expect(orderText(sort)).toMatch(/, "catalog_visible"\."profile_id" asc$/);
    },
  );
});

describe('условия фильтров каталога (OPR-02, OPR-04)', () => {
  const service = new CatalogService(null as never, null as never);
  const conditions = (query: Record<string, string>) =>
    service.buildConditions(catalogFilterSchema.parse(query)).map((c) => new PgDialect().sqlToQuery(c));

  it('условие по тиру появляется только при заданном фильтре (OPR-02)', () => {
    expect(conditions({})).toEqual([]);
    expect(conditions({ tier: '' })).toEqual([]);

    const [tier, ...rest] = conditions({ tier: 'tier_2' });
    expect(rest).toEqual([]);
    expect(tier!.sql).toContain('"tier"');
    expect(tier!.params).toEqual(['tier_2']);
  });

  it('несколько тиров — одно условие с OR внутри фильтра (OPR-04)', () => {
    const [tier, ...rest] = conditions({ tier: 'tier_1,tier_2' });
    expect(rest).toEqual([]);
    expect(tier!.sql).toMatch(/"catalog_visible"\."tier" in \(\$1, \$2\)/);
    expect(tier!.params).toEqual(['tier_1', 'tier_2']);
  });
});

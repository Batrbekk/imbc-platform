import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { catalogOrder } from '../src/modules/catalog/catalog.service.js';

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
    expect(orderText(sort)).toBe(`("catalog_visible"."update_status" = 'unresponsive') asc, ${rest}`);
  });
});

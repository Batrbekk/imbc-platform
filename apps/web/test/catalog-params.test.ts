import { catalogFilterSchema } from "@imbc/contracts";
import { createLoader } from "nuqs";
import { describe, expect, it } from "vitest";

import { catalogParsers, serializeCatalog } from "@/lib/catalog-params";

const loadCatalog = createLoader(catalogParsers);

// Фильтры каталога в адресе страницы в формате catalogFilterSchema (OPR-05).
describe("фильтры каталога в адресе", () => {
  it("адрес из README разбирается nuqs и catalogFilterSchema одинаково", () => {
    const query = serializeCatalog({
      q: "металл",
      region: ["KZ-ATY", "KZ-MAN"],
      group: ["A", "B"],
      surveyed: true,
      tnved: "7308",
      sort: "verified_at",
      page: 2,
    });
    const params = new URLSearchParams(query);
    // Списки — через запятую, ключ не повторяется.
    expect(params.getAll("region")).toEqual(["KZ-ATY,KZ-MAN"]);
    expect(params.getAll("group")).toEqual(["A,B"]);
    expect(catalogFilterSchema.parse(Object.fromEntries(params))).toMatchObject({
      q: "металл",
      region: ["KZ-ATY", "KZ-MAN"],
      group: ["A", "B"],
      surveyed: true,
      tnved: "7308",
      sort: "verified_at",
      page: 2,
    });
  });

  it("фильтр тира — список через запятую, схема читает тот же список (OPR-05, OPR-35)", () => {
    const query = serializeCatalog({ tier: ["tier_1", "tier_2"] });
    expect(query).toBe("?tier=tier_1,tier_2");
    expect(catalogFilterSchema.parse(Object.fromEntries(new URLSearchParams(query))).tier).toEqual([
      "tier_1",
      "tier_2",
    ]);
  });

  it("неизвестный тир из адреса отбрасывается до запроса: API ответил бы 400", () => {
    expect(serializeCatalog(loadCatalog("?tier=tier_3"))).toBe("");
    expect(serializeCatalog(loadCatalog("?tier=tier_3,tier_2"))).toBe("?tier=tier_2");
  });

  it("значения по умолчанию в адрес не попадают", () => {
    expect(serializeCatalog({ sort: "name", page: 1 })).toBe("");
  });
});

import { catalogFilterSchema } from "@imbc/contracts";
import { describe, expect, it } from "vitest";

import { serializeCatalog } from "@/lib/catalog-params";

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

  it("значения по умолчанию в адрес не попадают", () => {
    expect(serializeCatalog({ sort: "name", page: 1 })).toBe("");
  });
});

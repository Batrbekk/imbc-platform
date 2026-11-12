// Содержимое файла выгрузки, собранного в браузере (OPR-14, OPR-24, DATA-09…DATA-13).
import { describe, expect, it } from "vitest";

import { createInitialState } from "@/prototype/data";
import {
  ALL_COLUMNS,
  escapeFormula,
  exportTable,
  type ExportWords,
  toCsv,
  xlsxParts,
  zipStored,
} from "@/prototype/operator/export-file";
import { parseFilters, searchProfiles } from "@/prototype/operator/scope";

const words: ExportWords = {
  column: (c) => c,
  yes: "Yes",
  no: "No",
  tier: (t) => t,
  perYear: (v, u) => `${v} ${u}/year`,
};

function table(filters = "") {
  const state = createInitialState();
  return { state, table: exportTable(state, searchProfiles(state, parseFilters(filters)), ALL_COLUMNS, words, "en") };
}

describe("файл выгрузки", () => {
  it("строка на продуктовую линию видимых профилей, стандартные колонки раздела 9.2 (DATA-09)", () => {
    const { state, table: t } = table();
    const lines = searchProfiles(state, parseFilters("")).reduce((n, p) => n + p.sections.products.length, 0);
    expect(t.rows).toHaveLength(lines);
    expect(t.header).toEqual(ALL_COLUMNS);
    expect(t.header).toHaveLength(30);
    // Только видимые Verified: Draft p12 и Submitted p09 не выгружаются.
    const bins = new Set(t.rows.map((r) => (r[0]!.kind === "text" ? r[0]!.value : "")));
    expect(bins.has(state.profiles.find((p) => p.id === "p12")!.bin)).toBe(false);
    expect(bins.has(state.profiles.find((p) => p.id === "p09")!.bin)).toBe(false);
  });

  it("продукт tier 3 помечен в своей строке, «работают с» — число из трёх (IMBC-21, OPR-20)", () => {
    const { table: t } = table();
    const tier = ALL_COLUMNS.indexOf("tier");
    const ww = ALL_COLUMNS.indexOf("worksWith");
    const p01 = t.rows.filter((r) => r[0]!.kind === "text" && r[0]!.value === "240100001001");
    expect(p01.map((r) => (r[tier] as { value: string }).value)).toContain("tier_3");
    expect((p01[0]![ww] as { value: string }).value).toBe("2/3");
  });

  it("CSV: BOM, «;», кавычки RFC 4180, ISO-даты, экранирование формул (DATA-10, DATA-12)", () => {
    const { table: t } = table("group=B");
    const csv = toCsv(t);
    expect(csv.startsWith("﻿bin;nameEn;nameRu;")).toBe(true);
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(t.rows.length + 1);
    expect(csv).toMatch(/;\d{4}-\d{2}-\d{2};/);
    expect(csv).toContain(";'+7 ");
    expect(toCsv({ header: ["a"], rows: [[{ kind: "text", value: 'x; "y"' }]] })).toBe('﻿a\r\n"x; ""y"""\r\n');
    expect(escapeFormula("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(escapeFormula("@cmd")).toBe("'@cmd");
    expect(escapeFormula("Сталь")).toBe("Сталь");
  });

  it("в файле нет заметок операторов, названий операторов, итога due diligence (DATA-13, OPR-24)", () => {
    const { state, table: t } = table();
    const csv = toCsv(t);
    for (const note of state.operatorNotes) expect(csv).not.toContain(note.text);
    for (const org of state.organizations.filter((o) => o.type === "operator")) expect(csv).not.toContain(org.name);
    expect(csv).not.toMatch(/;(green|amber|red);/i);
    expect(csv).not.toContain(state.profiles[0]!.heardAbout);
  });

  it("XLSX: БИН — текст, даты — ячейки даты, лист «О файле» с версией, строками и фильтрами (DATA-11)", () => {
    const { table: t } = table("group=B");
    const parts = xlsxParts(t, {
      takenAt: "2026-11-12T10:00:00.000Z",
      filters: "group=B",
      labels: {
        version: "Version",
        takenAt: "Taken at",
        rows: "Rows",
        filters: "Filters",
        sheet: "Export",
        about: "About",
      },
    });
    const sheet = parts["xl/worksheets/sheet1.xml"]!;
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">2401');
    expect(sheet).toMatch(/<c r="[A-Z]+2" s="1"><v>\d+<\/v><\/c>/);
    const about = parts["xl/worksheets/sheet2.xml"]!;
    expect(about).toContain(">1.0<");
    expect(about).toContain(`<v>${t.rows.length}</v>`);
    expect(about).toContain(">group=B<");
    const zip = zipStored(parts);
    expect(String.fromCharCode(zip[0]!, zip[1]!)).toBe("PK");
    expect(new TextDecoder().decode(zip)).toContain("xl/workbook.xml");
  });
});

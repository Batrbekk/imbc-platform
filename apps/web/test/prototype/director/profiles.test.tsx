// Все профили директора: фильтры в адресе, выгрузка CSV по DATA-10 без итога due diligence и операторов (DATA-13),
// досье только для чтения со вкладками в адресе (GEN-04, IMBC-11, IMBC-19, IMBC-20).
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "@/prototype/store";

import { renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

let blobs: Blob[] = [];
beforeEach(() => {
  blobs = [];
  URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    return "blob:director-test";
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const bodyRows = () => {
  const table = screen.getByRole("columnheader", { name: "Visible to operators" }).closest("table")!;
  return within(table).getAllByRole("row").slice(1);
};

const readBlob = (blob: Blob) =>
  new Promise<Uint8Array>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

describe("все профили директора", () => {
  it("фильтры из адреса работают вместе", async () => {
    renderCabinet("/proto/director/profiles?dd=red", { role: "director" });
    await screen.findByRole("heading", { level: 1, name: "All profiles" });
    expect(bodyRows()).toHaveLength(1);
    expect(screen.getByRole("link", { name: "ТОО «Демо Электро Монтаж»" })).toBeTruthy();
  });

  it("выбор фильтра меняет адрес, а не хранилище", async () => {
    const { user, router } = renderCabinet("/proto/director/profiles", { role: "director" });
    await screen.findByRole("heading", { level: 1, name: "All profiles" });
    const stored = window.localStorage.getItem(STORAGE_KEY);
    await user.click(screen.getByRole("combobox", { name: "Visible to operators" }));
    await user.click(await screen.findByRole("option", { name: "No" }));
    expect(router.state.location.search).toBe("?visible=no");
    // Не видны операторам: Submitted, Returned, Under review, Draft.
    expect(bodyRows()).toHaveLength(4);
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Draft" }));
    expect(bodyRows()).toHaveLength(1);
    await user.type(screen.getByRole("textbox", { name: "Name or BIN" }), "Нет такого");
    expect(await screen.findByText("No profile matches these filters.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export CSV" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(bodyRows()).toHaveLength(12);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
  });

  it("выгрузка CSV: показанный список, DATA-10, без итога due diligence и названий операторов", async () => {
    const { user, state } = renderCabinet("/proto/director/profiles?update=active", { role: "director" });
    await screen.findByRole("heading", { level: 1, name: "All profiles" });
    const before = JSON.stringify(state());
    const shown = bodyRows().length;
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(blobs).toHaveLength(1);
    const bytes = await readBlob(blobs[0]!);
    // UTF-8 с меткой порядка байтов (DATA-10).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const lines = text.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "BIN;Name (Russian);Name (English);Region;Profile status;Pending changes;Update status;Tier;Tier 3 product lines;Major operators working with;Registered;Verified;Last due-diligence check",
    );
    expect(lines).toHaveLength(shown + 1);
    expect(lines.find((l) => l.startsWith("240100001001;"))).toMatch(
      /;Verified;No;Active;Tier 2;\d+;2;2026-09-03;2026-09-20;2026-09-03$/,
    );
    for (const banned of ["Green", "Amber", "Red", "Оператор", "Поставляли"]) expect(text).not.toContain(banned);
    // Выгрузка директора — файл в браузере, не правка: хранилище то же (GEN-04).
    expect(JSON.stringify(state())).toBe(before);
  });

  it("досье: вкладка в адресе, секции без действий, тир и site survey", async () => {
    const { user, router } = renderCabinet("/proto/director/profiles/p02", { role: "director" });
    expect(await screen.findByRole("heading", { level: 1, name: "ТОО «Каспий Демо Сервис»" })).toBeTruthy();
    expect(screen.getByText("Pending changes")).toBeTruthy();
    expect(screen.getByText("Main information")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Site survey" }));
    expect(router.state.location.search).toBe("?tab=site-survey");
    await user.click(screen.getByRole("tab", { name: "Tiers, AGAR and CDP" }));
    expect(await screen.findByText("Profile tier:")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Sections and documents" }));
    expect(router.state.location.search).toBe("");
  });
});

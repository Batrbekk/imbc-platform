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

  it("выгрузка CSV — стандартная выгрузка платформы (DATA-09, DATA-10, DATA-12, DATA-13) по списку директора", async () => {
    const { user, state } = renderCabinet("/proto/director/profiles?visible=no", {
      role: "director",
      prepare: (draft) => {
        // Значение, похожее на формулу, экранируется апострофом (DATA-12).
        draft.profiles.find((p) => p.id === "p12")!.sections.main.legalAddress = "=HYPERLINK(1)";
      },
    });
    await screen.findByRole("heading", { level: 1, name: "All profiles" });
    const before = JSON.stringify(state());
    // Невидимые операторам профили тоже выгружаются: директор видит все (раздел 4).
    const shown = state().profiles.filter((p) => ["p09", "p10", "p11", "p12"].includes(p.id));
    expect(bodyRows()).toHaveLength(shown.length);
    await user.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(blobs).toHaveLength(1);
    const bytes = await readBlob(blobs[0]!);
    // UTF-8 с меткой порядка байтов, «;», строка заголовка (DATA-10).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    const lines = text.trimEnd().split("\r\n");
    const header = lines[0]!.split(";");
    // Все стандартные колонки раздела 9.2, строка на продуктовую линию (DATA-09).
    expect(header).toHaveLength(30);
    expect(header.slice(0, 3)).toEqual(["BIN", "Name in English", "Name in Russian"]);
    expect(header).toContain("Focal point name");
    expect(lines).toHaveLength(1 + shown.reduce((n, p) => n + p.sections.products.length, 0));
    expect(lines.some((l) => l.startsWith("240100012007;"))).toBe(true);
    expect(text).toContain("'=HYPERLINK(1)");
    for (const banned of ["Green", "Amber", "Red", "Оператор (демо)", "Поставляли"]) expect(text).not.toContain(banned);
    // Выгрузка директора — файл в браузере, не правка: хранилище то же (GEN-04).
    expect(JSON.stringify(state())).toBe(before);
  });

  it("число major operators — из данных, а не «из 3»", async () => {
    renderCabinet("/proto/director/profiles", {
      role: "director",
      prepare: (draft) => {
        draft.organizations.find((o) => o.id === "org-observer-demo")!.majorOperator = true;
      },
    });
    const row = (await screen.findByRole("link", { name: "ТОО «Демо Металл Конструкция»" })).closest("tr")!;
    expect(within(row).getByText("2 of 4")).toBeTruthy();
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

// Кабинет администратора: меню, чужие роли, ADM-06 (нет данных профилей), почта сеанса не попадает в хранилище.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "@/prototype/store";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const SCREENS = [
  ["organizations", "Organisations and accounts"],
  ["organizations?type=manufacturer", "Organisations and accounts"],
  ["organizations?type=imbc", "Organisations and accounts"],
  ["assignments", "Assign reviews"],
  ["references", "Reference lists"],
  ["references?list=tnved", "Reference lists"],
  ["nda", "NDA versions"],
  ["forecast", "Demand forecast"],
  ["tech-files", "STR and KTRE files"],
  ["migration", "Migrated manufacturers"],
  ["api", "Pull API"],
  ["audit", "Audit log"],
] as const;

/**
 * Отличительные значения профилей из `data/profiles.ts` и смежных наборов: focal point, директор,
 * адреса и телефоны, БИН, файлы, ответ «откуда узнали», комментарии SME, акционер, IP принятия NDA,
 * due diligence и тир. Ни одно не должно появиться на экранах администратора (ADM-06).
 */
const PROFILE_VALUES = [
  "Айгерим Сапарова",
  "Ерболат Кенжебаев",
  "Ерлан Жумабеков",
  "Тимур Абдрахманов",
  "focal@company1.demo.local",
  "info@company1.demo.local",
  "ул. Демонстрационная",
  "промзона «Демо»",
  "+7 700 000 00 01",
  "240100001001",
  "240100003008",
  "p01-charter.pdf",
  "p01-org-chart.pdf",
  "Modular steel structures",
  "Мероприятие IMBC",
  "Оргструктура не совпадает",
  "Телефон focal point не отвечает",
  "ТОО «Демо Холдинг»",
  "10.20.0.1",
  "Демо Сертификация",
  "KZ-EO-",
  "Станок с ЧПУ",
  "Tier 1",
  "Tier 2",
  "Green",
  "Amber",
  "Unresponsive",
  "Outdated",
];

describe("кабинет администратора", () => {
  it("семь пунктов меню; индекс ведёт на первый из них; прогноз и STR/KTRE с бейджем Release 2", async () => {
    renderCabinet("/proto/administrator", { role: "administrator" });
    // Индексный маршрут кабинета открывает первый пункт меню — «Assign reviews».
    expect(await screen.findByRole("heading", { level: 1, name: "Assign reviews" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Assign reviews/ }).getAttribute("href")).toBe(
      "/proto/administrator/assignments",
    );
    // Макеты «Организации и аккаунты» и «Справочники» из меню прототипа убраны: настоящие страницы —
    // /admin/accounts (ADM-02) и /references (ADM-08), пункты основного меню. Ссылку «Reference lists» основного
    // меню (href /references) это не затрагивает, поэтому отсутствие проверяется по адресу макета.
    expect(screen.queryByRole("link", { name: /Organisations and accounts/ })).toBeNull();
    const menuHrefs = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/proto/administrator/"));
    expect(menuHrefs).toHaveLength(7);
    expect(menuHrefs).not.toContain("/proto/administrator/references");
    expect(menuHrefs).not.toContain("/proto/administrator/organizations");
    for (const name of [
      "Assign reviews",
      "NDA versions",
      "Demand forecast",
      "STR and KTRE files",
      "Migrated manufacturers",
      "Pull API",
      "Audit log",
    ]) {
      expect(screen.getByRole("link", { name: new RegExp(name) })).toBeTruthy();
    }
    const forecast = screen.getByRole("link", { name: /Demand forecast/ }).closest("li")!;
    expect(within(forecast).getByText("Release 2")).toBeTruthy();
    const nda = screen.getByRole("link", { name: /NDA versions/ }).closest("li")!;
    expect(within(nda).queryByText("Release 2")).toBeNull();
  });

  it("другая роль не открывает экраны администратора", async () => {
    const { router } = renderCabinet("/proto/administrator/organizations", {
      role: "operator",
      api: { "GET /api/v1/dashboard": { status: 500 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByText("Organisations and accounts")).toBeNull();
  });

  it("ни один экран не показывает данных профилей (ADM-06)", async () => {
    for (const [path, title] of SCREENS) {
      const { api } = renderCabinet(`/proto/administrator/${path}`, { role: "administrator" });
      expect(await screen.findByRole("heading", { level: 1, name: title })).toBeTruthy();
      const text = document.body.textContent ?? "";
      for (const value of PROFILE_VALUES) expect(text, `${path}: ${value}`).not.toContain(value);
      expect(text, path).not.toMatch(/2401000\d{5}/);
      expect(apiV1Calls(api), path).toEqual([]);
      cleanup();
    }
  });

  it("почта и имя сеанса не из демо-данных не попадают в хранилище и на экраны", async () => {
    const email = "someone@real.example";
    const fullName = "Настоящий Человек";
    const { user, state } = renderCabinet("/proto/administrator/api", { role: "administrator", email, fullName });
    await user.click(await screen.findByRole("button", { name: "Issue credentials" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("radio", { name: "Оператор В (демо)" }));
    await user.click(within(dialog).getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(state().apiCredentials.at(-1)?.operatorOrgId).toBe("org-operator-c"));
    expect(state().apiCredentials.at(-1)?.issuedBy).toBe("acc-admin");

    // Всё сохранённое состояние, включая журнал и его actor.
    const stored = window.localStorage.getItem(STORAGE_KEY)!;
    expect(stored).not.toContain(email);
    expect(stored).not.toContain(fullName);
    expect(state().audit.at(-1)?.actor).toMatchObject({ accountId: "acc-admin", email: "admin@imbc.local" });

    await user.click(screen.getByRole("link", { name: "Audit log" }));
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    expect(within(screen.getByRole("table")).queryByText(email)).toBeNull();
    expect(within(screen.getByRole("table")).queryByText(fullName)).toBeNull();
  });

  it("сеанс не из демо-данных не блокирует аккаунт, от имени которого действует (ADM-02)", async () => {
    renderCabinet("/proto/administrator/organizations?type=imbc", {
      role: "administrator",
      email: "someone@real.example",
    });
    const row = (await screen.findAllByText("admin@imbc.local")).map((c) => c.closest("tr")).find(Boolean)!;
    expect(within(row).getByText("Your account")).toBeTruthy();
    expect(within(row).queryByRole("button", { name: "Block" })).toBeNull();
  });
});

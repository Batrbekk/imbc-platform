// Организации и аккаунты для администратора, только для чтения (ADM-02, ADM-06).
import type { AdminAccounts } from "@imbc/contracts";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { problem, stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const ADMIN: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "admin@imbc.local",
    fullName: "Администратор IMBC",
    role: "administrator",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "imbc",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/admin/accounts",
  otpDelivery: "email",
};

const ACCOUNTS: AdminAccounts = {
  imbcMailbox: null,
  organizations: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "IMBC",
      type: "imbc",
      isMajorOperator: false,
      accounts: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          email: "admin@imbc.local",
          // Имя не совпадает с подписью роли «Администратор IMBC».
          fullName: "Демо Администратор",
          role: "administrator",
          state: "active",
          // 08:30 UTC — 13:30 в Алматы.
          lastSignInAt: "2026-11-12T08:30:00Z",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          email: "expert@imbc.local",
          fullName: null,
          role: "expert",
          state: "invited",
          lastSignInAt: null,
        },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000010",
      name: "Оператор (демо)",
      type: "operator",
      isMajorOperator: true,
      accounts: [
        {
          id: "00000000-0000-4000-8000-000000000011",
          email: "operator@operator.local",
          fullName: "Специалист оператора",
          role: "operator",
          state: "blocked",
          lastSignInAt: null,
        },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000020",
      name: "Наблюдатель (демо)",
      type: "observer",
      isMajorOperator: false,
      accounts: [
        {
          id: "00000000-0000-4000-8000-000000000021",
          email: "observer@observer.local",
          fullName: "Наблюдатель",
          role: "observer",
          state: "inactive",
          lastSignInAt: null,
        },
      ],
    },
    {
      id: "00000000-0000-4000-8000-000000000030",
      name: "ТОО «Демо Агро Өнім»",
      type: "manufacturer",
      isMajorOperator: false,
      accounts: [],
    },
  ],
};

function stubAccounts(reply: Parameters<typeof stubApi>[0][string] = { body: ACCOUNTS }) {
  return stubApi({ "GET /api/auth/me": { body: ADMIN }, "GET /api/v1/admin/accounts": reply });
}

const accountCalls = (api: Mock<typeof fetch>) =>
  api.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/v1/admin/accounts"));

/** Карточки организаций на странице. */
const cards = () => [...document.querySelectorAll<HTMLElement>('[data-slot="card"]')];
/** Карточка организации по названию. */
const cardOf = (name: string) =>
  cards().find((c) => c.querySelector('[data-slot="card-title"]')?.textContent === name)!;
/** Тип организации — подпись под названием. */
const typeOf = (name: string) => cardOf(name).querySelector('[data-slot="card-description"]')?.textContent;
/** Строка таблицы по email. */
const rowOf = (email: string) =>
  screen
    .getAllByText(email)
    .find((el) => el.closest("tr"))!
    .closest("tr")!;
const row = (email: string) => within(rowOf(email));
const cells = (email: string) => [...rowOf(email).querySelectorAll("td")].map((cell) => cell.textContent);

describe("организации и аккаунты администратора (ADM-02)", () => {
  it("организации по типам, роли и состояния переведены", async () => {
    stubAccounts();
    renderRoute("/admin/accounts", { locale: "ru" });

    expect(await screen.findByRole("heading", { level: 1, name: ru.adminAccounts.title })).toBeTruthy();
    expect(document.title).toBe(`${ru.adminAccounts.title} · ${ru.common.appName}`);
    await screen.findByText("Оператор (демо)");
    // Карточки — в порядке ответа: по типу, затем по имени.
    expect([...document.querySelectorAll('[data-slot="card-title"]')].map((title) => title.textContent)).toEqual([
      "IMBC",
      "Оператор (демо)",
      "Наблюдатель (демо)",
      "ТОО «Демо Агро Өнім»",
    ]);
    expect(typeOf("IMBC")).toBe(ru.adminAccounts.typeValue.imbc);
    expect(typeOf("Оператор (демо)")).toBe(ru.adminAccounts.typeValue.operator);
    expect(typeOf("Наблюдатель (демо)")).toBe(ru.adminAccounts.typeValue.observer);
    expect(typeOf("ТОО «Демо Агро Өнім»")).toBe(ru.adminAccounts.typeValue.manufacturer);
    // Бейдж только у крупного оператора.
    expect(within(cardOf("Оператор (демо)")).getByText(ru.adminAccounts.majorOperator)).toBeTruthy();
    expect(screen.getAllByText(ru.adminAccounts.majorOperator)).toHaveLength(1);

    expect(
      within(cardOf("IMBC"))
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      ru.adminAccounts.email,
      ru.adminAccounts.name,
      ru.adminAccounts.role,
      ru.adminAccounts.state,
      ru.adminAccounts.lastSignIn,
    ]);
    // Ячейки строк: имя, роль (roles.*), состояние (adminAccounts.stateValue.*), последний вход.
    const state = ru.adminAccounts.stateValue;
    expect(cells("admin@imbc.local")).toEqual([
      "admin@imbc.local",
      "Демо Администратор",
      ru.roles.administrator,
      state.active,
      "12.11.2026, 13:30",
    ]);
    expect(cells("expert@imbc.local")).toEqual([
      "expert@imbc.local",
      "",
      ru.roles.expert,
      state.invited,
      ru.adminAccounts.never,
    ]);
    expect(cells("operator@operator.local")).toEqual([
      "operator@operator.local",
      "Специалист оператора",
      ru.roles.operator,
      state.blocked,
      ru.adminAccounts.never,
    ]);
    expect(cells("observer@observer.local")).toEqual([
      "observer@observer.local",
      "Наблюдатель",
      ru.roles.observer,
      state.inactive,
      ru.adminAccounts.never,
    ]);

    // Только чтение: в карточках ни ссылок, ни кнопок.
    for (const c of cards()) {
      expect(within(c).queryAllByRole("button")).toEqual([]);
      expect(within(c).queryAllByRole("link")).toEqual([]);
    }
  });

  it("последний вход через useFormat, «Не входил» без даты", async () => {
    stubAccounts();
    renderRoute("/admin/accounts", { locale: "kk" });

    // Казахский — dd.MM.yyyy, HH:mm в часовом поясе Алматы.
    expect(await screen.findByText("12.11.2026, 13:30")).toBeTruthy();
    expect(row("admin@imbc.local").getByText("12.11.2026, 13:30")).toBeTruthy();
    expect(row("admin@imbc.local").queryByText(kk.adminAccounts.never)).toBeNull();
    for (const email of ["expert@imbc.local", "operator@operator.local", "observer@observer.local"])
      expect(row(email).getByText(kk.adminAccounts.never)).toBeTruthy();
    cleanup();

    stubAccounts();
    renderRoute("/admin/accounts", { locale: "ru" });
    expect(await screen.findByText("12.11.2026, 13:30")).toBeTruthy();
    expect(screen.getAllByText(ru.adminAccounts.never)).toHaveLength(3);
  });

  it("организация без аккаунтов — «Аккаунтов нет»", async () => {
    stubAccounts();
    renderRoute("/admin/accounts", { locale: "en" });

    await screen.findByText("ТОО «Демо Агро Өнім»");
    const view = within(cardOf("ТОО «Демо Агро Өнім»"));
    expect(view.getByText(en.adminAccounts.noAccounts)).toBeTruthy();
    expect(view.queryByRole("table")).toBeNull();
    expect(screen.getAllByText(en.adminAccounts.noAccounts)).toHaveLength(1);
  });

  it("пусто и сбой различаются", async () => {
    stubAccounts({ body: { organizations: [] } });
    renderRoute("/admin/accounts", { locale: "kk" });

    expect(await screen.findByText(kk.adminAccounts.empty)).toBeTruthy();
    expect(screen.queryByText(kk.adminAccounts.loadError)).toBeNull();
    cleanup();

    let fail = true;
    const unavailable = problem(503, "unavailable") as (url: URL) => Response;
    const api = stubAccounts((url) => (fail ? unavailable(url) : Response.json(ACCOUNTS)));
    const { user } = renderRoute("/admin/accounts", { locale: "kk" });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(kk.adminAccounts.loadError)).toBeTruthy();
    expect(screen.queryByText(kk.adminAccounts.empty)).toBeNull();
    fail = false;
    await user.click(within(alert).getByRole("button", { name: kk.common.retry }));
    expect(await screen.findByText("Оператор (демо)")).toBeTruthy();
    expect(screen.queryByText(kk.adminAccounts.loadError)).toBeNull();
    expect(accountCalls(api)).toHaveLength(2);
  });
});

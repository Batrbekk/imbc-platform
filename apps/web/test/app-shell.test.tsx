// Оболочка рабочих страниц: интерфейс прячет недоступное, решает сервер (GEN-08, GEN-10).
import { can } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { leaveApp } from "@/lib/leave-app";
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

const HOME: Record<Me["user"]["role"], string> = {
  manufacturer: "/profile",
  administrator: "/account",
  expert: "/catalog",
  director: "/catalog",
  operator: "/catalog",
  observer: "/catalog",
};

function me(role: Me["user"]["role"], gates: Me["gates"] = { mfa: true, responsibility: true }): Me {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: `${role}@${role}.local`,
      fullName: null,
      role,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationType: role === "manufacturer" ? "manufacturer" : role === "operator" ? "operator" : "imbc",
      locale: "kk",
    },
    gates,
    homePath: HOME[role],
    otpDelivery: "email",
  };
}

const EMPTY_PAGE = { items: [], total: 0, page: 1, pageSize: 25 };
const DASHBOARD = {
  total: 0,
  byRegion: [],
  byCommodityGroup: [],
  siteSurveyed: 0,
  unifiedRegister: 0,
  updateStatus: { active: 0, outdated: 0, unresponsive: 0 },
  generatedAt: "2026-11-11T10:00:00Z",
};

function stubWorkspace(user: Me) {
  return stubApi({
    "GET /api/auth/me": { body: user },
    "GET /api/v1/catalog/search": { body: EMPTY_PAGE },
    "GET /api/v1/dashboard": { body: DASHBOARD },
  });
}

describe("оболочка рабочих страниц (GEN-08, GEN-10)", () => {
  it("истёкший сеанс → вход с возвратом на страницу и фильтры", async () => {
    stubApi({ "GET /api/auth/me": problem(401, "unauthorized") });
    const { router } = renderRoute("/catalog?q=steel");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?error=session_expired&returnTo=%2Fcatalog%3Fq%3Dsteel");
    expect((await screen.findByRole("alert")).textContent).toBe(kk.login.errors.session_expired);
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it("нет второго фактора → /auth/verify?returnTo=%2Fdashboard", async () => {
    stubApi({
      "GET /api/auth/me": { body: me("operator", { mfa: false, responsibility: false }) },
      "POST /api/auth/otp/send": { body: { sent: true, retryAfter: 60 } },
    });
    const { router } = renderRoute("/dashboard");

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/verify"));
    expect(router.state.location.search).toBe("?returnTo=%2Fdashboard");
  });

  it("нет ответственности → /auth/responsibility с возвратом", async () => {
    stubApi({ "GET /api/auth/me": { body: me("operator", { mfa: true, responsibility: false }) } });
    const { router } = renderRoute("/catalog?region=KZ-ATY");

    await waitFor(() => expect(router.state.location.pathname).toBe("/auth/responsibility"));
    expect(router.state.location.search).toBe("?returnTo=%2Fcatalog%3Fregion%3DKZ-ATY");
  });

  it("производитель на /catalog уходит на /profile; администратор на /dashboard — на /account", async () => {
    stubWorkspace(me("manufacturer"));
    let { router } = renderRoute("/catalog");
    await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
    expect(await screen.findByText(kk.profile.welcome)).toBeTruthy();
    const page = within(screen.getByRole("main"));
    // Ссылка с видом кнопки остаётся ссылкой, а не кнопкой Base UI.
    expect(page.getByRole("link", { name: kk.nav.account }).getAttribute("href")).toBe("/account");
    expect(page.queryByRole("button", { name: kk.nav.account })).toBeNull();
    expect(document.title).toBe(kk.common.appName);
    // Меню производителя — профиль компании и аккаунт, без каталога и дашборда.
    expect(screen.getByRole("link", { name: kk.nav.profile }).getAttribute("href")).toBe("/profile");
    expect(screen.queryByRole("link", { name: kk.nav.catalog })).toBeNull();
    expect(screen.queryByRole("link", { name: kk.nav.dashboard })).toBeNull();

    cleanup();
    stubWorkspace(me("administrator"));
    ({ router } = renderRoute("/dashboard"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/account"));
    expect(await screen.findByRole("heading", { name: kk.account.title })).toBeTruthy();
  });

  it("сбой связи при проверке сеанса — сообщение и повтор, заголовок вкладки — страницы", async () => {
    let attempts = 0;
    stubApi({
      "GET /api/auth/me": () => {
        attempts += 1;
        // Так отвечает dev-прокси Vite, когда API не запущен: 502 с пустым text/plain.
        return attempts === 1
          ? new Response("", { status: 502, headers: { "content-type": "text/plain" } })
          : Response.json(me("operator"));
      },
      "GET /api/v1/catalog/search": { body: EMPTY_PAGE },
      "GET /api/v1/dashboard": { body: DASHBOARD },
    });
    const { user } = renderRoute("/catalog", { locale: "ru" });

    expect(await screen.findByText(ru.auth.connectionError)).toBeTruthy();
    expect(document.title).toBe(`${ru.catalog.title} · ${ru.common.appName}`);
    // Страница ещё не смонтирована: заголовок один — от оболочки.
    expect(document.querySelectorAll("title")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: ru.auth.retry }));

    expect(await screen.findByRole("heading", { name: ru.catalog.title })).toBeTruthy();
    expect(document.title).toBe(`${ru.catalog.title} · ${ru.common.appName}`);
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("пока проверяется сеанс — индикатор и ровно один заголовок вкладки, заголовок страницы", async () => {
    stubApi({ "GET /api/auth/me": () => new Promise<Response>(() => {}) as unknown as Response });
    renderRoute("/dashboard", { locale: "ru" });

    expect(await screen.findByText(ru.auth.checkingSession)).toBeTruthy();
    expect(document.querySelectorAll("title")).toHaveLength(1);
    expect(document.title).toBe(`${ru.dashboard.title} · ${ru.common.appName}`);
    expect(screen.queryByRole("heading", { name: ru.dashboard.title })).toBeNull();
  });

  it("меню по матрице прав: оператор, директор, эксперт, администратор (GEN-10)", async () => {
    // Ожидаемые пункты; сверяются и с PolicyMatrix, чтобы тест не разошёлся с ней.
    const expected: [Me["user"]["role"], string[]][] = [
      ["operator", ["/catalog", "/dashboard", "/account"]],
      ["director", ["/catalog", "/dashboard", "/account"]],
      ["expert", ["/catalog", "/account"]],
      ["administrator", ["/account"]],
    ];
    for (const [role, hrefs] of expected) {
      const fromPolicy = [
        can(role, "catalog.search") && "/catalog",
        can(role, "dashboard.read") && "/dashboard",
        "/account",
      ].filter(Boolean);
      expect(fromPolicy, role).toEqual(hrefs);

      stubWorkspace(me(role));
      renderRoute(HOME[role]);
      await screen.findAllByText(`${role}@${role}.local`);
      const menu = screen
        .getAllByRole("link")
        .filter((link) => link.dataset.sidebar === "menu-button")
        .map((link) => link.getAttribute("href"));
      expect(menu, role).toEqual(hrefs);
      cleanup();
    }
  });

  it("шапка оболочки по-русски: кнопка меню и мобильная панель переведены, логотип декоративный (LANG-02)", async () => {
    stubWorkspace(me("observer"));
    renderRoute("/catalog", { locale: "ru" });

    expect(await screen.findByRole("button", { name: ru.nav.toggleSidebar })).toBeTruthy();
    // Название платформы читается один раз — из sr-only, логотип рядом без alt.
    expect(screen.queryByRole("img", { name: ru.common.logoAlt })).toBeNull();
    expect(screen.getByText(ru.common.appName, { selector: ".sr-only" })).toBeTruthy();
    expect(document.querySelector('[data-sidebar="header"] img')?.getAttribute("alt")).toBe("");
  });

  it("на телефоне меню — панель с переведёнными заголовком и описанием (NFR-14)", async () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (query: string) => ({ ...matchMedia(query), matches: true });
    try {
      stubWorkspace(me("observer"));
      const { user } = renderRoute("/catalog", { locale: "ru" });

      await user.click(await screen.findByRole("button", { name: ru.nav.toggleSidebar }));
      const panel = await screen.findByRole("dialog", { name: ru.nav.sheetTitle });
      expect(within(panel).getByText(ru.nav.sheetDescription)).toBeTruthy();
      expect(within(panel).getByRole("link", { name: ru.nav.catalog }).getAttribute("href")).toBe("/catalog");
      expect(screen.queryByText("Sidebar")).toBeNull();
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it("меню наблюдателя: каталог, дашборд, аккаунт — без профиля компании", async () => {
    stubWorkspace(me("observer"));
    const { router, user } = renderRoute("/catalog", { locale: "en" });

    const catalog = await screen.findByRole("link", { name: en.nav.catalog });
    expect(catalog.getAttribute("href")).toBe("/catalog");
    expect(catalog.hasAttribute("data-active")).toBe(true);
    expect(screen.getByRole("link", { name: en.nav.dashboard }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByRole("link", { name: en.nav.account }).getAttribute("href")).toBe("/account");
    expect(screen.queryByRole("link", { name: en.nav.profile })).toBeNull();
    expect(document.querySelector('a[href="/profile"]')).toBeNull();

    await user.click(screen.getByRole("link", { name: en.nav.dashboard }));
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(await screen.findByRole("heading", { name: en.dashboard.title })).toBeTruthy();
    expect(document.title).toBe(`${en.dashboard.title} · ${en.common.appName}`);
    expect(screen.getByRole("link", { name: en.nav.dashboard }).hasAttribute("data-active")).toBe(true);
    expect(screen.getByRole("link", { name: en.nav.catalog }).hasAttribute("data-active")).toBe(false);
  });

  it("дашборд: сбой запроса — сообщение и повтор вместо вечного skeleton (OPR-08); плитки ведут в каталог (OPR-35)", async () => {
    let fail = true;
    stubApi({
      "GET /api/auth/me": { body: me("operator") },
      "GET /api/v1/dashboard": () =>
        fail
          ? Response.json({ status: 503, code: "unavailable", title: "unavailable" }, { status: 503 })
          : Response.json({ ...DASHBOARD, siteSurveyed: 7, byRegion: [{ region: "KZ-ATY", count: 7 }] }),
    });
    const { user } = renderRoute("/dashboard", { locale: "en" });

    expect(await screen.findByText(en.common.error)).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: en.common.retry }));

    const surveyed = (await screen.findByText(en.dashboard.siteSurveyed)).closest("a")!;
    expect(surveyed.getAttribute("href")).toBe("/catalog?surveyed=true");
    expect(screen.getByText("KZ-ATY").closest("a")!.getAttribute("href")).toBe("/catalog?region=KZ-ATY");
    expect(screen.queryByText(en.common.error)).toBeNull();
  });

  it("аккаунт: сброс пароля — обычная ссылка в BFF с языком", async () => {
    stubWorkspace({ ...me("operator"), user: { ...me("operator").user, fullName: "Иван Петров" } });
    renderRoute("/account", { locale: "ru" });

    expect(await screen.findByRole("heading", { name: ru.account.title })).toBeTruthy();
    expect(document.title).toBe(`${ru.account.title} · ${ru.common.appName}`);
    expect(screen.getByText(ru.roles.operator)).toBeTruthy();
    expect(screen.getByText("Иван Петров")).toBeTruthy();
    const reset = screen.getByRole("link", { name: ru.account.resetPassword });
    expect(reset.getAttribute("href")).toBe("/api/auth/password-reset?returnTo=%2Faccount&locale=ru");
    expect(screen.getByRole("button", { name: ru.auth.signOut })).toBeTruthy();
  });

  it("выход: POST /api/auth/logout и уход на redirectTo через leaveApp", async () => {
    const api = stubApi({
      "GET /api/auth/me": { body: me("observer") },
      "GET /api/v1/catalog/search": { body: EMPTY_PAGE },
      "GET /api/v1/dashboard": { body: DASHBOARD },
      "POST /api/auth/logout": { body: { redirectTo: "/kc/realms/imbc/protocol/openid-connect/logout?x=1" } },
    });
    const { user } = renderRoute("/catalog");

    const footer = await screen.findByText("observer@observer.local");
    await user.click(footer.closest("button")!);

    await waitFor(() => expect(leaveApp).toHaveBeenCalledWith("/kc/realms/imbc/protocol/openid-connect/logout?x=1"));
    expect(
      api.mock.calls.some(([url, init]) => String(url) === "/api/auth/logout" && init?.method === "POST"),
    ).toBe(true);
  });

  it("сбой выхода — сообщение в подвале меню", async () => {
    stubApi({
      "GET /api/auth/me": { body: me("observer") },
      "GET /api/v1/catalog/search": { body: EMPTY_PAGE },
      "GET /api/v1/dashboard": { body: DASHBOARD },
      "POST /api/auth/logout": problem(503, "unavailable"),
    });
    const { user } = renderRoute("/catalog");

    await user.click((await screen.findByText("observer@observer.local")).closest("button")!);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(kk.auth.logoutError)).toBeTruthy();
    expect(leaveApp).not.toHaveBeenCalled();
  });
});

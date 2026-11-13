// Оболочка рабочих страниц: интерфейс прячет недоступное, решает сервер (GEN-08, GEN-10).
import { can, type Dashboard, type OwnAdataRead, type OwnProfile, ROLES, roleHome } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import type { NonIndexRouteObject, RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { leaveApp } from "@/lib/leave-app";
import type { Me } from "@/lib/session";
import { routes } from "@/router";

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
  administrator: "/admin/accounts",
  expert: "/reviews",
  director: "/dashboard",
  operator: "/dashboard",
  observer: "/dashboard",
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

/** Вложенная страница под /catalog/:id: открывшись, она запросила бы API. */
function CompanyProbe() {
  useEffect(() => {
    void fetch("/api/v1/catalog/123");
  }, []);
  return <h1>company</h1>;
}

/** Настоящие корень и оболочка (их lazy из router.tsx) со страницей /catalog/:id и стартовыми страницами. */
function withCompanyPage(): RouteObject[] {
  const root = routes[0] as NonIndexRouteObject;
  const shell = root.children!.find((route) => route.lazy && route.children)!;
  const pages = shell.children!.filter((route) => route.path !== "catalog");
  return [
    {
      ...root,
      children: [
        {
          ...shell,
          children: [{ path: "catalog/:id", caseSensitive: true, element: <CompanyProbe /> }, ...pages],
        } as RouteObject,
        ...root.children!.filter((route) => route.path === "*"),
      ],
    },
  ];
}

const OWN_PROFILE = "/api/v1/profiles/own";
const OWN_ADATA = "/api/v1/profiles/own/adata";
const ADMIN_ACCOUNTS = "/api/v1/admin/accounts";
/** Все запросы к /api/v1 — без исключений. */
const apiCalls = (api: ReturnType<typeof stubApi>) =>
  api.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/v1/"));

/** Запросы стартовой страницы роли: после перехода с закрытой страницы других запросов к /api/v1 нет. */
const START_REQUESTS: Record<Me["user"]["role"], string[]> = {
  manufacturer: [OWN_PROFILE, OWN_ADATA],
  expert: ["/api/v1/reviews/queue"],
  administrator: [ADMIN_ACCOUNTS],
  director: ["/api/v1/dashboard"],
  operator: ["/api/v1/dashboard"],
  observer: ["/api/v1/dashboard"],
};
async function expectStartRequestsOnly(api: ReturnType<typeof stubApi>, role: Me["user"]["role"], entry?: string) {
  await waitFor(() => expect(apiCalls(api), entry).toEqual(START_REQUESTS[role]));
}
const DASHBOARD: Dashboard = {
  total: 0,
  byRegion: [],
  byCommodityGroup: [],
  siteSurveyed: 0,
  unifiedRegister: 0,
  updateStatus: { active: 0, outdated: 0, unresponsive: 0 },
  tier: { tier_1: 0, tier_2: 0 },
  generatedAt: "2026-11-11T10:00:00Z",
};

const OWN_PROFILE_BODY: OwnProfile = {
  profileId: "00000000-0000-4000-8000-000000000010",
  organizationName: "ТОО «Тест»",
  bin: "240100000001",
  status: "draft",
  hasPendingChanges: false,
  updateStatus: null,
  tier: null,
  completenessPct: 0,
  registeredAt: "2026-11-11T10:00:00Z",
  verifiedAt: null,
};

const OWN_ADATA_BODY: OwnAdataRead = { state: "not_requested", requestedAt: null, readAt: null, fields: [] };

function stubWorkspace(user: Me) {
  return stubApi({
    "GET /api/auth/me": { body: user },
    "GET /api/v1/catalog/search": { body: EMPTY_PAGE },
    "GET /api/v1/dashboard": { body: DASHBOARD },
    [`GET ${OWN_PROFILE}`]: { body: OWN_PROFILE_BODY },
    [`GET ${OWN_ADATA}`]: { body: OWN_ADATA_BODY },
    "GET /api/v1/reviews/queue": { body: { items: [], total: 0 } },
    [`GET ${ADMIN_ACCOUNTS}`]: { body: { organizations: [] } },
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

  it("производитель на /catalog уходит на /profile; администратор на /dashboard — на /admin/accounts", async () => {
    stubWorkspace(me("manufacturer"));
    let { router } = renderRoute("/catalog");
    await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
    expect(await screen.findByRole("heading", { level: 1, name: kk.nav.profile })).toBeTruthy();
    const page = within(screen.getByRole("main"));
    // Ссылка с видом кнопки остаётся ссылкой, а не кнопкой Base UI.
    expect(page.getByRole("link", { name: kk.nav.account }).getAttribute("href")).toBe("/account");
    expect(page.queryByRole("button", { name: kk.nav.account })).toBeNull();
    expect(document.title).toBe(`${kk.nav.profile} · ${kk.common.appName}`);
    // Меню производителя — профиль компании и аккаунт, без каталога и дашборда.
    expect(screen.getByRole("link", { name: kk.nav.profile }).getAttribute("href")).toBe("/profile");
    expect(screen.queryByRole("link", { name: kk.nav.catalog })).toBeNull();
    expect(screen.queryByRole("link", { name: kk.nav.dashboard })).toBeNull();

    cleanup();
    stubWorkspace(me("administrator"));
    ({ router } = renderRoute("/dashboard"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/accounts"));
    expect(await screen.findByRole("heading", { name: kk.adminAccounts.title })).toBeTruthy();
  });

  it.each(ROLES)(
    "%s со входа на / попадает на стартовую страницу роли и видит её первым пунктом меню (OPR-31)",
    async (role) => {
      const api = stubWorkspace(me(role));
      const { router } = renderRoute("/");

      await waitFor(() => expect(router.state.location.pathname).toBe(HOME[role]));
      expect(HOME[role]).toBe(roleHome(role));
      await screen.findAllByText(`${role}@${role}.local`);
      const first = screen.getAllByRole("link").find((link) => link.dataset.sidebar === "menu-button")!;
      expect(first.getAttribute("href")).toBe(HOME[role]);
      expect(first.hasAttribute("data-active")).toBe(true);
      await expectStartRequestsOnly(api, role);
    },
  );

  it("производитель на /catalog/ уходит на /profile: завершающий / не обходит шлюз роли", async () => {
    const api = stubWorkspace(me("manufacturer"));
    const { router } = renderRoute("/catalog/?q=steel");

    await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
    expect(await screen.findByRole("heading", { level: 1, name: kk.nav.profile })).toBeTruthy();
    await expectStartRequestsOnly(api, "manufacturer");
  });

  it("SME после входа и с закрытой страницы попадает на /reviews", async () => {
    for (const entry of ["/", "/dashboard/", "/profile?tab=main"]) {
      stubWorkspace(me("expert"));
      const { router } = renderRoute(entry, { locale: "ru" });
      await waitFor(() => expect(router.state.location.pathname, entry).toBe("/reviews"));
      expect(await screen.findByRole("heading", { level: 1, name: ru.reviews.title })).toBeTruthy();
      expect(document.title).toBe(`${ru.reviews.title} · ${ru.common.appName}`);
      cleanup();
    }
  });

  it("администратор с закрытой страницы (например /companies/x) попадает на /admin/accounts", async () => {
    for (const entry of ["/companies/x", "/catalog?q=steel", "/dashboard/", "/reviews", "/profile?tab=main"]) {
      const api = stubWorkspace(me("administrator"));
      const { router } = renderRoute(entry, { locale: "ru" });
      await waitFor(() => expect(router.state.location.pathname, entry).toBe("/admin/accounts"));
      expect(await screen.findByRole("heading", { level: 1, name: ru.adminAccounts.title })).toBeTruthy();
      expect(document.title).toBe(`${ru.adminAccounts.title} · ${ru.common.appName}`);
      await expectStartRequestsOnly(api, "administrator", entry);
      cleanup();
    }
  });

  it("SME на /admin/accounts уходит на свою стартовую /reviews", async () => {
    const api = stubWorkspace(me("expert"));
    const { router } = renderRoute("/admin/accounts");

    await waitFor(() => expect(router.state.location.pathname).toBe("/reviews"));
    expect(await screen.findByRole("heading", { name: kk.reviews.title })).toBeTruthy();
    await expectStartRequestsOnly(api, "expert");
    expect(screen.queryByRole("link", { name: kk.nav.adminAccounts })).toBeNull();
  });

  it("меню администратора: аккаунты, справочники и мой аккаунт; на /admin/accounts активен только пункт «Аккаунты»", async () => {
    stubWorkspace(me("administrator"));
    const { router, user } = renderRoute("/admin/accounts", { locale: "en" });

    await screen.findByRole("heading", { level: 1, name: en.adminAccounts.title });
    const menu = () => screen.getAllByRole("link").filter((link) => link.dataset.sidebar === "menu-button");
    expect(menu().map((link) => link.textContent)).toEqual([en.nav.adminAccounts, en.nav.references, en.nav.account]);
    expect(menu().map((link) => link.getAttribute("href"))).toEqual(["/admin/accounts", "/references", "/account"]);
    expect(menu().map((link) => link.hasAttribute("data-active"))).toEqual([true, false, false]);

    // «Мой аккаунт» по-прежнему открыт администратору; подсвечен только он.
    await user.click(menu()[2]!);
    await waitFor(() => expect(router.state.location.pathname).toBe("/account"));
    expect(await screen.findByRole("heading", { name: en.account.title })).toBeTruthy();
    expect(menu().map((link) => link.hasAttribute("data-active"))).toEqual([false, false, true]);
  });

  it("пункт «Справочники» — у администратора и директора (reference.read), у остальных ролей его нет; страница закрыта им шлюзом (ADM-08, GEN-08)", async () => {
    for (const role of ROLES) {
      stubWorkspace(me(role));
      const { router } = renderRoute("/references", { locale: "ru" });
      const allowed = can(role, "reference.read") !== null;
      expect(allowed, role).toBe(role === "administrator" || role === "director");

      if (allowed) {
        expect(await screen.findByRole("heading", { level: 1, name: ru.references.title }), role).toBeTruthy();
        expect(router.state.location.pathname, role).toBe("/references");
        const link = screen.getByRole("link", { name: ru.nav.references });
        expect(link.getAttribute("href"), role).toBe("/references");
        // На странице справочников подсвечен только её пункт.
        const active = screen
          .getAllByRole("link")
          .filter((item) => item.dataset.sidebar === "menu-button" && item.hasAttribute("data-active"));
        expect(
          active.map((item) => item.getAttribute("href")),
          role,
        ).toEqual(["/references"]);
      } else {
        await waitFor(() => expect(router.state.location.pathname, role).toBe(HOME[role]));
        await screen.findAllByText(`${role}@${role}.local`);
        expect(screen.queryByRole("link", { name: ru.nav.references }), role).toBeNull();
      }
      cleanup();
    }
  });

  it("директор на /reviews уходит на /dashboard", async () => {
    const api = stubWorkspace(me("director"));
    const { router } = renderRoute("/reviews?status=submitted");

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(await screen.findByRole("heading", { name: kk.dashboard.title })).toBeTruthy();
    await expectStartRequestsOnly(api, "director");
    expect(screen.queryByRole("link", { name: kk.nav.reviews })).toBeNull();
  });

  it("меню SME: очередь проверки, каталог, аккаунт", async () => {
    stubWorkspace(me("expert"));
    const { router, user } = renderRoute("/reviews", { locale: "en" });

    await screen.findByRole("heading", { level: 1, name: en.reviews.title });
    const menu = screen.getAllByRole("link").filter((link) => link.dataset.sidebar === "menu-button");
    expect(menu.map((link) => link.textContent)).toEqual([en.nav.reviews, en.nav.catalog, en.nav.account]);
    expect(menu.map((link) => link.getAttribute("href"))).toEqual(["/reviews", "/catalog", "/account"]);
    expect(menu[0]!.hasAttribute("data-active")).toBe(true);
    expect(menu[1]!.hasAttribute("data-active")).toBe(false);

    await user.click(menu[1]!);
    expect(router.state.location.pathname).toBe("/catalog");
    expect(await screen.findByRole("heading", { name: en.catalog.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.nav.reviews }).hasAttribute("data-active")).toBe(false);
  });

  it("эксперт на /dashboard/ уходит на /reviews; /catalog/ ему открыт", async () => {
    stubWorkspace(me("expert"));
    let { router } = renderRoute("/dashboard/");
    await waitFor(() => expect(router.state.location.pathname).toBe("/reviews"));
    expect(await screen.findByRole("heading", { name: kk.reviews.title })).toBeTruthy();
    cleanup();

    stubWorkspace(me("expert"));
    ({ router } = renderRoute("/catalog/"));
    expect(await screen.findByRole("heading", { name: kk.catalog.title })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/catalog/");
  });

  it("вложенный путь каталога закрыт для роли без каталога: производитель и администратор — на стартовую", async () => {
    for (const role of ["manufacturer", "administrator"] as const) {
      const api = stubWorkspace(me(role));
      const { router } = renderRoute("/catalog/123", { routes: withCompanyPage() });

      await waitFor(() => expect(router.state.location.pathname).toBe(HOME[role]));
      await screen.findAllByText(`${role}@${role}.local`);
      expect(screen.queryByRole("heading", { name: "company" })).toBeNull();
      await expectStartRequestsOnly(api, role);
      cleanup();
    }
  });

  it("производитель на /companies/x уходит на /profile, администратор — на /admin/accounts", async () => {
    for (const role of ["manufacturer", "administrator"] as const) {
      const api = stubWorkspace(me(role));
      const { router } = renderRoute("/companies/00000000-0000-4000-8000-000000000010?x=1");

      await waitFor(() =>
        expect(router.state.location.pathname).toBe(role === "manufacturer" ? "/profile" : "/admin/accounts"),
      );
      await screen.findAllByText(`${role}@${role}.local`);
      await expectStartRequestsOnly(api, role);
      cleanup();
    }
  });

  it("оператор открывает вложенный путь каталога: адрес сохраняется", async () => {
    const api = stubWorkspace(me("operator"));
    const { router } = renderRoute("/catalog/123?tab=docs", { routes: withCompanyPage() });

    expect(await screen.findByRole("heading", { name: "company" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/catalog/123");
    expect(router.state.location.search).toBe("?tab=docs");
    expect(apiCalls(api)).toEqual(["/api/v1/catalog/123"]);
  });

  it("закодированный путь /%63atalog не открывает каталог производителю", async () => {
    const api = stubWorkspace(me("manufacturer"));
    const { router } = renderRoute("/%63atalog");

    await waitFor(() => expect(router.state.location.pathname).toBe("/profile"));
    expect(await screen.findByRole("heading", { level: 1, name: kk.nav.profile })).toBeTruthy();
    await expectStartRequestsOnly(api, "manufacturer");
  });

  it("маршруты чувствительны к регистру: /CATALOG — «не найдено», без оболочки и без поиска", async () => {
    for (const role of ["manufacturer", "operator"] as const) {
      const api = stubWorkspace(me(role));
      const { router } = renderRoute("/CATALOG");

      expect(await screen.findByRole("heading", { name: kk.notFound.title })).toBeTruthy();
      expect(router.state.location.pathname).toBe("/CATALOG");
      expect(document.querySelector('[data-sidebar="sidebar"]')).toBeNull();
      expect(apiCalls(api)).toEqual([]);
      cleanup();
    }
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

    // Тот же индикатор показывает и HydrateFallback, пока грузятся чанки, — с названием платформы;
    // заголовок страницы ставит оболочка, когда её чанк загрузился, а сеанс ещё проверяется.
    await waitFor(() => expect(document.title).toBe(`${ru.dashboard.title} · ${ru.common.appName}`));
    expect(screen.getByText(ru.auth.checkingSession)).toBeTruthy();
    expect(document.querySelectorAll("title")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: ru.dashboard.title })).toBeNull();
  });

  it("меню по матрице прав; у оператора, наблюдателя и директора дашборд — первый пункт (GEN-10, OPR-31)", async () => {
    // Ожидаемые пункты; сверяются и с PolicyMatrix, чтобы тест не разошёлся с ней.
    const expected: [Me["user"]["role"], string[]][] = [
      ["operator", ["/dashboard", "/catalog", "/account"]],
      ["observer", ["/dashboard", "/catalog", "/account"]],
      ["director", ["/dashboard", "/catalog", "/references", "/account"]],
      ["expert", ["/reviews", "/catalog", "/account"]],
      ["manufacturer", ["/profile", "/account"]],
      ["administrator", ["/admin/accounts", "/references", "/account"]],
    ];
    expect(expected.map(([role]) => role).sort()).toEqual([...ROLES].sort());
    for (const [role, hrefs] of expected) {
      const fromPolicy = [
        can(role, "dashboard.read") && "/dashboard",
        can(role, "review.take") && "/reviews",
        can(role, "catalog.search") && "/catalog",
        can(role, "profile.edit") && "/profile",
        can(role, "accounts.manage") && "/admin/accounts",
        can(role, "reference.read") && "/references",
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

  it("рабочая область сужается до окна: широкая таблица каталога прокручивается внутри, а не растягивает страницу", async () => {
    stubWorkspace(me("observer"));
    renderRoute("/catalog", { locale: "kk" });

    await screen.findByRole("heading", { name: kk.catalog.title });
    // jsdom не считает раскладку: проверяется класс, который снимает min-width: auto у flex-элемента.
    expect(document.querySelector('main[data-slot="sidebar-inset"]')?.classList.contains("min-w-0")).toBe(true);
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
    expect(api.mock.calls.some(([url, init]) => String(url) === "/api/auth/logout" && init?.method === "POST")).toBe(
      true,
    );
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

  it("кнопка выхода в подвале меню называет действие и содержит видимый адрес (WCAG 2.5.3)", async () => {
    for (const [locale, messages] of [
      ["kk", kk],
      ["ru", ru],
      ["en", en],
    ] as const) {
      stubWorkspace(me("observer"));
      renderRoute("/catalog", { locale });

      const visible = await screen.findByText("observer@observer.local");
      const button = visible.closest("button")!;
      const name = messages.nav.signOutAs.replace("{email}", "observer@observer.local");
      expect(screen.getByRole("button", { name })).toBe(button);
      expect(name).toContain(messages.common.signOut);
      expect(name).toContain(visible.textContent);
      cleanup();
    }
  });
});

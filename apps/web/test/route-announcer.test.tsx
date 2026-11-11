// Смена страницы объявляется экранному диктору: фокус после перехода остаётся на ссылке меню,
// поэтому заголовок новой страницы зачитывает вежливая live-область корня маршрутов.
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/session";

import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const OPERATOR: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "operator@operator.local",
    fullName: null,
    role: "operator",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "operator",
    locale: "ru",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/catalog",
  otpDelivery: "email",
};

function stubWorkspace() {
  stubApi({
    "GET /api/auth/me": { body: OPERATOR },
    "GET /api/v1/catalog/search": () => Response.json({ items: [], total: 0, page: 1, pageSize: 25 }),
    "GET /api/v1/dashboard": {
      body: {
        total: 0,
        byRegion: [],
        byCommodityGroup: [],
        siteSurveyed: 0,
        unifiedRegister: 0,
        updateStatus: { active: 0, outdated: 0, unresponsive: 0 },
        generatedAt: "2026-11-11T10:00:00Z",
      },
    },
  });
}

const announcer = () => document.getElementById("route-announcer")!;

describe("объявление смены страницы", () => {
  it("переход на другую страницу — область зачитывает её заголовок на языке интерфейса", async () => {
    stubWorkspace();
    const { router } = renderRoute("/catalog", { locale: "ru" });
    expect(await screen.findByRole("heading", { name: ru.catalog.title })).toBeTruthy();

    // Первая отрисовка не объявляется: диктор и так читает загруженную страницу.
    expect(announcer().getAttribute("aria-live")).toBe("polite");
    expect(announcer().className).toContain("sr-only");
    expect(announcer().textContent).toBe("");

    await router.navigate("/dashboard");
    expect(await screen.findByRole("heading", { name: ru.dashboard.title })).toBeTruthy();
    await waitFor(() => expect(announcer().textContent).toBe(`${ru.dashboard.title} · ${ru.common.appName}`));
  });

  it("смена только query string (фильтры каталога) не объявляется", async () => {
    stubWorkspace();
    const { router } = renderRoute("/dashboard", { locale: "ru" });
    expect(await screen.findByRole("heading", { name: ru.dashboard.title })).toBeTruthy();

    await router.navigate("/catalog");
    expect(await screen.findByRole("heading", { name: ru.catalog.title })).toBeTruthy();
    const catalog = `${ru.catalog.title} · ${ru.common.appName}`;
    await waitFor(() => expect(announcer().textContent).toBe(catalog));

    // Любое изменение текста области диктор зачитал бы заново: при смене фильтров их нет.
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(announcer(), { childList: true, characterData: true, subtree: true });
    await router.navigate("/catalog?surveyed=true");
    await waitFor(() => expect(router.state.location.search).toBe("?surveyed=true"));
    await router.navigate("/catalog?surveyed=true&page=2");
    await waitFor(() => expect(router.state.location.search).toBe("?surveyed=true&page=2"));
    mutations.push(...observer.takeRecords());
    observer.disconnect();
    expect(mutations).toEqual([]);
    expect(announcer().textContent).toBe(catalog);
  });
});

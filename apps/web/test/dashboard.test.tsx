// Дашборд (OPR-31…35): тип ответа — Dashboard из @imbc/contracts; каждый счётчик ведёт в каталог
// с тем же фильтром (OPR-35).
import { type Dashboard, dashboardSchema } from "@imbc/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const OBSERVER: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "observer@observer.local",
    fullName: null,
    role: "observer",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "imbc",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/dashboard",
  otpDelivery: "email",
};

const DASHBOARD: Dashboard = dashboardSchema.parse({
  total: 1234,
  byRegion: [{ region: "KZ-ATY", count: 7 }],
  byCommodityGroup: [{ group: "A", count: 5 }],
  siteSurveyed: 3,
  unifiedRegister: 2,
  updateStatus: { active: 10, outdated: 4, unresponsive: 1 },
  tier: { tier_1: 1200, tier_2: 34 },
  generatedAt: "2026-11-11T10:00:00Z",
});

const searches = (api: Mock<typeof fetch>) =>
  api.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/v1/catalog/search"));

describe("дашборд (OPR-32, OPR-35)", () => {
  it("плитки «Тир 1» и «Тир 2» показывают счётчики и ведут в каталог с фильтром тира", async () => {
    stubApi({ "GET /api/auth/me": { body: OBSERVER }, "GET /api/v1/dashboard": { body: DASHBOARD } });
    renderRoute("/dashboard", { locale: "ru" });

    const tier1 = (await screen.findByText(ru.dashboard.tier1)).closest("a")!;
    const tier2 = screen.getByText(ru.dashboard.tier2).closest("a")!;
    expect(tier1.getAttribute("href")).toBe("/catalog?tier=tier_1");
    expect(tier2.getAttribute("href")).toBe("/catalog?tier=tier_2");
    // Числа — через useFormat, с разделителем групп языка (LANG-04).
    // Testing Library сводит неразрывный пробел между разрядами к обычному.
    expect(within(tier1).getByText("1 200")).toBeTruthy();
    expect(within(tier2).getByText("34")).toBeTruthy();
  });

  it("плитка тира открывает каталог с уже применённым фильтром (OPR-35)", async () => {
    const api = stubApi({
      "GET /api/auth/me": { body: OBSERVER },
      "GET /api/v1/dashboard": { body: DASHBOARD },
      "GET /api/v1/catalog/search": { body: { items: [], total: 0, page: 1, pageSize: 25 } },
    });
    const { router, user } = renderRoute("/dashboard", { locale: "en" });

    await user.click(await screen.findByText(en.dashboard.tier2));

    expect(await screen.findByRole("heading", { name: en.catalog.title })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/catalog");
    expect(router.state.location.search).toBe("?tier=tier_2");
    await waitFor(() => expect(searches(api)).toEqual(["/api/v1/catalog/search?tier=tier_2"]));
    const tier = screen.getByRole("button", { name: new RegExp(`^${en.catalog.tier}`) });
    expect(within(tier).getByText("1")).toBeTruthy();
  });

  it("ответ прежней версии API без tier: плиток тира нет, остальные на месте, без экрана ошибки", async () => {
    const older: Partial<Dashboard> = { ...DASHBOARD };
    delete older.tier;
    stubApi({ "GET /api/auth/me": { body: OBSERVER }, "GET /api/v1/dashboard": { body: older } });
    renderRoute("/dashboard", { locale: "en" });

    const total = (await screen.findByText(en.dashboard.total)).closest("a")!;
    expect(total.getAttribute("href")).toBe("/catalog");
    expect(screen.getByText(en.dashboard.siteSurveyed)).toBeTruthy();
    expect(screen.getByText(en.dashboard.unresponsive)).toBeTruthy();
    expect(screen.queryByText(en.dashboard.tier1)).toBeNull();
    expect(screen.queryByText(en.dashboard.tier2)).toBeNull();
    expect(screen.queryByRole("heading", { name: en.routeError.title })).toBeNull();
  });

  it("пока счётчики грузятся — скелет по числу плиток", async () => {
    let reply: ((response: Response) => void) | undefined;
    stubApi({
      "GET /api/auth/me": { body: OBSERVER },
      "GET /api/v1/dashboard": () =>
        new Promise<Response>((resolve) => {
          reply = resolve;
        }) as unknown as Response,
    });
    renderRoute("/dashboard");

    expect(await screen.findByRole("heading", { name: kk.dashboard.title })).toBeTruthy();
    await waitFor(() => expect(reply).toBeDefined());
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]').length;

    reply!(Response.json(DASHBOARD));
    const tiles = (await screen.findByText(kk.dashboard.total)).closest("a")!.parentElement!;
    expect(tiles.children).toHaveLength(skeletons);
    expect(within(tiles).getByText(kk.dashboard.tier1)).toBeTruthy();
  });
});

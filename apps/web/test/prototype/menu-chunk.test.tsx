// Чанк меню прототипа не загрузился: готовая страница и меню роли на месте (GEN-08, NFR-15).
import type { Dashboard } from "@imbc/contracts";
import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import { renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
vi.mock("@/prototype/menu", () => Promise.reject(new Error("chunk failed")));

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

describe("чанк меню прототипа", () => {
  it("не загрузился — группы нет, страница и готовые пункты меню целы", async () => {
    renderCabinet("/dashboard", { role: "operator", api: { "GET /api/v1/dashboard": { body: DASHBOARD } } });
    expect(await screen.findByRole("heading", { level: 1, name: en.dashboard.title })).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole("heading", { level: 1, name: en.dashboard.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.nav.catalog })).toBeTruthy();
  });
});

// Устаревший чанк самого меню прототипа: одна перезагрузка, готовая страница на месте.
import type { Dashboard } from "@imbc/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { reloadApp } from "@/lib/leave-app";
import { PROTOTYPE_RELOAD } from "@/prototype/boundary";

import en from "../../messages/en.json";
import { renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
// Чтение экспорта бросает ошибку устаревшего чанка: так она проходит тот же .catch у import() в
// app-shell.tsx. Отклонить сам import через vi.mock нельзя — vitest заменяет сообщение своим.
vi.mock("@/prototype/menu", () => ({
  get PrototypeMenu() {
    throw new TypeError("Failed to fetch dynamically imported module: /assets/menu-old.js");
  },
}));

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

afterEach(() => {
  window.sessionStorage.clear();
});

describe("устаревший чанк меню прототипа", () => {
  it("одна перезагрузка; страница и готовые пункты меню целы", async () => {
    renderCabinet("/dashboard", { role: "operator", api: { "GET /api/v1/dashboard": { body: DASHBOARD } } });
    expect(await screen.findByRole("heading", { level: 1, name: en.dashboard.title })).toBeTruthy();
    await waitFor(() => expect(reloadApp).toHaveBeenCalledOnce());
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole("heading", { level: 1, name: en.dashboard.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.nav.catalog })).toBeTruthy();
  });

  it("флаг перезагрузки у import() меню — тот же, что у границы меню", () => {
    const shell = readFileSync(resolve(import.meta.dirname, "../../src/components/app/app-shell.tsx"), "utf8");
    expect(shell).toContain(`reloadOnce("${PROTOTYPE_RELOAD}")`);
  });
});

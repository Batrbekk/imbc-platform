// Устаревший чанк модуля роли (вкладка старше выката): одна перезагрузка, как у страниц приложения.
import type { Role } from "@imbc/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reloadApp } from "@/lib/leave-app";
import { PROTOTYPE_RELOAD } from "@/prototype/boundary";
import { cabinets, loadCabinet } from "@/prototype/registry";

import en from "../../messages/en.json";
import { renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
// Так браузер сообщает о чанке, которого после выката нет (isChunkLoadError). Не через vi.mock:
// vitest заворачивает ошибку фабрики в своё сообщение.
const staleChunk = (name: string) => () =>
  Promise.reject(new TypeError(`Failed to fetch dynamically imported module: /assets/${name}-old.js`));

async function settle(role: Role) {
  await act(async () => {
    await loadCabinet(role).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(cabinets, "operator").mockImplementation(staleChunk("operator"));
  vi.spyOn(cabinets, "expert").mockImplementation(staleChunk("expert"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(reloadApp).mockClear();
  window.sessionStorage.clear();
});

describe("устаревший чанк модуля роли", () => {
  it("меню: одна перезагрузка, готовая страница на месте", async () => {
    renderCabinet("/reviews", {
      role: "expert",
      api: { "GET /api/v1/reviews/queue": { body: { items: [], total: 0 } } },
    });
    expect(await screen.findByRole("heading", { level: 1, name: en.reviews.title })).toBeTruthy();
    await settle("expert");
    expect(reloadApp).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { level: 1, name: en.reviews.title })).toBeTruthy();
  });

  it("меню: перезагрузка уже была — без новой и без ошибки", async () => {
    window.sessionStorage.setItem(PROTOTYPE_RELOAD, "1");
    renderCabinet("/reviews", {
      role: "expert",
      api: { "GET /api/v1/reviews/queue": { body: { items: [], total: 0 } } },
    });
    expect(await screen.findByRole("heading", { level: 1, name: en.reviews.title })).toBeTruthy();
    await settle("expert");
    expect(reloadApp).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: en.reviews.title })).toBeTruthy();
  });

  it("экран: не «сбросьте демо-данные», а обработка маршрута — перезагрузка", async () => {
    renderCabinet("/proto/operator/x", { role: "operator" });
    await waitFor(() => expect(reloadApp).toHaveBeenCalled());
    await settle("operator");
    expect(screen.queryByRole("heading", { name: "This prototype screen failed" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset demo data" })).toBeNull();
  });
});

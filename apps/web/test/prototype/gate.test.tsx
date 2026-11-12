// Шлюз роли прототипа: чужой модуль по прямому адресу не открывается (GEN-08).
import { screen, waitFor } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROTOTYPE } from "@/prototype/flag";
import { routes } from "@/router";

import en from "../../messages/en.json";
import { apiV1Calls, renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const paths = (list: RouteObject[] = []): string[] => list.flatMap((r) => [r.path ?? "", ...paths(r.children)]);

describe("шлюз роли /proto/<role>", () => {
  it("с флагом сборки маршрут прототипа есть", () => {
    expect(PROTOTYPE).toBe(true);
    expect(paths(routes)).toContain("proto/:role/*");
  });

  it("чужая роль → стартовая страница своей роли", async () => {
    const { router } = renderCabinet("/proto/operator/marks", {
      role: "expert",
      api: { "GET /api/v1/reviews/queue": { body: { items: [], total: 0 } } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/reviews"));
  });

  it("неизвестная роль и неизвестный экран своей роли — «не найдено» внутри оболочки", async () => {
    const { router, api } = renderCabinet("/proto/nobody/x", { role: "operator" });
    expect(await screen.findByRole("heading", { name: en.notFound.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.nav.dashboard })).toBeTruthy();

    await router.navigate("/proto/operator/unknown-screen");
    expect(await screen.findByRole("heading", { name: en.notFound.title })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/proto/operator/unknown-screen");
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("регистр в адресе значим: /PROTO — страница «не найдено» вне оболочки", async () => {
    renderCabinet("/PROTO/operator/x", { role: "operator" });
    expect(await screen.findByRole("heading", { name: en.notFound.title })).toBeTruthy();
    expect(screen.queryByRole("link", { name: en.nav.dashboard })).toBeNull();
  });
});

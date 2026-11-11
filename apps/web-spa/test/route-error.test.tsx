// Ошибка маршрута: чанк страницы старше выката — одна перезагрузка, иначе экран на языке пользователя.
import { screen, waitFor } from "@testing-library/react";
import type { NonIndexRouteObject, RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reloadApp } from "@/lib/leave-app";
import type { Me } from "@/lib/session";
import { routes } from "@/router";

import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

const FLAG = "imbc:lazy-reload";

/** Корень приложения (тот же ErrorBoundary) с одной ленивой страницей. */
function withPage(lazy: RouteObject["lazy"]): RouteObject[] {
  return [{ ...(routes[0] as NonIndexRouteObject), children: [{ path: "page", lazy } as RouteObject] }];
}

const staleChunk = async (): Promise<never> => {
  throw new TypeError("Failed to fetch dynamically imported module: http://localhost/assets/catalog-Cx5Cpk_9.js");
};

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ошибка маршрута (LANG-02)", () => {
  it("чанк страницы не загрузился — одна перезагрузка с флагом", async () => {
    renderRoute("/page", { routes: withPage(staleChunk) });

    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(FLAG)).not.toBeNull();
    // Пока браузер перезагружает страницу — индикатор, а не сообщение об ошибке.
    expect(screen.queryByRole("heading", { name: kk.routeError.title })).toBeNull();
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("перезагрузка уже была — сообщение на языке пользователя и кнопка, без новой перезагрузки", async () => {
    sessionStorage.setItem(FLAG, "1");
    const { user } = renderRoute("/page", { locale: "ru", routes: withPage(staleChunk) });

    expect(await screen.findByRole("heading", { name: ru.routeError.title })).toBeTruthy();
    expect(screen.getByText(ru.routeError.description)).toBeTruthy();
    expect(document.title).toBe(`${ru.routeError.title} · ${ru.common.appName}`);
    expect(document.querySelectorAll("title")).toHaveLength(1);
    expect(reloadApp).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: ru.routeError.reload }));
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });

  it("другая ошибка маршрута — тот же экран без автоматической перезагрузки", async () => {
    renderRoute("/page", {
      routes: withPage(async () => {
        throw new Error("boom");
      }),
    });

    expect(await screen.findByRole("heading", { name: kk.routeError.title })).toBeTruthy();
    expect(reloadApp).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(FLAG)).toBeNull();
  });

  it("sessionStorage недоступен — сообщение вместо перезагрузки", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    try {
      renderRoute("/page", { routes: withPage(staleChunk) });
      expect(await screen.findByRole("heading", { name: kk.routeError.title })).toBeTruthy();
      expect(reloadApp).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
    }
  });

  it("успешная загрузка ленивой страницы снимает флаг", async () => {
    sessionStorage.setItem(FLAG, "1");
    const manufacturer: Me = {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "manufacturer@manufacturer.local",
        fullName: null,
        role: "manufacturer",
        organizationId: "00000000-0000-4000-8000-000000000002",
        organizationType: "manufacturer",
        locale: "kk",
      },
      gates: { mfa: true, responsibility: true },
      homePath: "/profile",
    };
    stubApi({ "GET /api/auth/me": { body: manufacturer } });
    renderRoute("/profile");

    expect(await screen.findByText(kk.profile.welcome)).toBeTruthy();
    expect(sessionStorage.getItem(FLAG)).toBeNull();
    expect(reloadApp).not.toHaveBeenCalled();
  });
});

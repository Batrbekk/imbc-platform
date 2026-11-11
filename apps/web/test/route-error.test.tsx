// Ошибка маршрута: чанк страницы старше выката — одна перезагрузка, иначе экран на языке пользователя.
import { screen, waitFor } from "@testing-library/react";
import type { NonIndexRouteObject, RouteObject } from "react-router";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

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

/** Корень приложения и настоящая ленивая оболочка (её lazy из router.tsx) с одной ленивой страницей. */
function withLayout(page: RouteObject["lazy"]): RouteObject[] {
  const root = routes[0] as NonIndexRouteObject;
  const shell = root.children!.find((route) => route.lazy && route.children)!;
  return [
    { ...root, children: [{ ...shell, children: [{ path: "page", lazy: page } as RouteObject] } as RouteObject] },
  ];
}

const CHUNK_ERROR = "Failed to fetch dynamically imported module: http://localhost/assets/catalog-Cx5Cpk_9.js";
const staleChunk = async (): Promise<never> => {
  throw new TypeError(CHUNK_ERROR);
};

const MANUFACTURER: Me = {
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

// В разработке RouteError пишет ошибку в консоль; здесь вывод перехватывается и проверяется.
let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  sessionStorage.clear();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.clearAllMocks();
});

describe("ошибка маршрута (LANG-02)", () => {
  it("чанк страницы не загрузился — одна перезагрузка с флагом", async () => {
    renderRoute("/page", { routes: withPage(staleChunk) });

    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(FLAG)).not.toBeNull();
    // Пока браузер перезагружает страницу — индикатор, а не сообщение об ошибке.
    expect(screen.queryByRole("heading", { name: kk.routeError.title })).toBeNull();
    // Нейтральный текст, не «Проверяем доступ…»: это не проверка сеанса.
    expect(screen.getByText(kk.common.loading)).toBeTruthy();
    expect(screen.queryByText(kk.auth.checkingSession)).toBeNull();
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("после перезагрузки оболочка загрузилась, а страница снова нет — экран ошибки, без новой перезагрузки", async () => {
    sessionStorage.setItem(FLAG, "1");
    renderRoute("/page", { locale: "ru", routes: withLayout(staleChunk) });

    expect(await screen.findByRole("heading", { name: ru.routeError.title })).toBeTruthy();
    expect(reloadApp).not.toHaveBeenCalled();
    // Флаг не снят загрузкой одного чанка: ветка маршрутов так и не отрисовалась.
    expect(sessionStorage.getItem(FLAG)).not.toBeNull();
  });

  it("Safari: модуль с неверным MIME-типом — тоже сбой чанка (одна перезагрузка)", async () => {
    renderRoute("/page", {
      routes: withPage(async () => {
        throw new TypeError("'text/html' is not a valid JavaScript MIME type.");
      }),
    });

    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1));
  });

  it("флаг не записался (проба прошла, запись — нет) — экран ошибки, а не вечный индикатор", async () => {
    const setItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === FLAG) throw new DOMException("quota", "QuotaExceededError");
      setItem.call(this, key, value);
    });
    try {
      renderRoute("/page", { routes: withPage(staleChunk) });
      expect(await screen.findByRole("heading", { name: kk.routeError.title })).toBeTruthy();
      expect(reloadApp).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("перезагрузка уже была — сообщение на языке пользователя и кнопка, без новой перезагрузки", async () => {
    sessionStorage.setItem(FLAG, "1");
    const { user } = renderRoute("/page", { locale: "ru", routes: withPage(staleChunk) });

    expect(await screen.findByRole("heading", { name: ru.routeError.title })).toBeTruthy();
    expect(screen.getByText(ru.routeError.description)).toBeTruthy();
    // Экран заменяет корень вместе с областью объявлений: диктору его объявляет сама карточка.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(ru.routeError.title);
    expect(alert.textContent).toContain(ru.routeError.description);
    // В разработке ошибка не прячется за общим экраном.
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: CHUNK_ERROR }));
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
    expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
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

  it("флаг снимается только после отрисовки всей ветки, а не после первого загруженного чанка", async () => {
    sessionStorage.setItem(FLAG, "1");
    stubApi({ "GET /api/auth/me": { body: MANUFACTURER } });
    let finishPage: (() => void) | undefined;
    const pageLoads = () =>
      new Promise<{ Component: () => React.JSX.Element }>((resolve) => {
        finishPage = () => resolve({ Component: () => <p>page</p> });
      });
    // Адрес /page разрешён производителю: authDestination пропускает неизвестные пути.
    renderRoute("/page", { routes: withLayout(pageLoads as RouteObject["lazy"]) });

    // Оболочка уже загружена, страница — ещё нет: флаг на месте.
    await waitFor(() => expect(finishPage).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionStorage.getItem(FLAG)).not.toBeNull();

    finishPage!();
    expect(await screen.findByText("page")).toBeTruthy();
    await waitFor(() => expect(sessionStorage.getItem(FLAG)).toBeNull());
    expect(reloadApp).not.toHaveBeenCalled();
  });

  it("успешная загрузка ленивой страницы снимает флаг", async () => {
    sessionStorage.setItem(FLAG, "1");
    stubApi({ "GET /api/auth/me": { body: MANUFACTURER } });
    renderRoute("/profile");

    expect(await screen.findByText(kk.profile.welcome)).toBeTruthy();
    await waitFor(() => expect(sessionStorage.getItem(FLAG)).toBeNull());
    expect(reloadApp).not.toHaveBeenCalled();
  });
});

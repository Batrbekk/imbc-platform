// Страница из back/forward cache после выхода не должна показывать данные прежнего
// пользователя (NFR-11): восстановленная из кеша вкладка перезагружается и проверяет сеанс заново.
import { afterEach, describe, expect, it, vi } from "vitest";

import { reloadFromBackForwardCache, watchBackForwardCache } from "@/lib/bfcache";
import { reloadApp } from "@/lib/leave-app";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const pageshow = (persisted: boolean) => new PageTransitionEvent("pageshow", { persisted });

describe("back/forward cache", () => {
  it("страница восстановлена из кеша (persisted: true) — одна перезагрузка", () => {
    const stop = watchBackForwardCache();
    try {
      window.dispatchEvent(pageshow(true));
      expect(reloadApp).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  it("обычная загрузка (persisted: false) — без перезагрузки", () => {
    const stop = watchBackForwardCache();
    try {
      window.dispatchEvent(pageshow(false));
      expect(reloadApp).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });

  it("после снятия подписки событие ничего не делает", () => {
    watchBackForwardCache()();
    window.dispatchEvent(pageshow(true));
    expect(reloadApp).not.toHaveBeenCalled();
  });

  it("обработчик сам по себе: persisted: true — перезагрузка, false — ничего", () => {
    reloadFromBackForwardCache(pageshow(false));
    expect(reloadApp).not.toHaveBeenCalled();
    reloadFromBackForwardCache(pageshow(true));
    expect(reloadApp).toHaveBeenCalledTimes(1);
  });
});

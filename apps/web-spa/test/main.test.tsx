// Старт приложения: сбой загрузки файла переводов не оставляет пустую страницу и не зацикливается.
import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";
import { reloadApp } from "@/lib/leave-app";

import en from "../messages/en.json";

vi.mock("@/i18n/messages", () => ({ loadMessages: vi.fn() }));
vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
vi.mock("@/app", () => ({ App: () => <p>app</p> }));

const FLAG = "imbc:startup-reload";

/** Выполняет main.tsx заново, как при открытии вкладки. */
async function start() {
  vi.resetModules();
  await import("@/main");
}

beforeEach(() => {
  document.body.innerHTML = '<div id="root"></div>';
  sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

describe("старт приложения", () => {
  it("файл переводов не загрузился — одна перезагрузка с флагом в sessionStorage", async () => {
    vi.mocked(loadMessages).mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    await start();

    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(FLAG)).not.toBeNull();
  });

  it("повторный сбой после перезагрузки — без новой перезагрузки", async () => {
    vi.mocked(loadMessages).mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    sessionStorage.setItem(FLAG, "1");
    await start();

    await waitFor(() => expect(loadMessages).toHaveBeenCalledTimes(1));
    // Даём отказу дойти до обработчика.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reloadApp).not.toHaveBeenCalled();
  });

  it("после успешного рендера флаг снимается", async () => {
    vi.mocked(loadMessages).mockResolvedValue(en);
    sessionStorage.setItem(FLAG, "1");
    await start();

    expect(await screen.findByText("app")).toBeTruthy();
    expect(sessionStorage.getItem(FLAG)).toBeNull();
    expect(reloadApp).not.toHaveBeenCalled();
  });
});

// Старт приложения: сбой загрузки файла переводов не оставляет пустую страницу и не зацикливается.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadMessages } from "@/i18n/messages";
import { reloadApp } from "@/lib/leave-app";

import en from "../messages/en.json";

vi.mock("@/i18n/messages", () => ({ loadMessages: vi.fn() }));
vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
vi.mock("@/app", () => ({ App: () => <p>app</p> }));

const FLAG = "imbc:startup-reload";

// vitest запускается из каталога пакета (apps/web).
const INDEX_HTML = resolve(process.cwd(), "index.html");

// Тело настоящего index.html: статичное сообщение о сбое старта живёт в нём, без файла переводов.
const INDEX_BODY = new DOMParser().parseFromString(
  readFileSync(INDEX_HTML, "utf8"),
  "text/html",
).body.innerHTML;

const startupError = () => document.getElementById("startup-error")!;

/** Выполняет main.tsx заново, как при открытии вкладки. */
async function start() {
  vi.resetModules();
  await import("@/main");
}

beforeEach(() => {
  document.body.innerHTML = INDEX_BODY;
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
    expect(startupError().hidden).toBe(true);
  });

  it("повторный сбой после перезагрузки — без новой перезагрузки", async () => {
    vi.mocked(loadMessages).mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    sessionStorage.setItem(FLAG, "1");
    await start();

    await waitFor(() => expect(loadMessages).toHaveBeenCalledTimes(1));
    // Вместо пустой страницы — статичное сообщение на трёх языках.
    await waitFor(() => expect(startupError().hidden).toBe(false));
    expect(startupError().textContent).toContain("Не удалось загрузить платформу");
    expect(startupError().textContent).toContain("The platform could not be loaded");
    expect(startupError().querySelector('[lang="kk"]')).not.toBeNull();
    expect(reloadApp).not.toHaveBeenCalled();
  });

  it("sessionStorage недоступен — статичное сообщение, без перезагрузки и без необработанной ошибки", async () => {
    vi.mocked(loadMessages).mockRejectedValue(new Error("Failed to fetch dynamically imported module"));
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    try {
      await start();
      await waitFor(() => expect(startupError().hidden).toBe(false));
      expect(reloadApp).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
    }
  });

  it("в index.html сообщение скрыто, без inline-скриптов и обработчиков (CSP script-src 'self')", () => {
    expect(startupError().hidden).toBe(true);
    const html = readFileSync(INDEX_HTML, "utf8");
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      expect(script[1]).toContain("src=");
      expect(script[2].trim()).toBe("");
    }
    expect(html).not.toMatch(/\son[a-z]+=/i);
  });

  it("после успешного рендера флаг снимается", async () => {
    vi.mocked(loadMessages).mockResolvedValue(en);
    sessionStorage.setItem(FLAG, "1");
    await start();

    expect(await screen.findByText("app")).toBeTruthy();
    expect(sessionStorage.getItem(FLAG)).toBeNull();
    expect(startupError().hidden).toBe(true);
    expect(reloadApp).not.toHaveBeenCalled();
  });
});

// CSP образа (infrastructure/nginx/web.conf) разрешает только script-src 'self' (NFR-11):
// inline-скрипт или обработчик события в шаблоне браузер заблокирует.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// В окружении jsdom URL не файловый: путь строится от каталога теста.
const html = readFileSync(resolve(import.meta.dirname, "../index.html"), "utf8");

describe("index.html под CSP", () => {
  it("в index.html нет inline-скриптов", () => {
    expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)).toBeNull();
  });

  it("в index.html нет inline-обработчиков событий", () => {
    expect(html.match(/<[^>]*\son[a-z]+\s*=/gi)).toBeNull();
  });

  // Без своего значка браузер запрашивает /favicon.ico и получает index.html — во вкладке остаётся
  // чужой значок. Файл из public/ попадает в корень сборки, nginx отдаёт его как файл.
  it("значок сайта ссылается на файл из public/", () => {
    const href = html.match(/<link\s[^>]*rel="icon"[^>]*\bhref="([^"]+)"/)?.[1];
    expect(href).toMatch(/^\/[\w.-]+$/);
    expect(existsSync(resolve(import.meta.dirname, "../public", href!.slice(1)))).toBe(true);
  });
});

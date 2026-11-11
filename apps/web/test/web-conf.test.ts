// Кеширование в образе web (infrastructure/nginx/web.conf). Страницы приложения не хранятся
// в браузере (NFR-11, ASVS 5.0 V14.3.2): после выхода «Назад» не показывает страницу прежнего
// пользователя из кеша. Хешированные файлы сборки кешируются на год.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// В окружении jsdom URL не файловый: путь строится от каталога теста.
const conf = readFileSync(resolve(import.meta.dirname, "../../../infrastructure/nginx/web.conf"), "utf8");

/** Тело блока `location <path> { … }` (вложенных блоков в web.conf нет). */
function location(path: string): string {
  const escaped = path.replace(/[/.]/g, "\\$&");
  const match = conf.match(new RegExp(`location\\s+${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`в web.conf нет location ${path}`);
  return match[1];
}

const cacheControl = (block: string) =>
  [...block.matchAll(/add_header\s+Cache-Control\s+"([^"]*)"/g)].map((header) => header[1]);

describe("web.conf: кеширование", () => {
  it("страницы (location /, всё, что отвечает index.html) — Cache-Control: no-store", () => {
    const block = location("/");
    expect(cacheControl(block)).toEqual(["no-store"]);
    expect(block).toMatch(/try_files\s+\$uri\s+\/index\.html;/);
  });

  it("хешированные файлы /assets/ — на год и immutable, отсутствующий файл — 404", () => {
    const block = location("/assets/");
    expect(cacheControl(block)).toEqual(["public, max-age=31536000, immutable"]);
    expect(block).toMatch(/try_files\s+\$uri\s+@missing_asset;/);
  });

  it("404 для отсутствующего файла /assets/ — no-store: промежуточный кеш не удержит его после выката", () => {
    const block = location("@missing_asset");
    // Без always nginx не добавляет заголовок к ответу 404.
    expect(block).toMatch(/add_header\s+Cache-Control\s+"no-store"\s+always;/);
    expect(block).toMatch(/return\s+404;/);
  });
});

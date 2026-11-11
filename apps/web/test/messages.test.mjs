import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Три языка не расходятся (LANG-01, AGENTS.md): каждый видимый текст есть в kk, ru и en.
const LOCALES = ["kk", "ru", "en"];
const messages = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")),
  ]),
);

function keyPaths(node, prefix = "") {
  if (node === null || typeof node !== "object") return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keyPaths(value, prefix ? `${prefix}.${key}` : key));
}

function has(locale, path) {
  return keyPaths(messages[locale]).includes(path);
}

test("kk, ru и en содержат одинаковые ключи", () => {
  const [reference, ...others] = LOCALES.map((locale) => keyPaths(messages[locale]).sort());
  for (const keys of others) assert.deepEqual(keys, reference);
});

test("переводы v1.3 на месте, прежних ключей нет", () => {
  // Раздел 3.1 и UPD-06: observer вместо spectator, unresponsive вместо inactive.
  for (const locale of LOCALES) {
    for (const path of ["roles.observer", "catalog.status.unresponsive", "dashboard.unresponsive"])
      assert.ok(has(locale, path), `${locale}: нет ключа ${path}`);
    for (const path of ["roles.spectator", "catalog.status.inactive", "dashboard.inactive"])
      assert.ok(!has(locale, path), `${locale}: остался ключ ${path}`);
    // Состояние аккаунта inactive (AUTH-07) не переименовывается.
    assert.ok(has(locale, "login.errors.account_inactive"), `${locale}: нет ключа login.errors.account_inactive`);
  }
});

// Казахский интерфейс в Chrome: в ICU браузера нет данных для kk, и Intl с локалью kk отдаёт
// корневой шаблон («2026 M10 15», «1,234,567.5»). Даты и числа казахского интерфейса не должны
// доходить до Intl с локалью kk (LANG-01, LANG-04, NFR-13).
import type { CatalogItem } from "@imbc/contracts";
import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/session";

import kk from "../messages/kk.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

const ORIGINAL = { DateTimeFormat: Intl.DateTimeFormat, NumberFormat: Intl.NumberFormat };
/** Локали kk, с которыми код создал Intl.DateTimeFormat или Intl.NumberFormat. */
let kazakhRequests: string[] = [];

const isKazakh = (locales: unknown) =>
  [locales].flat().some((locale) => typeof locale === "string" && /^kk(-|$)/i.test(locale));

/**
 * Intl как в Chrome 156: для kk — корневые шаблоны CLDR. Дата — «y Mmm d» с месяцем «M10»,
 * число — запятая между группами и точка в дроби.
 */
function emulateChromeWithoutKazakhData() {
  function DateTimeFormat(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    if (!isKazakh(locales)) return new ORIGINAL.DateTimeFormat(locales, options);
    kazakhRequests.push(String(locales));
    const numeric = new ORIGINAL.DateTimeFormat("en-US", {
      timeZone: options?.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const root = (value?: Date | number) => {
      const part = (type: string) => numeric.formatToParts(value).find((p) => p.type === type)!.value;
      return `${part("year")} M${part("month")} ${Number(part("day"))}`;
    };
    return { format: root, formatToParts: (value?: Date | number) => [{ type: "literal", value: root(value) }] };
  }
  function NumberFormat(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
    if (!isKazakh(locales)) return new ORIGINAL.NumberFormat(locales, options);
    kazakhRequests.push(String(locales));
    // Символы корневой локали совпадают с en: «1,234,567.5».
    return new ORIGINAL.NumberFormat("en-US", options);
  }
  Object.assign(DateTimeFormat, { supportedLocalesOf: ORIGINAL.DateTimeFormat.supportedLocalesOf });
  Object.assign(NumberFormat, { supportedLocalesOf: ORIGINAL.NumberFormat.supportedLocalesOf });
  Object.defineProperty(Intl, "DateTimeFormat", { value: DateTimeFormat, configurable: true, writable: true });
  Object.defineProperty(Intl, "NumberFormat", { value: NumberFormat, configurable: true, writable: true });
}

beforeEach(() => {
  kazakhRequests = [];
  emulateChromeWithoutKazakhData();
});

afterEach(() => {
  Object.defineProperty(Intl, "DateTimeFormat", { value: ORIGINAL.DateTimeFormat, configurable: true, writable: true });
  Object.defineProperty(Intl, "NumberFormat", { value: ORIGINAL.NumberFormat, configurable: true, writable: true });
  vi.clearAllMocks();
});

/** Пробелы любого вида (U+0020, U+00A0, U+202F) — одним обычным, чтобы сверять цифры и разделители. */
const spaces = (text: string | null | undefined) => (text ?? "").replace(/\s/g, " ");

const OPERATOR: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "operator@operator.local",
    fullName: null,
    role: "operator",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "operator",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/catalog",
  otpDelivery: "email",
};

// 19:30 UTC 14 октября — уже 15 октября в Алматы (UTC+5, DATA-08).
const ITEM: CatalogItem = {
  profileId: "00000000-0000-4000-8000-000000000010",
  bin: "980540000384",
  nameEn: "Steel LLP",
  nameRu: "ТОО Сталь",
  region: "KZ-ATY",
  commodityGroups: ["A"],
  mainTnved: "7208",
  certificateTypes: [],
  siteSurveyed: true,
  tier: "tier_1",
  verifiedAt: "2026-10-14T19:30:00Z",
  updateStatus: "active",
  pendingChanges: false,
  worksWithCount: 0,
};

const DASHBOARD = {
  total: 1234567,
  byRegion: [{ region: "KZ-ATY", count: 2500 }],
  byCommodityGroup: [],
  siteSurveyed: 0,
  unifiedRegister: 0,
  updateStatus: { active: 0, outdated: 0, unresponsive: 0 },
  generatedAt: "2026-11-11T10:00:00Z",
};

function stubWorkspace() {
  return stubApi({
    "GET /api/auth/me": { body: OPERATOR },
    "GET /api/v1/catalog/search": { body: { items: [ITEM], total: 1234, page: 1, pageSize: 25 } },
    "GET /api/v1/dashboard": { body: DASHBOARD },
  });
}

describe("казахский интерфейс без данных kk в ICU браузера (LANG-01, LANG-04)", () => {
  it("каталог: дата верификации dd.MM.yyyy по Алматы, число найденных с пробелом между разрядами", async () => {
    stubWorkspace();
    renderRoute("/catalog");

    expect(await screen.findByText("15.10.2026")).toBeTruthy();
    expect(spaces(screen.getByText(/компания табылды/).textContent)).toBe("1 234 компания табылды");
    expect(kazakhRequests).toEqual([]);
  });

  it("дашборд: счётчики с пробелом между разрядами, время обновления dd.MM.yyyy, HH:mm", async () => {
    stubWorkspace();
    renderRoute("/dashboard");

    const total = (await screen.findByText(kk.dashboard.total)).closest("a")!;
    expect(spaces(total.textContent)).toContain("1 234 567");
    expect(spaces(screen.getByText("KZ-ATY").closest("a")!.textContent)).toContain("2 500");
    // 10:00 UTC — 15:00 в Алматы.
    expect(screen.getByText(`${kk.dashboard.generatedAt.replace("{time}", "11.11.2026, 15:00")}`)).toBeTruthy();
    expect(kazakhRequests).toEqual([]);
  });
});

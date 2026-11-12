// Страница компании из каталога, только для чтения (OPR-09, OPR-10, OPR-11, GEN-13).
import type { CompanyPage } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { problem, stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const ID = "00000000-0000-4000-8000-000000000010";
const URL_PATH = `/api/v1/catalog/companies/${ID}`;

function me(role: "operator" | "observer"): Me {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: `${role}@${role}.local`,
      fullName: null,
      role,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationType: role,
      locale: "kk",
    },
    gates: { mfa: true, responsibility: true },
    homePath: "/dashboard",
    otpDelivery: "email",
  };
}

const FOCAL_POINT = {
  fullName: "Айгерим Сапарова",
  position: "Коммерческий директор",
  email: "focal@company1.demo.local",
  phone: "+7 701 000 00 01",
};

/** Ответ наблюдателю: ключа focalPoint нет (GEN-13). */
const OBSERVER_PAGE: CompanyPage = {
  profileId: ID,
  bin: "240100000001",
  nameEn: "Demo Metal Structures LLP",
  nameRu: "ТОО «Демо Металл Конструкция»",
  region: "KZ-ATY",
  commodityGroups: ["A", "C"],
  tnvedCodes: ["7308100000", "7308909809"],
  mainTnved: "7308909809",
  headcountTotal: 1240,
  certificates: [
    { type: "ISO 9001", validUntil: "2027-11-12" },
    { type: "API 6D", validUntil: null },
  ],
  siteSurveyed: true,
  tier: "tier_2",
  unifiedRegister: true,
  worksWithCount: 2,
  updateStatus: "active",
  pendingChanges: false,
  verifiedAt: "2026-11-11T20:00:00Z",
  companyPhone: "+7 700 000 00 01",
  companyEmail: "info@company1.demo.local",
};
const OPERATOR_PAGE: CompanyPage = { ...OBSERVER_PAGE, focalPoint: FOCAL_POINT };

function stubCompany(role: "operator" | "observer", body: CompanyPage | ReturnType<typeof problem>) {
  return stubApi({
    "GET /api/auth/me": { body: me(role) },
    [`GET ${URL_PATH}`]: typeof body === "function" ? body : { body },
  });
}

/** Значение строки «подпись — значение» в карточке. */
const field = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("страница компании (OPR-09, OPR-10)", () => {
  it("оператор видит реквизиты, сертификаты, тир, статус и focal point", async () => {
    stubCompany("operator", OPERATOR_PAGE);
    renderRoute(`/companies/${ID}`, { locale: "ru" });

    expect(await screen.findByRole("heading", { level: 1, name: OPERATOR_PAGE.nameRu })).toBeTruthy();
    expect(screen.getByText(OPERATOR_PAGE.nameEn)).toBeTruthy();
    expect(screen.getByText(ru.catalog.tierValue.tier_2)).toBeTruthy();
    expect(screen.getByText(ru.catalog.status.active)).toBeTruthy();
    expect(screen.queryByText(ru.company.pending)).toBeNull();

    expect(field(ru.company.bin)).toBe("240100000001");
    expect(field(ru.company.region)).toBe("KZ-ATY");
    expect(field(ru.company.headcount)).toMatch(/^1\s240$/);
    // Основной код ТН ВЭД — первым.
    expect(field(ru.company.tnved)).toBe("7308909809, 7308100000");
    expect(field(ru.company.unifiedRegister)).toBe(ru.common.yes);
    expect(field(ru.company.siteSurveyed)).toBe(ru.common.yes);
    expect(field(ru.company.worksWith)).toBe("2 из 3");

    const certificates = screen.getByRole("table");
    expect(within(certificates).getByText("ISO 9001")).toBeTruthy();
    expect(within(certificates).getByText("API 6D").closest("tr")?.textContent).toContain("—");

    expect(field(ru.company.companyPhone)).toBe(OPERATOR_PAGE.companyPhone);
    expect(field(ru.company.companyEmail)).toBe(OPERATOR_PAGE.companyEmail);
    const focal = field(ru.company.focalPoint);
    for (const value of Object.values(FOCAL_POINT)) expect(focal).toContain(value);

    // Меню: на странице компании активен пункт «Каталог».
    expect(screen.getByRole("link", { name: ru.nav.catalog }).hasAttribute("data-active")).toBe(true);
  });

  it("наблюдатель: телефон и email компании есть, focal point нет (GEN-13)", async () => {
    for (const body of [OBSERVER_PAGE, OPERATOR_PAGE]) {
      // Второй ответ — с focal point: интерфейс всё равно прячет его по матрице прав.
      stubCompany("observer", body);
      renderRoute(`/companies/${ID}`, { locale: "en" });

      expect(await screen.findByRole("heading", { level: 1, name: OBSERVER_PAGE.nameEn })).toBeTruthy();
      expect(screen.getByText(OBSERVER_PAGE.nameRu)).toBeTruthy();
      expect(field(en.company.companyPhone)).toBe(OBSERVER_PAGE.companyPhone);
      expect(field(en.company.companyEmail)).toBe(OBSERVER_PAGE.companyEmail);
      expect(screen.getByText(en.catalog.tierValue.tier_2)).toBeTruthy();
      expect(screen.queryByText(en.company.focalPoint)).toBeNull();
      expect(screen.queryByText(FOCAL_POINT.fullName)).toBeNull();
      cleanup();
    }
  });

  it("pending changes — отметка (OPR-11)", async () => {
    stubCompany("operator", { ...OPERATOR_PAGE, pendingChanges: true, focalPoint: null, companyEmail: null });
    renderRoute(`/companies/${ID}`, { locale: "en" });

    expect(await screen.findByText(en.company.pending)).toBeTruthy();
    // Нет контактного лица и email — «не указано».
    expect(field(en.company.focalPoint)).toBe(en.company.notProvided);
    expect(field(en.company.companyEmail)).toBe(en.company.notProvided);
  });

  it("дата верификации через useFormat на kk", async () => {
    stubCompany("operator", { ...OPERATOR_PAGE, certificates: [] });
    renderRoute(`/companies/${ID}`);

    expect(await screen.findByRole("heading", { level: 1, name: OPERATOR_PAGE.nameRu })).toBeTruthy();
    // 20:00 UTC 11.11 — уже 12.11 в Алматы.
    expect(field(kk.company.verifiedAt)).toBe("12.11.2026");
    expect(field(kk.company.headcount)).toMatch(/^1\s240$/);
    expect(screen.getByText(kk.company.noCertificates)).toBeTruthy();
  });

  it("404 — пусто со ссылкой в каталог, сбой — сообщение и повтор (OPR-08)", async () => {
    stubCompany("operator", problem(404, "not_found"));
    let { user } = renderRoute(`/companies/${ID}`, { locale: "en" });

    expect(await screen.findByText(en.company.notFound)).toBeTruthy();
    const page = within(screen.getByRole("main"));
    expect(page.getByRole("link", { name: en.company.back }).getAttribute("href")).toBe("/catalog");
    expect(page.getByRole("link", { name: en.nav.catalog }).getAttribute("href")).toBe("/catalog");
    expect(screen.queryByRole("button", { name: en.common.retry })).toBeNull();
    cleanup();

    let fail = true;
    const api = stubApi({
      "GET /api/auth/me": { body: me("operator") },
      [`GET ${URL_PATH}`]: () =>
        fail
          ? Response.json({ status: 503, code: "unavailable", title: "unavailable" }, { status: 503 })
          : Response.json(OPERATOR_PAGE),
    });
    ({ user } = renderRoute(`/companies/${ID}`, { locale: "en" }));

    expect(await screen.findByText(en.company.loadError)).toBeTruthy();
    expect(screen.queryByText(en.company.notFound)).toBeNull();
    fail = false;
    await user.click(screen.getByRole("button", { name: en.common.retry }));
    expect(await screen.findByRole("heading", { level: 1, name: OPERATOR_PAGE.nameEn })).toBeTruthy();
    expect(api.mock.calls.filter(([url]) => String(url) === URL_PATH)).toHaveLength(2);
  });

  it("адрес с неверным id: API отвечает 400 — «не найдено», без повтора", async () => {
    stubApi({
      "GET /api/auth/me": { body: me("operator") },
      "GET /api/v1/catalog/companies/123": problem(400, "validation"),
    });
    renderRoute("/companies/123", { locale: "en" });

    expect(await screen.findByText(en.company.notFound)).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: en.nav.catalog }).getAttribute("href")).toBe(
      "/catalog",
    );
    expect(screen.queryByText(en.company.loadError)).toBeNull();
    expect(screen.queryByRole("button", { name: en.common.retry })).toBeNull();
  });

  it("ровно один заголовок вкладки — название компании", async () => {
    stubCompany("operator", OPERATOR_PAGE);
    renderRoute(`/companies/${ID}`, { locale: "ru" });

    expect(await screen.findByRole("heading", { level: 1, name: OPERATOR_PAGE.nameRu })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe(`${OPERATOR_PAGE.nameRu} · ${ru.common.appName}`));
    expect(document.querySelectorAll("title")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});

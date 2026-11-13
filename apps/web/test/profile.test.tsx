// Свой профиль производителя, только для чтения (MAN-41, MAN-46, IMBC-22, GEN-11).
import { type OwnAdataRead, type OwnProfile, PREFILL_FIELDS } from "@imbc/contracts";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const URL_PATH = "/api/v1/profiles/own";
const ADATA_PATH = "/api/v1/profiles/own/adata";

const ME: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "manufacturer@demo.local",
    fullName: null,
    role: "manufacturer",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "manufacturer",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/profile",
  otpDelivery: "email",
};

/** Демо-производитель: Verified, site surveyed — тир 2. */
const DEMO: OwnProfile = {
  profileId: "00000000-0000-4000-8000-000000000010",
  organizationName: "ТОО «Демо Металл Конструкция»",
  bin: "240100000001",
  status: "verified",
  hasPendingChanges: false,
  updateStatus: "active",
  tier: "tier_2",
  completenessPct: 100,
  registeredAt: "2026-10-01T10:00:00Z",
  verifiedAt: "2026-11-11T20:00:00Z",
};

/** Adata не запрашивался: ответ по умолчанию, прежние тесты страницы его не замечают. */
const NOT_REQUESTED: OwnAdataRead = { state: "not_requested", requestedAt: null, readAt: null, fields: [] };

/** 09:01 UTC — 14:01 в Алматы. */
const READ_AT = "2026-11-12T09:01:30Z";
const item = (value: string, label: string | null = null) => ({ value, label });
const prefilled = (field: (typeof PREFILL_FIELDS)[number], ...items: ReturnType<typeof item>[]) => ({
  field,
  source: "adata" as const,
  readAt: READ_AT,
  items,
});

/** Полученное чтение: девять полей фикстуры коннектора (MAN-06, MAN-07). */
const RECEIVED: OwnAdataRead = {
  state: "received",
  requestedAt: "2026-11-12T09:00:00Z",
  readAt: READ_AT,
  fields: [
    prefilled("legal_name", item("ТОО «Тест Adata»")),
    prefilled("activity", item("25110", "Производство строительных металлических конструкций"), item("28220")),
    prefilled("company_phone", item("+7 727 000 00 01")),
    prefilled("company_email", item("info@adata-test.local")),
    prefilled("legal_address", item("Казахстан, г. Алматы, ул. Тестовая, д. 1")),
    prefilled("director_full_name", item("Тестов Тест Тестович")),
    prefilled("state_registered_on", item("2016-09-29")),
    prefilled("legal_form", item("Товарищество с ограниченной ответственностью")),
    prefilled("shareholders", item("Тестова Айгуль"), item("ТОО «Тест Холдинг»")),
  ],
};

function stubProfile(body: OwnProfile, adata: OwnAdataRead = NOT_REQUESTED) {
  return stubApi({
    "GET /api/auth/me": { body: ME },
    [`GET ${URL_PATH}`]: { body },
    [`GET ${ADATA_PATH}`]: { body: adata },
  });
}

/** Блок «Данные из Adata». */
const adataCard = (title: string) => screen.findByRole("region", { name: title });

/** Строки «подпись — значение» блока Adata: подпись, текст значения и отметка источника. */
function adataRows(card: HTMLElement) {
  return [...card.querySelectorAll("dt")].map((dt) => {
    const dd = dt.nextElementSibling as HTMLElement;
    const badge = dd.querySelector('[data-slot="badge"]');
    return { label: dt.textContent, dd, badge: badge?.textContent ?? null };
  });
}

const callsTo = (api: ReturnType<typeof stubApi>, path: string) =>
  api.mock.calls.filter(([url]) => String(url) === path).length;

/** Значение строки «подпись — значение» в карточке. */
const field = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("свой профиль производителя (MAN-46, IMBC-22)", () => {
  it("демо-производитель видит компанию, БИН, Verified, актуальность и тир 2", async () => {
    stubProfile(DEMO);
    renderRoute("/profile", { locale: "ru" });

    expect(await screen.findByText(DEMO.organizationName)).toBeTruthy();
    expect(field(ru.profile.company)).toBe(DEMO.organizationName);
    expect(field(ru.profile.bin)).toBe(DEMO.bin);
    expect(field(ru.profile.status)).toBe(ru.profile.statusValue.verified);
    expect(field(ru.profile.updateStatus)).toBe(ru.catalog.status.active);
    expect(field(ru.profile.tier)).toBe(ru.catalog.tierValue.tier_2);
    expect(screen.queryByText(ru.profile.pendingChanges)).toBeNull();
    expect(screen.getByText(ru.profile.readOnlyHint)).toBeTruthy();

    // Один заголовок страницы и вкладки — «Профиль компании».
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([ru.nav.profile]);
    await waitFor(() => expect(document.title).toBe(`${ru.nav.profile} · ${ru.common.appName}`));
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("draft — «Появится после верификации» вместо тира и статуса актуальности", async () => {
    stubProfile({ ...DEMO, status: "draft", updateStatus: null, tier: null, completenessPct: 40, verifiedAt: null });
    renderRoute("/profile", { locale: "ru" });

    expect(await screen.findByText(DEMO.organizationName)).toBeTruthy();
    expect(field(ru.profile.status)).toBe(ru.profile.statusValue.draft);
    expect(field(ru.profile.updateStatus)).toBe(ru.profile.notVerifiedYet);
    expect(field(ru.profile.tier)).toBe(ru.profile.notVerifiedYet);
    expect(field(ru.profile.verifiedAt)).toBe("—");
  });

  it("pending changes — отметка", async () => {
    stubProfile({ ...DEMO, hasPendingChanges: true });
    renderRoute("/profile", { locale: "en" });

    expect(await screen.findByText(en.profile.pendingChanges)).toBeTruthy();
    expect(field(en.profile.status)).toContain(en.profile.statusValue.verified);
  });

  it("процент через useFormat", async () => {
    stubProfile({ ...DEMO, completenessPct: 85 });
    renderRoute("/profile");

    expect(await screen.findByText(DEMO.organizationName)).toBeTruthy();
    expect(field(kk.profile.completeness)).toMatch(/^85\s%$/);
    // 20:00 UTC 11.11 — уже 12.11 в Алматы.
    expect(field(kk.profile.registeredAt)).toBe("01.10.2026");
    expect(field(kk.profile.verifiedAt)).toBe("12.11.2026");
    cleanup();

    stubProfile({ ...DEMO, completenessPct: 85 });
    renderRoute("/profile", { locale: "en" });
    expect(await screen.findByText(DEMO.organizationName)).toBeTruthy();
    expect(field(en.profile.completeness)).toMatch(/^85\s%$/);
    expect(field(en.profile.verifiedAt)).toBe("Nov 12, 2026");
  });

  it("сбой — сообщение и повтор", async () => {
    let fail = true;
    const api = stubApi({
      "GET /api/auth/me": { body: ME },
      [`GET ${URL_PATH}`]: () =>
        fail
          ? Response.json({ status: 503, code: "unavailable", title: "unavailable" }, { status: 503 })
          : Response.json(DEMO),
    });
    const { user } = renderRoute("/profile", { locale: "en" });

    expect(await screen.findByText(en.profile.loadError)).toBeTruthy();
    // Кнопка «Повторить» — под текстом, а не в AlertAction: у того справа 4,5rem, на 390 px кнопка легла бы на текст.
    expect(document.querySelector('[data-slot="alert-action"]')).toBeNull();
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([en.nav.profile]);
    fail = false;
    await user.click(screen.getByRole("button", { name: en.common.retry }));
    expect(await screen.findByText(DEMO.organizationName)).toBeTruthy();
    expect(screen.queryByText(en.profile.loadError)).toBeNull();
    expect(api.mock.calls.filter(([url]) => String(url) === URL_PATH)).toHaveLength(2);
  });

  it("ссылка на аккаунт — ссылка, не кнопка", async () => {
    stubProfile(DEMO);
    renderRoute("/profile", { locale: "kk" });

    expect(await screen.findByText(DEMO.organizationName)).toBeTruthy();
    const page = within(screen.getByRole("main"));
    expect(page.getByRole("link", { name: kk.nav.account }).getAttribute("href")).toBe("/account");
    expect(page.queryByRole("button", { name: kk.nav.account })).toBeNull();
    expect(screen.getByText(kk.profile.accountHint)).toBeTruthy();
  });
});

describe("данные Adata своего профиля (MAN-06, MAN-07, GEN-11)", () => {
  it("received: девять подписей, значения, отметка Adata у каждого, ОКЭД «код — название», учредители и пояснение про доли", async () => {
    stubProfile(DEMO, RECEIVED);
    renderRoute("/profile", { locale: "ru" });

    const card = await adataCard(ru.profile.adata.title);
    await within(card).findByText(/Тестов Тест Тестович/);
    const rows = adataRows(card);
    expect(rows.map((r) => r.label)).toEqual(PREFILL_FIELDS.map((field) => ru.profile.adata.field[field]));
    for (const row of rows) expect(row.badge, row.label!).toBe(ru.profile.adata.sourceAdata);

    const text = (field: (typeof PREFILL_FIELDS)[number]) =>
      rows.find((r) => r.label === ru.profile.adata.field[field])!.dd.textContent;
    expect(text("legal_name")).toContain("ТОО «Тест Adata»");
    expect(text("activity")).toContain("25110 — Производство строительных металлических конструкций");
    expect(text("activity")).toContain("28220");
    expect(text("company_phone")).toContain("+7 727 000 00 01");
    expect(text("company_email")).toContain("info@adata-test.local");
    expect(text("legal_address")).toContain("Казахстан, г. Алматы, ул. Тестовая, д. 1");
    expect(text("legal_form")).toContain("Товарищество с ограниченной ответственностью");
    // Учредители — списком, долей и гражданства Adata не даёт (MAN-21).
    const shareholders = rows.find((r) => r.label === ru.profile.adata.field.shareholders)!.dd;
    expect(within(shareholders).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Тестова Айгуль",
      "ТОО «Тест Холдинг»",
    ]);
    expect(within(shareholders).getByText(ru.profile.adata.shareholdersNamesOnly)).toBeTruthy();
    expect(within(card).getByText(ru.profile.adata.confirmLater)).toBeTruthy();

    // Карточка профиля и один заголовок страницы на месте.
    expect(field(ru.profile.company)).toBe(DEMO.organizationName);
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([ru.nav.profile]);
  });

  it("дата получения и дата регистрации через useFormat на kk (dd.MM.yyyy, HH:mm и dd.MM.yyyy)", async () => {
    stubProfile(DEMO, RECEIVED);
    renderRoute("/profile");

    const card = await adataCard(kk.profile.adata.title);
    expect(await within(card).findByText(kk.profile.adata.received.replace("{date}", "12.11.2026, 14:01"))).toBeTruthy();
    const registered = adataRows(card).find((r) => r.label === kk.profile.adata.field.state_registered_on)!;
    expect(registered.dd.textContent).toContain("29.09.2016");
    expect(registered.dd.textContent).not.toContain("2016-09-29");
  });

  it("поле без значения — «Adata не вернул значение»", async () => {
    stubProfile(DEMO, { ...RECEIVED, fields: RECEIVED.fields.filter((f) => f.field !== "legal_form") });
    renderRoute("/profile", { locale: "ru" });

    const card = await adataCard(ru.profile.adata.title);
    await within(card).findByText(/Тестов Тест Тестович/);
    const rows = adataRows(card);
    expect(rows).toHaveLength(PREFILL_FIELDS.length);
    const legalForm = rows.find((r) => r.label === ru.profile.adata.field.legal_form)!;
    expect(legalForm.dd.textContent).toBe(ru.profile.adata.notReturned);
    expect(legalForm.badge).toBeNull();
  });

  it("длинное значение без пробелов показано целиком и переносится", async () => {
    const email = `${"x".repeat(280)}@adata-test.local`;
    const okedLabel = "Производство".repeat(25);
    stubProfile(DEMO, {
      ...RECEIVED,
      fields: RECEIVED.fields.map((f) =>
        f.field === "company_email"
          ? { ...f, items: [item(email)] }
          : f.field === "activity"
            ? { ...f, items: [item("25110", okedLabel), item("28220")] }
            : f,
      ),
    });
    renderRoute("/profile", { locale: "ru" });

    const card = await adataCard(ru.profile.adata.title);
    // jsdom не раскладывает страницу: проверяются полный текст и классы переноса у значения и его dd.
    const wraps = (element: Element) =>
      ["min-w-0", "max-w-full", "[overflow-wrap:anywhere]"].every((c) => element.classList.contains(c));
    const value = await within(card).findByText(email);
    expect(value.textContent).toHaveLength(297);
    expect(wraps(value)).toBe(true);
    expect(wraps(value.closest("dd")!)).toBe(true);
    const oked = within(card).getByText(`25110 — ${okedLabel}`);
    expect(oked.tagName).toBe("LI");
    expect(wraps(oked)).toBe(true);
  });

  it("waiting — текст и повторный запрос через 5 секунд, затем значения", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const api = stubApi({
      "GET /api/auth/me": { body: ME },
      [`GET ${URL_PATH}`]: { body: DEMO },
      [`GET ${ADATA_PATH}`]: () =>
        Response.json(
          ++reads === 1
            ? { state: "waiting", requestedAt: "2026-11-12T09:00:00Z", readAt: null, fields: [] }
            : RECEIVED,
        ),
    });
    renderRoute("/profile", { locale: "ru" });

    const card = await adataCard(ru.profile.adata.title);
    // Строка состояния — живая область: смена waiting → received объявляется (тот же элемент).
    const status = await within(card).findByText(ru.profile.adata.waiting);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(card.querySelector("dl")).toBeNull();
    expect(callsTo(api, ADATA_PATH)).toBe(1);

    act(() => vi.advanceTimersByTime(5000));
    expect(await within(card).findByText(/Тестов Тест Тестович/)).toBeTruthy();
    expect(within(card).queryByText(ru.profile.adata.waiting)).toBeNull();
    expect(within(card).getByText(/^Получено из Adata /)).toBe(status);
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(callsTo(api, ADATA_PATH)).toBe(2);

    // Получено — опрос остановлен; профиль не перезапрашивается.
    act(() => vi.advanceTimersByTime(15000));
    expect(callsTo(api, ADATA_PATH)).toBe(2);
    expect(callsTo(api, URL_PATH)).toBe(1);
  });

  it("unavailable, not_configured, quota_exhausted, not_requested — свой текст, без списка", async () => {
    const texts = {
      unavailable: ru.profile.adata.unavailable,
      not_configured: ru.profile.adata.notConfigured,
      quota_exhausted: ru.profile.adata.quotaExhausted,
      not_requested: ru.profile.adata.notRequested,
    } as const;
    for (const [state, text] of Object.entries(texts) as [keyof typeof texts, string][]) {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const api = stubProfile(DEMO, {
        state,
        requestedAt: state === "not_requested" ? null : "2026-11-12T09:00:00Z",
        readAt: null,
        fields: [],
      });
      renderRoute("/profile", { locale: "ru" });

      const card = await adataCard(ru.profile.adata.title);
      expect(await within(card).findByText(text), state).toBeTruthy();
      expect(card.querySelector("dl"), state).toBeNull();
      expect(within(card).queryByText(ru.profile.adata.confirmLater), state).toBeNull();
      // Конечное состояние — без опроса.
      act(() => vi.advanceTimersByTime(15000));
      expect(callsTo(api, ADATA_PATH), state).toBe(1);
      cleanup();
      vi.useRealTimers();
    }
  });

  it("сбой чтения — сообщение и повтор, карточка профиля на месте", async () => {
    let fail = true;
    const api = stubApi({
      "GET /api/auth/me": { body: ME },
      [`GET ${URL_PATH}`]: { body: DEMO },
      [`GET ${ADATA_PATH}`]: () =>
        fail
          ? Response.json({ status: 503, code: "unavailable", title: "unavailable" }, { status: 503 })
          : Response.json(RECEIVED),
    });
    const { user } = renderRoute("/profile", { locale: "en" });

    const card = await adataCard(en.profile.adata.title);
    expect(await within(card).findByText(en.profile.adata.loadError)).toBeTruthy();
    // Кнопка «Повторить» — под текстом, а не в AlertAction: у того справа 4,5rem, на 390 px кнопка легла бы на текст.
    expect(card.querySelector('[data-slot="alert-action"]')).toBeNull();
    expect(field(en.profile.company)).toBe(DEMO.organizationName);
    expect(screen.queryByText(en.profile.loadError)).toBeNull();

    fail = false;
    await user.click(within(card).getByRole("button", { name: en.common.retry }));
    expect(await within(card).findByText(/Тестов Тест Тестович/)).toBeTruthy();
    expect(within(card).queryByText(en.profile.adata.loadError)).toBeNull();
    expect(callsTo(api, ADATA_PATH)).toBe(2);
    expect(callsTo(api, URL_PATH)).toBe(1);
  });

  it("тексты на en и kk (заголовок и received)", async () => {
    stubProfile(DEMO, RECEIVED);
    renderRoute("/profile", { locale: "en" });
    let card = await adataCard(en.profile.adata.title);
    const status = await within(card).findByText(/^Received from Adata on /);
    expect(status.textContent).toMatch(/11\/12\/26/);
    expect(adataRows(card).map((r) => r.label)).toEqual(PREFILL_FIELDS.map((f) => en.profile.adata.field[f]));
    cleanup();

    stubProfile(DEMO, RECEIVED);
    renderRoute("/profile", { locale: "kk" });
    card = await adataCard(kk.profile.adata.title);
    expect(await within(card).findByText(kk.profile.adata.received.replace("{date}", "12.11.2026, 14:01"))).toBeTruthy();
    expect(adataRows(card).map((r) => r.label)).toEqual(PREFILL_FIELDS.map((f) => kk.profile.adata.field[f]));
  });
});

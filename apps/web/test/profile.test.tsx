// Свой профиль производителя, только для чтения (MAN-41, MAN-46, IMBC-22, GEN-11).
import type { OwnProfile } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const URL_PATH = "/api/v1/profiles/own";

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

function stubProfile(body: OwnProfile) {
  return stubApi({ "GET /api/auth/me": { body: ME }, [`GET ${URL_PATH}`]: { body } });
}

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

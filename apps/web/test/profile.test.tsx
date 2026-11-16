// Seven-section overview, verified metadata and source ownership (GEN-11, MAN-21, MAN-41, MAN-46).
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { MANUFACTURER, overview, ownProfile } from "./support/profile-fixtures";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const OWN = "/api/v1/profiles/own";
const SECTIONS = `${OWN}/sections`;
const field = (label: string) => screen.getByText(label).nextElementSibling?.textContent;
const stubOverview = (body = ownProfile(), sections = overview()) => stubApi({
  "GET /api/auth/me": { body: MANUFACTURER },
  [`GET ${OWN}`]: { body },
  [`GET ${SECTIONS}`]: { body: sections },
});

describe("seven-section manufacturer overview", () => {
  it("has seven sections, two editable entry links, five coming-soon sections and the six-section denominator", async () => {
    const mock = stubOverview();
    renderRoute("/profile", { locale: "en" });
    await screen.findByText(ownProfile().organizationName);
    const page = within(screen.getByRole("main"));
    expect(page.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(Object.values(en.profileEditor.sections));
    const links = page.getAllByRole("link", { name: en.profileEditor.openSection });
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/profile/main-information", "/profile/contacts"]);
    expect(page.getAllByText(en.profileEditor.soon)).toHaveLength(5);
    expect(page.getAllByText(en.profileEditor.requiredSoon)).toHaveLength(4);
    expect(page.getByText(en.profileEditor.optionalSoon)).toBeTruthy();
    expect(field(en.profile.completeness)).toMatch(/^33\s%$/);
    expect(page.queryByText(/Shareholders|Акционеры/i)).toBeNull();
    expect(page.queryByRole("region", { name: en.profile.adata.title })).toBeNull();
    expect(mock.mock.calls.some(([url]) => String(url).includes("/adata"))).toBe(false);
  });

  it("keeps company, BIN, status, tier and account link while rounding the overview value rather than stale profile metadata", async () => {
    const profile = ownProfile({ completenessPct: 100 });
    stubOverview(profile);
    renderRoute("/profile", { locale: "ru" });
    await screen.findByText(profile.organizationName);
    expect(field(ru.profile.company)).toBe(profile.organizationName);
    expect(field(ru.profile.bin)).toBe(profile.bin);
    expect(field(ru.profile.status)).toBe(ru.profile.statusValue.verified);
    expect(field(ru.profile.updateStatus)).toBe(ru.catalog.status.active);
    expect(field(ru.profile.tier)).toBe(ru.catalog.tierValue.tier_2);
    expect(field(ru.profile.completeness)).toMatch(/^33\s%$/);
    const page = within(screen.getByRole("main"));
    const account = page.getByRole("link", { name: ru.nav.account });
    expect(account.getAttribute("href")).toBe("/account");
    expect(account.classList.contains("border-border")).toBe(true);
    expect(account.classList.contains("border-transparent")).toBe(false);
    expect(page.queryByRole("button", { name: ru.nav.account })).toBeNull();
    expect(page.getByText(ru.profile.accountHint)).toBeTruthy();
  });

  it("Draft has no invented tier, update status or verification date", async () => {
    stubOverview(ownProfile({ status: "draft", tier: null, updateStatus: null, verifiedAt: null }), overview({ profileStatus: "draft" }));
    renderRoute("/profile", { locale: "en" });
    await screen.findByText(ownProfile().organizationName);
    expect(field(en.profile.status)).toBe(en.profile.statusValue.draft);
    expect(field(en.profile.tier)).toBe(en.profile.notVerifiedYet);
    expect(field(en.profile.updateStatus)).toBe(en.profile.notVerifiedYet);
    expect(field(en.profile.verifiedAt)).toBe("—");
  });

  it("distinguishes unsubmitted working changes from changes actually sent for review", async () => {
    const sections = overview();
    sections.sections[0].hasWorkingChanges = true;
    stubOverview(ownProfile(), sections);
    renderRoute("/profile", { locale: "en" });
    expect(await screen.findByText(en.profileEditor.unsubmitted)).toBeTruthy();
    expect(screen.queryByText(en.profile.pendingChanges)).toBeNull();
  });

  it("sent pending changes stay Verified", async () => {
    stubOverview(ownProfile({ hasPendingChanges: true }), overview({ hasPendingChanges: true }));
    renderRoute("/profile", { locale: "en" });
    expect(await screen.findByText(en.profile.pendingChanges)).toBeTruthy();
    expect(field(en.profile.status)).toContain(en.profile.statusValue.verified);
  });

  it.each([
    ["kk", kk, "01.10.2026", "12.11.2026"],
    ["ru", ru, "1 окт. 2026 г.", "12 нояб. 2026 г."],
    ["en", en, "Oct 1, 2026", "Nov 12, 2026"],
  ] as const)("uses %s date formatting and one page title", async (locale, messages, registered, verified) => {
    stubOverview();
    renderRoute("/profile", { locale });
    await screen.findByText(ownProfile().organizationName);
    expect(field(messages.profile.registeredAt)).toBe(registered);
    expect(field(messages.profile.verifiedAt)).toBe(verified);
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual([messages.nav.profile]);
    await waitFor(() => expect(document.title).toBe(`${messages.nav.profile} · ${messages.common.appName}`));
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it.each([OWN, SECTIONS])("shows a failed %s request honestly and retries both profile scopes", async (failedPath) => {
    let fail = true;
    const reply = (path: string, body: unknown) => () => fail && path === failedPath
      ? Response.json({ status: 503, code: "unavailable", title: "unavailable" }, { status: 503 })
      : Response.json(body);
    const mock = stubApi({
      "GET /api/auth/me": { body: MANUFACTURER },
      [`GET ${OWN}`]: reply(OWN, ownProfile()),
      [`GET ${SECTIONS}`]: reply(SECTIONS, overview()),
    });
    const { user } = renderRoute("/profile", { locale: "en" });
    expect(await screen.findByText(en.profile.loadError)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    fail = false;
    await user.click(screen.getByRole("button", { name: en.common.retry }));
    await screen.findByText(ownProfile().organizationName);
    expect(screen.queryByText(en.profile.loadError)).toBeNull();
    for (const path of [OWN, SECTIONS]) expect(mock.mock.calls.filter(([url]) => String(url) === path)).toHaveLength(2);
  });
});

import { LPS_SORT_COLUMNS, ROLES } from "@imbc/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LpsCompaniesPage } from "@/routes/app/lps-companies";
import { LpsPage } from "@/routes/app/lps";
import en from "../messages/en.json";
import ru from "../messages/ru.json";
import kk from "../messages/kk.json";
import { problem } from "./support/api";
import { LPS_COMPANY, LPS_ENTRY, lpsId, lpsList, stubLps } from "./support/lps";
import { renderRoute } from "./support/render";

const routes = [{ path: "/lps", Component: LpsPage }, { path: "/lps/companies", Component: LpsCompaniesPage }, { path: "/away", element: <p>Away</p> }];
const responses = (calls: ReturnType<typeof stubLps>, method: string, path: string) => calls.mock.calls.filter(([url, init]) => String(url).startsWith(`/api/v1/lps/${path}`) && (init?.method ?? "GET") === method);

describe("LPS producer-independent register", () => {
  it.each(ROLES)("%s receives only its permitted controls and denied roles issue no G request", async (role) => {
    const calls = stubLps(role);
    renderRoute("/lps", { routes, locale: "en" });
    if (["expert", "operator", "director"].includes(role)) {
      expect(await screen.findByText(LPS_COMPANY.name)).toBeTruthy();
      expect(Boolean(screen.queryByRole("button", { name: en.lps.newEntry }))).toBe(role === "expert");
      expect(Boolean(screen.queryByRole("button", { name: en.lps.edit }))).toBe(role === "expert");
      expect(screen.queryByText(/NDA/)).toBeNull();
    } else {
      expect(await screen.findByText(en.lps.errors.forbidden)).toBeTruthy();
      expect(calls.mock.calls.filter(([url]) => String(url).includes("/v1/lps/")).length).toBe(0);
    }
  });
  it.each(["en", "ru", "kk"] as const)("all nineteen columns, eighteen sorts and aligned unknown contacts render in %s", async (locale) => {
    stubLps("operator");
    renderRoute("/lps", { routes, locale });
    const t = { en, ru, kk }[locale].lps;
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(19);
    for (const key of LPS_SORT_COLUMNS) expect(within(table).getByRole("button", { name: t.columns[key] })).toBeTruthy();
    expect(within(table).getAllByText("Demo region")).toHaveLength(2);
    expect(within(table).getByText("general@lps.local")).toBeTruthy();
    expect(within(table).getByText("+70000000002 ext. 001")).toBeTruthy();
    expect(within(table).getByText(LPS_ENTRY.plannedLaunch!)).toBeTruthy();
    expect(within(table).getAllByRole("columnheader")[11].textContent).toBe(t.columns.newJobs);
    expect(document.body.textContent).not.toContain(lpsId(40));
    expect(document.body.textContent).not.toContain("MISSING_MESSAGE");
  });
  it("a dashboard Unknown drilldown retains repeated type/city filters and resets only paging", async () => {
    const calls = stubLps("director");
    const { user, router } = renderRoute(`/lps?view=dashboard&offset=100&commodityTypeIds=${lpsId(23)}&commodityTypeIds=${lpsId(28)}&cities=Demo+city&cities=Other+demo+city`, { routes, locale: "en" });
    const buttons = await screen.findAllByRole("button", { name: "Show entries: Unknown (1)" });
    await user.click(buttons[0]);
    await screen.findByRole("table");
    const url = new URLSearchParams(router.state.location.search);
    expect(url.get("view")).toBe("table");
    expect(url.getAll("regionIds")).toEqual(["unknown"]);
    expect(url.getAll("commodityTypeIds")).toEqual([lpsId(23), lpsId(28)]);
    expect(url.getAll("cities")).toEqual(["Demo city", "Other demo city"]);
    expect(url.has("offset")).toBe(false);
    const sent = new URL(String(responses(calls, "GET", "entries").at(-1)![0]), "http://localhost");
    expect(sent.searchParams.getAll("commodityTypeIds")).toEqual(url.getAll("commodityTypeIds"));
  });
  it("invalid copied ranges do not send a business request and can be cleared", async () => {
    const calls = stubLps("operator");
    const { user } = renderRoute("/lps?lastUpdatedFrom=2026-12-31&lastUpdatedTo=2026-01-01", { routes, locale: "en" });
    await screen.findByText(en.lps.invalidFilters);
    expect(responses(calls, "GET", "entries")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: en.lps.clearFilters }));
    await screen.findByRole("table");
  });
  it("failed entry save keeps exact draft and grouped methods, then retry publishes current saved values", async () => {
    let writes = 0, saved = { ...LPS_ENTRY };
    const calls = stubLps("expert", {
      "GET /api/v1/lps/entries": () => new Response(JSON.stringify(lpsList([saved])), { headers: { "content-type": "application/json" } }),
      [`PUT /api/v1/lps/entries/${LPS_ENTRY.id}`]: (_url, init) => {
        writes++;
        if (writes === 1) return new Response(JSON.stringify({ code: "lps_reference", title: "unsafe raw server message", status: 409 }), { status: 409 });
        const input = JSON.parse(String(init?.body)); saved = { ...saved, scopeDescription: input.scopeDescription, investmentUsd: input.investmentUsd, contacts: input.contacts };
        const entry = { ...saved }; delete (entry as Partial<typeof entry>).rowNumber;
        return new Response(JSON.stringify(entry), { headers: { "content-type": "application/json" } });
      },
    });
    const { user } = renderRoute("/lps", { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.lps.edit }));
    const dialog = screen.getByRole("dialog"), scope = within(dialog).getByRole("textbox", { name: en.lps.scopeRequired });
    await user.clear(scope); await user.type(scope, "Demo updated scope");
    expect(within(dialog).getByRole("textbox", { name: en.lps.columns.investmentUsd }).getAttribute("value")).toBe("9007199254740993.12500");
    await user.click(within(dialog).getByRole("button", { name: en.lps.save }));
    await screen.findByText(en.lps.errors.reference);
    expect(scope).toHaveProperty("value", "Demo updated scope");
    expect(document.body.textContent).not.toContain("unsafe raw server message");
    await user.click(within(dialog).getByRole("button", { name: en.lps.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findAllByText("Demo updated scope");
    const body = JSON.parse(String(responses(calls, "PUT", "entries")[1][1]?.body));
    expect(body.contacts[1]).toMatchObject({ fullName: null, emails: ["general@lps.local"], phones: ["+70000000002 ext. 001"] });
    expect(body.investmentUsd).toBe("9007199254740993.12500");
    expect(body.newJobs).toBeNull();
    expect(body.lastUpdatedOn).toBe("2026-10-12");
  });
  it("cancel keeps dirty edits; confirmed close clears the latch for a fresh editor", async () => {
    const calls = stubLps("expert"), { user } = renderRoute("/lps", { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.lps.edit }));
    await user.type(screen.getByRole("textbox", { name: en.lps.scopeRequired }), " changed");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: en.lps.close }));
    await user.click(screen.getByRole("button", { name: en.lps.keepEditing }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: en.lps.scopeRequired })).toHaveProperty("value", "Demo equipment manufacture changed");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: en.lps.close }));
    await user.click(screen.getByRole("button", { name: en.lps.discard }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: en.lps.edit }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("textbox", { name: en.lps.scopeRequired })).toHaveProperty("value", LPS_ENTRY.scopeDescription);
    expect(responses(calls, "PUT", "entries")).toHaveLength(0);
  });
  it("navigation while save is in flight cannot discard a write whose outcome is unknown", async () => {
    let complete!: (response: Response) => void;
    stubLps("expert", { [`PUT /api/v1/lps/entries/${LPS_ENTRY.id}`]: () => new Promise((resolve) => { complete = resolve; }) });
    const { user, router } = renderRoute("/lps", { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.lps.edit }));
    await user.type(screen.getByRole("textbox", { name: en.lps.scopeRequired }), " changed");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: en.lps.save }));
    await act(async () => { void router.navigate("/away"); });
    expect(await screen.findByText(en.lps.savingDescription)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.lps.discard })).toBeNull();
    expect(router.state.location.pathname).toBe("/lps");
    await user.click(screen.getByRole("button", { name: en.lps.keepEditing }));
    const entry = { ...LPS_ENTRY }; delete (entry as Partial<typeof entry>).rowNumber;
    await act(async () => complete(new Response(JSON.stringify(entry), { headers: { "content-type": "application/json" } })));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => { await router.navigate("/away"); });
    expect(router.state.location.pathname).toBe("/away");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
  it("company deletion conflict is explicit and keeps the confirmation open", async () => {
    stubLps("expert", { [`DELETE /api/v1/lps/companies/${LPS_COMPANY.id}`]: problem(409, "lps_company_in_use") });
    const { user } = renderRoute("/lps/companies", { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.lps.delete }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: en.lps.delete }));
    await screen.findByText(en.lps.errors.companyInUse);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
  it("a new entry reuses the chosen company, uses the LPS default and preserves unknown values", async () => {
    const calls = stubLps("expert", { "POST /api/v1/lps/entries": (_url, init) => {
      const input = JSON.parse(String(init?.body));
      const entry = { ...LPS_ENTRY, ...input, sourceType: LPS_ENTRY.sourceType, company: LPS_COMPANY, status: LPS_ENTRY.status };
      delete entry.rowNumber; delete entry.companyId; delete entry.statusId; delete entry.sourceTypeId; delete entry.commodityTypeIds;
      return new Response(JSON.stringify(entry), { headers: { "content-type": "application/json" } });
    } });
    const { user } = renderRoute("/lps", { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.lps.newEntry }));
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: en.lps.companyRequired }).hasAttribute("disabled")).toBe(false));
    await user.click(within(dialog).getByRole("combobox", { name: en.lps.companyRequired }));
    await user.click(await screen.findByRole("option", { name: /Demo LPS company · Kazakhstan/ }));
    await user.click(within(dialog).getByRole("combobox", { name: en.lps.statusRequired }));
    await user.click(await screen.findByRole("option", { name: "planning — Planning" }));
    await user.type(within(dialog).getByRole("textbox", { name: en.lps.scopeRequired }), "Demo second entry");
    await user.click(within(dialog).getByRole("button", { name: en.lps.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const input = JSON.parse(String(responses(calls, "POST", "entries")[0][1]?.body));
    expect(input).toMatchObject({ companyId: LPS_COMPANY.id, scopeDescription: "Demo second entry", investmentUsd: null, newJobs: null, plannedLaunch: null, lastUpdatedOn: null });
    expect(input).not.toHaveProperty("sourceTypeId");
    expect(responses(calls, "POST", "companies")).toHaveLength(0);
  });
  it("company create and rename update the list immediately without silently merging an existing name", async () => {
    let company = { ...LPS_COMPANY };
    const createdId = lpsId(12);
    const calls = stubLps("expert", {
      "GET /api/v1/lps/companies": () => new Response(JSON.stringify({ total: 1, offset: 0, limit: 50, items: [company] }), { headers: { "content-type": "application/json" } }),
      "POST /api/v1/lps/companies": (_url, init) => { const input = JSON.parse(String(init?.body)); company = { ...company, id: createdId, name: input.name, countries: [] }; return new Response(JSON.stringify(company), { headers: { "content-type": "application/json" } }); },
      [`PUT /api/v1/lps/companies/${createdId}`]: (_url, init) => { company = { ...company, name: JSON.parse(String(init?.body)).name }; return new Response(JSON.stringify(company), { headers: { "content-type": "application/json" } }); },
    });
    const { user } = renderRoute("/lps/companies", { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.lps.newCompany }));
    await user.type(screen.getByRole("textbox", { name: en.lps.companyNameRequired }), LPS_COMPANY.name);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: en.lps.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(JSON.parse(String(responses(calls, "POST", "companies")[0][1]?.body))).toEqual({ name: LPS_COMPANY.name, countryIds: [] });
    await user.click(screen.getByRole("button", { name: en.lps.edit }));
    await user.type(screen.getByRole("textbox", { name: en.lps.companyNameRequired }), " renamed");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: en.lps.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText(`${LPS_COMPANY.name} renamed`)).toBeTruthy();
    expect(responses(calls, "PUT", "companies")[0][0]).toBe(`/api/v1/lps/companies/${createdId}`);
    await user.click(screen.getByRole("link", { name: en.lps.title }));
    expect(await screen.findByRole("heading", { name: en.lps.title })).toBeTruthy();
    expect(screen.queryByText(en.lps.savingDescription)).toBeNull();
  });
  it("saving a nested company resumes its parent entry draft and releases the pending latch", async () => {
    const company = { ...LPS_COMPANY, id: lpsId(12), name: "Demo nested company", countries: [] };
    stubLps("expert", { "POST /api/v1/lps/companies": { body: company } });
    const { user } = renderRoute("/lps", { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.lps.newEntry }));
    await user.type(screen.getByRole("textbox", { name: en.lps.scopeRequired }), "Demo draft preserved");
    await user.click(screen.getByRole("button", { name: en.lps.newCompany }));
    const nested = screen.getAllByRole("dialog").at(-1)!;
    await user.type(within(nested).getByRole("textbox", { name: en.lps.companyNameRequired }), company.name);
    await user.click(within(nested).getByRole("button", { name: en.lps.save }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: en.lps.companyNameRequired })).toBeNull());
    expect(screen.getByRole("textbox", { name: en.lps.scopeRequired })).toHaveProperty("value", "Demo draft preserved");
    await waitFor(() => expect(screen.getByRole("button", { name: en.lps.save }).hasAttribute("disabled")).toBe(false));
    expect(screen.getByRole("combobox", { name: en.lps.companyRequired }).textContent).toContain(company.name);
  });
  it("table paging, sort and Back retain the same repeated filters; errors have a separate retry", async () => {
    let requests = 0;
    const calls = stubLps("operator", { "GET /api/v1/lps/entries": (url) => {
      requests++;
      if (requests === 1) return new Response(JSON.stringify({ code: "busy", title: "busy", status: 409 }), { status: 409 });
      return new Response(JSON.stringify(lpsList([LPS_ENTRY], 120, Number(url.searchParams.get("offset") ?? 0))), { headers: { "content-type": "application/json" } });
    } });
    const { user, router } = renderRoute(`/lps?cities=Demo+city&cities=Other+demo+city&countryIds=unknown`, { routes, locale: "en" });
    await screen.findByText(en.lps.errors.busy);
    await user.click(screen.getByRole("button", { name: en.lps.retry }));
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: en.lps.columns.investmentUsd }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("sort")).toBe("investmentUsd"));
    const next = screen.getAllByRole("button", { name: en.lps.next }).at(-1)!;
    await user.click(next);
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("offset")).toBe("50"));
    await act(async () => { await router.navigate(-1); });
    const restored = new URLSearchParams(router.state.location.search);
    expect(restored.getAll("cities")).toEqual(["Demo city", "Other demo city"]);
    expect(restored.getAll("countryIds")).toEqual(["unknown"]);
    expect(restored.get("sort")).toBe("investmentUsd");
    expect(restored.has("offset")).toBe(false);
    expect(responses(calls, "GET", "entries").length).toBeGreaterThanOrEqual(4);
  });
});

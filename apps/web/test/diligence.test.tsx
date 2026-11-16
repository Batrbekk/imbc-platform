import { DILIGENCE_RUN_STATES, MAX_FILE_BYTES, ROLES, type DiligenceRead, type ProfileFile } from "@imbc/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NuqsAdapter } from "nuqs/adapters/react-router/v8";
import { DiligencePage } from "@/routes/app/diligence";
import { ReviewsPage } from "@/routes/app/reviews";
import { CompanyPage } from "@/routes/app/company";
import en from "../messages/en.json";
import ru from "../messages/ru.json";
import kk from "../messages/kk.json";
import { stubApi } from "./support/api";
import { DD_API, DD_DATA, DD_HISTORY, DD_NEW_TIME, DD_PROFILE, DD_TIME, DD_URL, ddId, ddMe, stubDiligence } from "./support/diligence";
import { renderRoute } from "./support/render";

const routes = [{ path: "/imbc/profiles/:profileId/due-diligence", Component: DiligencePage }, { path: "/reviews", element: <NuqsAdapter><ReviewsPage /></NuqsAdapter> }, { path: "/companies/:profileId", Component: CompanyPage }];
const callsTo = (calls: ReturnType<typeof stubApi>, method: string, suffix = "") => calls.mock.calls.filter(([url, init]) => String(url) === `${DD_API}${suffix}` && (init?.method ?? "GET") === method);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const changed = (comment: string): DiligenceRead => ({ ...DD_DATA, record: { ...DD_DATA.record!, comment, updatedAt: DD_NEW_TIME } });
const upload: ProfileFile = { fileId: ddId(70), versionId: ddId(71), versionNumber: 1, originalName: "demo-report.pdf", byteSize: 4, mediaType: "application/pdf", scanState: "pending", rejectionReason: null, uploadedAt: DD_TIME, canDownload: false };

describe("Due diligence business screen", () => {
  it.each(ROLES)("%s gets exactly its Class C controls and denied roles issue no DD request", async role => {
    const calls = stubDiligence(role);
    renderRoute(DD_URL, { routes, locale: "en" });
    if (["expert", "director"].includes(role)) {
      expect(await screen.findByText(DD_DATA.record!.comment!)).toBeTruthy();
      expect(Boolean(screen.queryByRole("button", { name: en.diligence.overrideTitle }))).toBe(role === "expert");
      expect(Boolean(screen.queryByRole("button", { name: en.diligence.rerun }))).toBe(role === "expert");
      expect(screen.getByRole("button", { name: en.diligence.history })).toBeTruthy();
      const report = screen.getByRole("link", { name: /download version 2/ });
      expect(report.getAttribute("href")).toBe(`/api/v1/files/${ddId(20)}/content?version=2`);
    } else {
      expect(await screen.findByText(en.diligence.errors.forbidden)).toBeTruthy();
      expect(calls.mock.calls.some(([url]) => String(url).includes("/due-diligence"))).toBe(false);
    }
  });
  it.each(["en", "ru", "kk"] as const)("%s shows exact source values, distinct attention and all initially closed report groups", async locale => {
    stubDiligence("expert");
    const { user } = renderRoute(DD_URL, { routes, locale });
    const t = { en, ru, kk }[locale].diligence;
    const critical = await screen.findByRole("region", { name: t.critical }), attention = screen.getByRole("region", { name: t.attention });
    expect(within(critical).getByText("Demo critical bankruptcy")).toBeTruthy();
    expect(within(attention).getByText("Demo court counts")).toBeTruthy();
    expect(within(attention).queryByText("Demo shown zero")).toBeNull();
    expect(within(attention).queryByText("Demo source timeout")).toBeNull();
    expect(within(attention).getByText(DD_DATA.checks[1].adataValue!)).toBeTruthy();
    const details = Array.from(document.querySelectorAll("details"));
    expect(details).toHaveLength(5); expect(details.every(group => !group.open)).toBe(true);
    const tax = details.find(group => group.querySelector("summary")?.textContent?.includes(t.groups.company_tax))!;
    await user.click(tax.querySelector("summary")!);
    expect(tax.open).toBe(true); expect(within(tax).getByText("9007199254740993.12500")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.body.textContent).not.toContain("MISSING_MESSAGE");
    expect(document.body.textContent).not.toContain(ddId(1));
  });
  it.each(DILIGENCE_RUN_STATES)("latest %s attempt stays distinct from the saved source result", async state => {
    const data = { ...DD_DATA, lastRun: { ...DD_DATA.lastRun!, state, requestedAt: DD_NEW_TIME, completedAt: state === "waiting" ? null : DD_NEW_TIME, snapshotId: state === "waiting" ? null : ddId(41) } };
    stubDiligence("expert", data);
    renderRoute(DD_URL, { routes, locale: "en" });
    expect(await screen.findByText(en.diligence.runStates[state])).toBeTruthy();
    const source = screen.getByText(en.diligence.checkedAt).nextElementSibling?.textContent;
    expect(source).toContain("11/15/26"); expect(source).not.toContain("11/16/26");
    expect(screen.getByRole("button", { name: en.diligence.rerun }).hasAttribute("disabled")).toBe(state === "waiting");
  });
  it("empty unavailable source never invents a green result or clear missing checks", async () => {
    stubDiligence("director", { ...DD_DATA, record: null, checks: [], lastRun: { ...DD_DATA.lastRun!, state: "modules_not_connected" } });
    renderRoute(DD_URL, { routes, locale: "en" });
    expect(await screen.findByText(en.diligence.noRecord)).toBeTruthy();
    expect(screen.queryByText(en.diligence.results.green)).toBeNull();
    expect(screen.getByText(en.diligence.noChecks)).toBeTruthy();
  });
  it.each(["en", "ru", "kk"] as const)("%s marks a failed mock attempt even without a current record", async locale => {
    stubDiligence("director", { ...DD_DATA, record: null, checks: [], lastRun: { ...DD_DATA.lastRun!, state: "unavailable", isTestData: true } });
    renderRoute(DD_URL, { routes, locale }); const t = { en, ru, kk }[locale].diligence;
    expect(await screen.findByText(t.noRecord)).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText(t.testRun)).toBeTruthy();
    expect(screen.queryByText(t.testData)).toBeNull();
  });
  it.each(["en", "ru", "kk"] as const)("%s keeps real current provenance separate from the latest failed mock attempt", async locale => {
    stubDiligence("director", { ...DD_DATA, record: { ...DD_DATA.record!, sourceIsTestData: false }, lastRun: { ...DD_DATA.lastRun!, state: "no_answer", isTestData: true, snapshotId: ddId(41), completedAt: DD_NEW_TIME } });
    renderRoute(DD_URL, { routes, locale }); const t = { en, ru, kk }[locale].diligence;
    expect(await screen.findByText(DD_DATA.record!.comment!)).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText(t.testRun)).toBeTruthy();
    expect(screen.queryByText(t.testData)).toBeNull();
  });
  it.each(["en", "ru", "kk"] as const)("%s never labels a real latest attempt as mock because the retained result was mock", async locale => {
    stubDiligence("director", { ...DD_DATA, lastRun: { ...DD_DATA.lastRun!, state: "quota_exhausted", isTestData: false, snapshotId: ddId(41), completedAt: DD_NEW_TIME } });
    renderRoute(DD_URL, { routes, locale }); const t = { en, ru, kk }[locale].diligence;
    expect(await screen.findByText(t.testData)).toBeTruthy();
    expect(within(screen.getByRole("alert")).queryByText(t.testRun)).toBeNull();
  });
  it("malformed source response shows a safe read failure and can be retried", async () => {
    let tries = 0;
    stubDiligence("expert", DD_DATA, { [`GET ${DD_API}`]: () => json(++tries === 1 ? { ...DD_DATA, checks: [{ ...DD_DATA.checks[0], attention: true }] } : DD_DATA) });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    expect(await screen.findByText(en.diligence.errors.internal)).toBeTruthy();
    expect(screen.queryByText(DD_DATA.record!.comment!)).toBeNull();
    await user.click(screen.getByRole("button", { name: en.common.retry }));
    expect(await screen.findByText(DD_DATA.record!.comment!)).toBeTruthy();
  });
  it("rerun sends one explicit empty request and presents the returned pending state", async () => {
    const calls = stubDiligence("expert", DD_DATA, { [`POST ${DD_API}/runs`]: { status: 202, body: { ...DD_DATA, lastRun: { ...DD_DATA.lastRun!, state: "waiting", completedAt: null, snapshotId: null } } } });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.diligence.rerun }));
    expect(await screen.findByText(en.diligence.runStates.waiting)).toBeTruthy();
    expect(callsTo(calls, "POST", "/runs")).toHaveLength(1);
    expect(JSON.parse(String(callsTo(calls, "POST", "/runs")[0][1]?.body))).toEqual({});
  });
  it("409 preserves dirty intent and exact UTC6 token until deliberate reload and retry", async () => {
    let reads = 0, writes = 0;
    const calls = stubDiligence("expert", DD_DATA, {
      [`GET ${DD_API}`]: () => json(++reads === 1 ? DD_DATA : changed("Demo concurrent change")),
      [`PUT ${DD_API}/override`]: (_url, init) => ++writes === 1 ? json({ code: "diligence_changed", title: "Unsafe server detail", status: 409 }, 409) : json(changed(JSON.parse(String(init?.body)).comment)),
    });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.diligence.overrideTitle }));
    const dialog = screen.getByRole("dialog"), comment = within(dialog).getByRole("textbox", { name: en.diligence.comment });
    await user.clear(comment); await user.type(comment, "Demo intended decision");
    await user.click(within(dialog).getByRole("button", { name: en.diligence.save }));
    await screen.findByText(en.diligence.errors.changed);
    expect(comment).toHaveProperty("value", "Demo intended decision");
    expect(within(dialog).getByRole("button", { name: en.diligence.save }).hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).not.toContain("Unsafe server detail");
    await user.click(within(dialog).getByRole("button", { name: en.diligence.reloadKeepDraft }));
    await screen.findByText(en.diligence.rebased);
    expect(comment).toHaveProperty("value", "Demo intended decision");
    await user.click(within(dialog).getByRole("button", { name: en.diligence.save }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Demo intended decision")).toBeTruthy();
    const bodies = callsTo(calls, "PUT", "/override").map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([{ expectedUpdatedAt: DD_TIME, result: "red", comment: "Demo intended decision", reportFileId: ddId(20) }, { expectedUpdatedAt: DD_NEW_TIME, result: "red", comment: "Demo intended decision", reportFileId: ddId(20) }]);
  });
  it("first manual result has an exact null token and requires a deliberate result choice", async () => {
    const calls = stubDiligence("expert", { ...DD_DATA, record: null, checks: [], lastRun: null }, { [`PUT ${DD_API}/override`]: { body: changed("Demo first manual") } });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.diligence.overrideTitle }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: en.diligence.save }));
    await screen.findByText(en.diligence.errors.validation); expect(callsTo(calls, "PUT", "/override")).toHaveLength(0);
    await user.click(within(dialog).getByRole("combobox", { name: en.diligence.resultLabel }));
    await user.click(await screen.findByRole("option", { name: en.diligence.results.green }));
    await user.type(within(dialog).getByRole("textbox", { name: en.diligence.comment }), "Demo first manual");
    await user.click(within(dialog).getByRole("button", { name: en.diligence.save }));
    await waitFor(() => expect(callsTo(calls, "PUT", "/override")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(calls, "PUT", "/override")[0][1]?.body)).expectedUpdatedAt).toBeNull();
  });
  it("enhanced form saves full comment, state and captured existing report without rewriting source checks", async () => {
    const calls = stubDiligence("expert", DD_DATA, { [`PUT ${DD_API}/enhanced`]: { body: { ...DD_DATA, record: { ...DD_DATA.record!, enhanced: "done", enhancedComment: "Demo manual political exposure review", updatedAt: DD_NEW_TIME } } } });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.diligence.editEnhanced }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: en.diligence.enhancedLabel }));
    await user.click(await screen.findByRole("option", { name: en.diligence.enhancedStates.done }));
    await user.type(within(dialog).getByRole("textbox", { name: en.diligence.comment }), "Demo manual political exposure review");
    await user.click(within(dialog).getByRole("button", { name: en.diligence.save }));
    await screen.findByText("Demo manual political exposure review");
    expect(JSON.parse(String(callsTo(calls, "PUT", "/enhanced")[0][1]?.body))).toEqual({ expectedUpdatedAt: DD_TIME, enhanced: "done", comment: "Demo manual political exposure review", reportFileId: null });
  });
  it("passed upload enables save with the new file ID and correct purpose, never latest-version download", async () => {
    const calls = stubDiligence("expert", DD_DATA, {
      [`POST ${DD_API}/files/due_diligence_report`]: { status: 202, body: { upload } },
      [`GET ${DD_API}/files/due_diligence_report/${upload.fileId}`]: { body: { upload: { ...upload, scanState: "passed", canDownload: true } } },
      [`PUT ${DD_API}/override`]: { body: DD_DATA },
    });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.diligence.overrideTitle }));
    const dialog = screen.getByRole("dialog");
    await user.upload(within(dialog).getByLabelText(en.diligence.chooseReport), new File(["%PDF"], "demo-report.pdf", { type: "application/pdf" }));
    await screen.findByText(en.profileAttachments.state.passed);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: en.diligence.save }).hasAttribute("disabled")).toBe(false));
    await user.click(within(dialog).getByRole("button", { name: en.diligence.save }));
    await waitFor(() => expect(callsTo(calls, "PUT", "/override")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(calls, "PUT", "/override")[0][1]?.body)).reportFileId).toBe(upload.fileId);
    expect(callsTo(calls, "POST", "/files/due_diligence_report")[0][1]?.body instanceof FormData).toBe(true);
  });
  it("pending/rejected upload prevents save, shows scan reason, and can be removed from the draft", async () => {
    const calls = stubDiligence("expert", DD_DATA, {
      [`POST ${DD_API}/files/due_diligence_report`]: { status: 202, body: { upload } },
      [`GET ${DD_API}/files/due_diligence_report/${upload.fileId}`]: { body: { upload: { ...upload, scanState: "rejected", rejectionReason: "malware" } } },
    });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.diligence.overrideTitle }));
    const dialog = screen.getByRole("dialog");
    await user.upload(within(dialog).getByLabelText(en.diligence.chooseReport), new File(["%PDF"], "demo-report.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(en.profileAttachments.reason.malware)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: en.diligence.save }).hasAttribute("disabled")).toBe(true);
    expect(callsTo(calls, "PUT", "/override")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: en.diligence.removeReport }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: en.diligence.save }).hasAttribute("disabled")).toBe(false));
  });
  it("pending scan holds save until exact candidate metadata passes", async () => {
    let release: (response: Response) => void = () => {};
    const waiting = new Promise<Response>(resolve => { release = resolve; });
    const calls = stubDiligence("expert", DD_DATA, {
      [`POST ${DD_API}/files/due_diligence_report`]: { status: 202, body: { upload } },
      [`GET ${DD_API}/files/due_diligence_report/${upload.fileId}`]: () => waiting,
    });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" }); await user.click(await screen.findByRole("button", { name: en.diligence.overrideTitle }));
    const dialog = screen.getByRole("dialog"); await user.upload(within(dialog).getByLabelText(en.diligence.chooseReport), new File(["%PDF"], "demo-report.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(en.profileAttachments.state.pending)).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: en.diligence.save }).hasAttribute("disabled")).toBe(true);
    expect(callsTo(calls, "PUT", "/override")).toHaveLength(0);
    await act(async () => release(json({ upload: { ...upload, scanState: "passed", canDownload: true } })));
    await screen.findByText(en.profileAttachments.state.passed);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: en.diligence.save }).hasAttribute("disabled")).toBe(false));
  });
  it("oversized report is rejected before transmission and leaves the saved binding intact", async () => {
    const calls = stubDiligence(); const { user } = renderRoute(DD_URL, { routes, locale: "en" }); await user.click(await screen.findByRole("button", { name: en.diligence.overrideTitle }));
    const dialog = screen.getByRole("dialog"); await user.upload(within(dialog).getByLabelText(en.diligence.chooseReport), new File([new Uint8Array(MAX_FILE_BYTES + 1)], "demo-oversize.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(en.diligence.errors.fileTooLarge)).toBeTruthy(); expect(callsTo(calls, "POST", "/files/due_diligence_report")).toHaveLength(0);
    expect(within(dialog).getByText(en.diligence.reportRetained)).toBeTruthy();
  });
  it("enhanced upload uses its own purpose and saves the passed file as enhanced evidence only", async () => {
    const calls = stubDiligence("expert", DD_DATA, {
      [`POST ${DD_API}/files/enhanced_due_diligence_report`]: { status: 202, body: { upload } },
      [`GET ${DD_API}/files/enhanced_due_diligence_report/${upload.fileId}`]: { body: { upload: { ...upload, scanState: "passed", canDownload: true } } },
      [`PUT ${DD_API}/enhanced`]: { body: DD_DATA },
    });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" }); await user.click(await screen.findByRole("button", { name: en.diligence.editEnhanced }));
    const dialog = screen.getByRole("dialog"); await user.upload(within(dialog).getByLabelText(en.diligence.chooseReport), new File(["%PDF"], "demo-enhanced.pdf", { type: "application/pdf" }));
    await screen.findByText(en.profileAttachments.state.passed);
    await waitFor(() => expect(within(dialog).getByRole("button", { name: en.diligence.save }).hasAttribute("disabled")).toBe(false)); await user.click(within(dialog).getByRole("button", { name: en.diligence.save }));
    await waitFor(() => expect(callsTo(calls, "PUT", "/enhanced")).toHaveLength(1));
    expect(JSON.parse(String(callsTo(calls, "PUT", "/enhanced")[0][1]?.body)).reportFileId).toBe(upload.fileId);
    expect(callsTo(calls, "POST", "/files/due_diligence_report")).toHaveLength(0); expect(callsTo(calls, "PUT", "/override")).toHaveLength(0);
  });
  it("cancel keeps dirty input until a deliberate discard and restores trigger focus", async () => {
    stubDiligence(); const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    const trigger = await screen.findByRole("button", { name: en.diligence.overrideTitle }); await user.click(trigger);
    const comment = screen.getByRole("textbox", { name: en.diligence.comment }); await user.type(comment, " Demo unsaved");
    await user.click(screen.getByRole("button", { name: en.diligence.cancel }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: en.profileEditor.stay }));
    expect(comment).toHaveProperty("value", "Demo saved explanation Demo unsaved");
    await user.click(screen.getByRole("button", { name: en.diligence.cancel }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: en.profileEditor.discard }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it("director history shows full immutable before/after and distinct exact versions of the same file", async () => {
    const calls = stubDiligence("director", { ...DD_DATA, checks: [] }); const { user } = renderRoute(DD_URL, { routes, locale: "en" });
    const trigger = await screen.findByRole("button", { name: en.diligence.history }); await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    await screen.findByText(/Demo SME/);
    await user.click(within(dialog).getByText(en.diligence.historyActions.override));
    const before = within(dialog).getByRole("region", { name: en.diligence.before }), after = within(dialog).getByRole("region", { name: en.diligence.after });
    expect(within(before).getByText("Demo old full comment")).toBeTruthy(); expect(within(after).getByText("Demo new full comment")).toBeTruthy();
    expect(within(before).getByRole("link", { name: /version 1/ }).getAttribute("href")).toBe(`/api/v1/files/${ddId(20)}/content?version=1`);
    expect(within(after).getByRole("link", { name: /version 2/ }).getAttribute("href")).toBe(`/api/v1/files/${ddId(20)}/content?version=2`);
    expect(within(before).getByText("9007199254740993.12500")).toBeTruthy();
    expect(dialog.textContent).not.toContain(ddId(20)); expect(screen.queryByRole("textbox")).toBeNull();
    expect(calls.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: en.diligence.close }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull()); await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
  it("history pages use the exact last event cursor and retain already loaded changes", async () => {
    const first = Array.from({ length: 50 }, (_, i) => ({ ...DD_HISTORY, id: ddId(100 + i) }));
    const calls = stubDiligence("director", DD_DATA, { [`GET ${DD_API}/history`]: { body: first }, [`GET ${DD_API}/history?beforeId=${ddId(149)}`]: { body: [{ ...DD_HISTORY, id: ddId(200), actorName: "Demo older SME" }] } });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" }); await user.click(await screen.findByRole("button", { name: en.diligence.history }));
    await user.click(await screen.findByRole("button", { name: en.diligence.loadMore }));
    await screen.findByText(/Demo older SME/);
    expect(screen.getByRole("dialog").querySelectorAll("details")).toHaveLength(51);
    expect(calls.mock.calls.some(([url]) => String(url) === `${DD_API}/history?beforeId=${ddId(149)}`)).toBe(true);
  });
  it.each((["en", "ru", "kk"] as const).flatMap(locale => [true, false].map(beforeMock => ({ locale, beforeMock }))))("$locale history uses each exact pinned source when before mock=$beforeMock", async ({ locale, beforeMock }) => {
    const historical = { ...DD_HISTORY, action: "due_diligence.received" as const, actorId: null, actorName: null,
      diff: { ...DD_HISTORY.diff, actor: { type: "system" as const },
        before: { ...DD_HISTORY.diff.before, record: { ...DD_HISTORY.diff.before.record!, source_snapshot_id: ddId(80) } },
        after: { ...DD_HISTORY.diff.after, record: { ...DD_HISTORY.diff.after.record!, source_snapshot_id: ddId(81) } } },
      sourceSnapshots: [{ snapshotId: ddId(80), checkedAt: DD_TIME, isTestData: beforeMock }, { snapshotId: ddId(81), checkedAt: DD_NEW_TIME, isTestData: !beforeMock }],
    };
    const current = { ...DD_DATA, record: { ...DD_DATA.record!, sourceSnapshotId: ddId(90), sourceIsTestData: beforeMock }, lastRun: { ...DD_DATA.lastRun!, isTestData: beforeMock } };
    stubDiligence("director", current, { [`GET ${DD_API}/history`]: { body: [historical] } });
    const { user } = renderRoute(DD_URL, { routes, locale }), t = { en, ru, kk }[locale].diligence;
    await user.click(await screen.findByRole("button", { name: t.history }));
    const dialog = screen.getByRole("dialog");
    await user.click(await within(dialog).findByText(t.historyActions.received));
    const before = await within(dialog).findByRole("region", { name: t.before }), after = within(dialog).getByRole("region", { name: t.after });
    expect(Boolean(within(before).queryByText(t.testData))).toBe(beforeMock);
    expect(Boolean(within(after).queryByText(t.testData))).toBe(!beforeMock);
    const oldTime = within(before).getByText(t.checkedAt).nextElementSibling?.textContent;
    const newTime = within(after).getByText(t.checkedAt).nextElementSibling?.textContent;
    expect(oldTime).toContain(locale === "en" ? "11/15/26" : "15.11.2026");
    expect(newTime).toContain(locale === "en" ? "11/16/26" : "16.11.2026");
    expect(dialog.textContent).not.toContain(ddId(80)); expect(dialog.textContent).not.toContain(ddId(90));
  });
  it("manual historical records with no source never inherit the current mock source badge", async () => {
    const manual = { ...DD_HISTORY, sourceSnapshots: [], diff: { ...DD_HISTORY.diff,
      before: { ...DD_HISTORY.diff.before, checks: [], record: { ...DD_HISTORY.diff.before.record!, source_snapshot_id: null, adata_result: null, overridden_by: ddId(1), overridden_at: DD_TIME } },
      after: { ...DD_HISTORY.diff.after, checks: [], record: { ...DD_HISTORY.diff.after.record!, source_snapshot_id: null, adata_result: null, overridden_by: ddId(1), overridden_at: DD_NEW_TIME } } } };
    stubDiligence("director", DD_DATA, { [`GET ${DD_API}/history`]: { body: [manual] } });
    const { user } = renderRoute(DD_URL, { routes, locale: "en" }); await user.click(await screen.findByRole("button", { name: en.diligence.history }));
    const dialog = screen.getByRole("dialog"); await user.click(await within(dialog).findByText(en.diligence.historyActions.override));
    const before = await within(dialog).findByRole("region", { name: en.diligence.before });
    expect(within(dialog).queryByText(en.diligence.testData)).toBeNull();
    expect(within(before).getByText(en.diligence.checkedAt).nextElementSibling?.textContent).toBe(en.diligence.noSource);
  });
  it.each(ROLES)("company DD navigation is available only to permitted %s", async role => {
    const company = { profileId: DD_PROFILE, bin: "900000000010", nameEn: "Demo DD catalogue company", nameRu: "Demo DD catalogue company", region: "Demo region", commodityGroups: [], tnvedCodes: [], mainTnved: null, headcountTotal: null, certificates: [], siteSurveyed: false, tier: "tier_1", unifiedRegister: false, worksWithCount: 0, updateStatus: "active", pendingChanges: false, verifiedAt: DD_TIME, companyPhone: null, companyEmail: null };
    stubApi({ "GET /api/auth/me": { body: ddMe(role) }, [`GET /api/v1/catalog/companies/${DD_PROFILE}`]: { body: company } });
    renderRoute(`/companies/${DD_PROFILE}`, { routes, locale: "en" });
    await screen.findByRole("heading", { name: company.nameEn });
    if (["expert", "director"].includes(role)) await screen.findByRole("link", { name: en.diligence.open });
    const link = screen.queryByRole("link", { name: en.diligence.open });
    expect(Boolean(link)).toBe(["expert", "director"].includes(role)); if (link) expect(link.getAttribute("href")).toBe(DD_URL);
  });
  it.each(ROLES)("queue DD links retain exact target and filtered return path only for allowed %s", async role => {
    const calls = stubApi({ "GET /api/auth/me": { body: ddMe(role) }, "GET /api/v1/reviews/queue": { body: { total: 1, offset: 0, limit: 25, items: [{ profileId: DD_PROFILE, organizationName: "Demo DD queue company", bin: "900000000010", status: "submitted", hasPendingChanges: false, assignmentId: ddId(90), assignedExpertId: null, assignedExpert: null, registeredAt: DD_TIME, receivedAt: DD_TIME, unresolved: false }] } }, "GET /api/v1/reviews/queue/experts": { body: [] }, [`GET ${DD_API}`]: { body: DD_DATA } });
    const { user, router } = renderRoute("/reviews?status=submitted", { routes, locale: "en" });
    if (role !== "expert") {
      await screen.findByText(en.reviewWorkflow.errors.forbidden);
      expect(screen.queryByRole("link", { name: en.reviewWorkflow.openDiligence })).toBeNull();
      expect(calls.mock.calls.some(([url]) => String(url).includes("/api/v1/reviews/") || String(url).includes(DD_API))).toBe(false);
      return;
    }
    await screen.findByText("Demo DD queue company");
    const link = screen.getByRole("link", { name: en.reviewWorkflow.openDiligence });
    expect(link.getAttribute("href")).toBe(DD_URL); await user.click(link); await screen.findByText(DD_DATA.record!.comment!);
    expect(router.state.location.state).toEqual({ from: "/reviews?status=submitted" });
    expect(screen.getByRole("link", { name: en.diligence.back }).getAttribute("href")).toBe("/reviews?status=submitted");
  });
});

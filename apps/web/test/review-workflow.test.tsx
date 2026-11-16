import { ROLES, type ReviewSectionDecisionInput } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewWorkbenchPage } from "@/features/reviews/workbench";
import { reviewSubjectKey } from "@/features/reviews/data";
import { renderRoute } from "./support/render";
import { problem } from "./support/api";
import { REVIEW_API, REVIEW_ID, REVIEW_NAME, REVIEW_NEW_TIME, REVIEW_PROFILE, REVIEW_TIME, REVIEW_URL, reviewFixture, stubReview } from "./support/review-workflow";
import { uuid } from "./support/profile-fixtures";
import en from "../messages/en.json";
import ru from "../messages/ru.json";
import kk from "../messages/kk.json";

const mount = (locale: "en" | "ru" | "kk" = "en") => renderRoute(REVIEW_URL, { locale, routes: [{ path: REVIEW_URL, element: <ReviewWorkbenchPage assignmentId={REVIEW_ID} /> }, { path: "/reviews", element: <h1>Demo queue</h1> }] });
const active = (kind: string) => screen.getByRole("region", { name: kind });
async function choose(user: ReturnType<typeof mount>["user"], container: ReturnType<typeof within>, name: string | RegExp, value: string) {
  await user.click(container.getByRole("combobox", { name })); await user.click(await screen.findByRole("option", { name: value }));
}
describe("exact submitted SME workbench REV05–09", () => {
  it.each(ROLES.filter(role => role !== "expert"))("%s never opens or reads a workbench", async role => {
    const api = stubReview(role); mount(); await screen.findByText(en.reviewWorkflow.errors.forbidden);
    expect(api.mock.calls.some(([url]) => String(url).startsWith(REVIEW_API))).toBe(false);
  });
  it.each(["en", "ru", "kk"] as const)("%s reads exact seven sections, frozen labels and numeric captured files without producer queries", async locale => {
    const messages = { en, ru, kk }[locale], api = stubReview(); const { user } = mount(locale);
    await screen.findByRole("heading", { name: messages.reviewWorkflow.reviewTitle.replace("{name}", REVIEW_NAME) });
    await screen.findByText("Demo submitted factory address");
    expect(api.mock.calls.filter(([url]) => String(url).includes(`${REVIEW_API}/sections/`))).toHaveLength(7);
    expect(api.mock.calls.some(([url]) => String(url).includes("/own/") || String(url).includes("/dictionaries/") || String(url).includes("/org-chart-sample"))).toBe(false);
    await user.click(screen.getByRole("button", { name: new RegExp(`^${messages.profileEditor.sections.products}`) }));
    const products = within(active(messages.profileEditor.sections.products)); await products.findByText("0012345678"); expect(products.getByText("Demo held product certificate — Demo cert 003")).toBeTruthy();
    expect(products.getByText(content => content.replace(/\D/g, "") === "9007199254740993125")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: new RegExp(`^${messages.profileEditor.sections.production}`) }));
    expect(within(active(messages.profileEditor.sections.production)).getByText(locale === "en" ? "Demo submitted pump — 0012345678" : "Демо насос — 0012345678")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: new RegExp(`^${messages.profileEditor.sections.personnel}`) }));
    const link = within(active(messages.profileEditor.sections.personnel)).getByRole("link"); expect(link.getAttribute("href")).toBe(`/api/v1/files/${uuid(830)}/content?version=2`);
    expect(screen.queryByRole("button", { name: messages.profileEditor.edit })).toBeNull();
  });
  it("atomic document save sends item outcomes and one section comment, not per-item comments", async () => {
    const fixture = reviewFixture(), payloads: ReviewSectionDecisionInput[] = [];
    stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: (_url, init) => {
      const body = JSON.parse(String(init?.body)) as ReviewSectionDecisionInput; payloads.push(body);
      const section = fixture.workbench.sections.find(section => section.revisionId === body.sectionRevisionId)!;
      section.decision = { id: uuid(1600), outcome: body.outcome, comment: body.comment, decidedAt: REVIEW_NEW_TIME };
      return Response.json({ assignmentId: REVIEW_ID, sectionRevisionId: section.revisionId, decisions: [{ ...section.decision, assignmentId: REVIEW_ID, expertId: fixture.workbench.assignment.expertId, subject: { kind: "section", sectionRevisionId: section.revisionId } }] });
    } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: /^Documents ·/ }));
    const panel = within(active(en.profileEditor.sections.documents)); await choose(user, panel, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.rejected);
    await choose(user, panel, /Demo original document label/, en.reviewWorkflow.outcome.rejected);
    await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Demo one section explanation");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toMatchObject({ expectedDecisionId: null, outcome: "rejected", comment: "Demo one section explanation" });
    expect(payloads[0]!.items).toEqual([{ subject: fixture.workbench.sections.find(section => section.kind === "documents")!.items[0]!.subject, outcome: "rejected" }]);
    expect(panel.getAllByRole("textbox", { name: en.reviewWorkflow.sectionComment })).toHaveLength(1);
  });
  it("ISO absence is readable without a fictitious certificate item; incomplete optional production can be verified", async () => {
    const fixture = reviewFixture(), bodies: ReviewSectionDecisionInput[] = [];
    stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: (_url, init) => { const body = JSON.parse(String(init?.body)); bodies.push(body); return Response.json({ assignmentId: REVIEW_ID, sectionRevisionId: body.sectionRevisionId, decisions: [{ id: uuid(1600), assignmentId: REVIEW_ID, expertId: fixture.workbench.assignment.expertId, subject: { kind: "section", sectionRevisionId: body.sectionRevisionId }, outcome: body.outcome, comment: body.comment, decidedAt: REVIEW_NEW_TIME }] }); } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: /^Certificates ·/ }));
    const certificates = within(active(en.profileEditor.sections.certificates)); expect(certificates.getByText(en.profileRecords.status.not_held)).toBeTruthy();
    expect(certificates.getAllByRole("combobox")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /^Production ·/ })); const production = within(active(en.profileEditor.sections.production));
    await choose(user, production, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.verified);
    await user.click(production.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await waitFor(() => expect(bodies).toHaveLength(1)); expect(bodies[0]!.items).toEqual([]);
  });
  it("rejected section needs its comment and does not send an invalid request", async () => {
    const api = stubReview(), { user } = mount(); await screen.findByText("Demo submitted factory address"); const panel = within(active(en.profileEditor.sections.main_information));
    await choose(user, panel, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.rejected); await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }));
    await panel.findByText(en.reviewWorkflow.errors.validation); expect(api.mock.calls.some(([url]) => String(url).endsWith("/section-decision"))).toBe(false);
  });
  it("stale CAS preserves comment/outcome and explicitly reloads the exact decision token", async () => {
    const fixture = reviewFixture(), bodies: ReviewSectionDecisionInput[] = [], stale = problem(409, "review_section_changed") as (url: URL) => Response;
    let changed = false;
    stubReview("expert", { [`GET ${REVIEW_API}`]: () => {
      if (changed) fixture.workbench.sections.find(section => section.kind === "main_information")!.decision = { id: uuid(1610), outcome: "rejected", comment: "Demo other tab", decidedAt: REVIEW_NEW_TIME };
      return Response.json(fixture.workbench);
    }, [`POST ${REVIEW_API}/section-decision`]: (url, init) => { const body = JSON.parse(String(init?.body)); bodies.push(body); if (!changed) { changed = true; return stale(url); }
      return Response.json({ assignmentId: REVIEW_ID, sectionRevisionId: body.sectionRevisionId, decisions: [{ id: uuid(1611), assignmentId: REVIEW_ID, expertId: fixture.workbench.assignment.expertId, subject: { kind: "section", sectionRevisionId: body.sectionRevisionId }, outcome: body.outcome, comment: body.comment, decidedAt: REVIEW_NEW_TIME }] }); } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); const panel = within(active(en.profileEditor.sections.main_information));
    await choose(user, panel, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.verified); await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Demo preserved intent");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await panel.findByText(en.reviewWorkflow.errors.changed);
    expect(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }).hasAttribute("disabled")).toBe(true);
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.reload })); await panel.findByText(en.reviewWorkflow.rebased);
    expect((panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }) as HTMLTextAreaElement).value).toBe("Demo preserved intent");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await waitFor(() => expect(bodies).toHaveLength(2)); expect(bodies[1]).toMatchObject({ expectedDecisionId: uuid(1610), outcome: "verified", comment: "Demo preserved intent" });
  });
  it("unpassed captured files have neither download nor verification choices", async () => {
    const fixture = reviewFixture(), doc = fixture.sections.documents; if (doc.kind !== "documents") throw new Error();
    doc.data.documents[0]!.file = { ...doc.data.documents[0]!.file!, scanState: "pending", canDownload: false };
    stubReview("expert", {}, fixture); const { user } = mount(); await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: /^Documents ·/ }));
    const panel = within(active(en.profileEditor.sections.documents)); expect(panel.queryByRole("link")).toBeNull();
    await user.click(panel.getByRole("combobox", { name: en.reviewWorkflow.sectionOutcome })); expect((await screen.findByRole("option", { name: en.reviewWorkflow.outcome.verified })).getAttribute("aria-disabled")).toBe("true");
  });
  it("unchanged retained sections are read-only while changed sections remain editable", async () => {
    const fixture = reviewFixture(); fixture.workbench.hasPendingChanges = true; fixture.workbench.profileStatus = "verified";
    const section = fixture.workbench.sections.find(section => section.kind === "main_information")!; section.reviewRequired = false; section.retainedDecisionId = uuid(1620); section.decision = { id: uuid(1620), outcome: "verified", comment: "Demo previous acceptance", decidedAt: REVIEW_NEW_TIME };
    stubReview("expert", {}, fixture); const { user } = mount(); await screen.findByText(en.reviewWorkflow.pendingChanges);
    const panel = within(active(en.profileEditor.sections.main_information)); await panel.findByText(en.reviewWorkflow.retainedHint); expect(panel.queryByRole("textbox")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^Production ·/ })); expect(within(active(en.profileEditor.sections.production)).getByRole("textbox", { name: en.reviewWorkflow.sectionComment })).toBeTruthy();
  });
  it.each(["en", "ru", "kk"] as const)("%s shows unchanged retained rejection and original item decision/comment without editing", async locale => {
    const fixture = reviewFixture(), messages = { en, ru, kk }[locale];
    const section = fixture.workbench.sections.find(section => section.kind === "documents")!;
    section.reviewRequired = false; section.retainedDecisionId = uuid(1960);
    section.decision = { id: uuid(1960), outcome: "rejected", comment: "Demo original unchanged rejection", decidedAt: REVIEW_TIME };
    section.items[0]!.decision = { id: uuid(1961), outcome: "rejected", comment: section.decision.comment, decidedAt: REVIEW_TIME };
    Object.assign(fixture.sections.documents, { reviewRequired: false, retainedDecisionId: section.retainedDecisionId, decision: section.decision, items: section.items });
    const api = stubReview("expert", {}, fixture), { user } = mount(locale);
    await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: new RegExp(`^${messages.profileEditor.sections.documents}`) }));
    const panel = within(active(messages.profileEditor.sections.documents)), decision = within(panel.getByRole("region", { name: messages.reviewWorkflow.sectionDecision }));
    expect(decision.getAllByText(messages.reviewWorkflow.outcome.rejected)).toHaveLength(2);
    expect(decision.getByText(messages.reviewWorkflow.retained)).toBeTruthy(); expect(decision.getByText(messages.reviewWorkflow.retainedHint)).toBeTruthy();
    expect(decision.getByText("Demo original unchanged rejection")).toBeTruthy(); expect(decision.getByText(/Demo original document label/)).toBeTruthy();
    expect(decision.queryByText(messages.reviewWorkflow.outcome.verified)).toBeNull(); expect(decision.queryByRole("textbox")).toBeNull(); expect(decision.queryByRole("combobox")).toBeNull();
    expect(decision.queryByRole("button", { name: messages.reviewWorkflow.saveDecision })).toBeNull();
    expect(panel.getByRole("link").getAttribute("href")).toBe(`/api/v1/files/${uuid(832)}/content?version=2`);
    expect(api.mock.calls.some(([url, init]) => String(url).endsWith("/section-decision") || init?.method === "PUT")).toBe(false);
  });
  it("finishes a partial retained rejection using its existing section choice, comment and exact old CAS", async () => {
    const fixture = reviewFixture(), payloads: ReviewSectionDecisionInput[] = [];
    const section = fixture.workbench.sections.find(section => section.kind === "documents")!;
    section.retainedDecisionId = uuid(1980);
    section.decision = { id: uuid(1980), outcome: "rejected", comment: "Demo retained section needs a document decision", decidedAt: REVIEW_TIME };
    Object.assign(fixture.sections.documents, { retainedDecisionId: section.retainedDecisionId, decision: section.decision });
    stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: (_url, init) => {
      const body = JSON.parse(String(init?.body)) as ReviewSectionDecisionInput; payloads.push(body);
      section.decision = { id: uuid(1981), outcome: body.outcome, comment: body.comment, decidedAt: REVIEW_NEW_TIME };
      section.items[0]!.decision = { ...section.decision, id: uuid(1982) };
      Object.assign(fixture.sections.documents, { decision: section.decision, items: section.items });
      return Response.json({ assignmentId: REVIEW_ID, sectionRevisionId: section.revisionId, decisions: [
        { ...section.items[0]!.decision, assignmentId: REVIEW_ID, expertId: fixture.workbench.assignment.expertId, subject: section.items[0]!.subject },
        { ...section.decision, assignmentId: REVIEW_ID, expertId: fixture.workbench.assignment.expertId, subject: { kind: "section", sectionRevisionId: section.revisionId } },
      ] });
    } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: /^Documents ·/ }));
    const panel = within(active(en.profileEditor.sections.documents));
    expect(panel.getByRole("combobox", { name: en.reviewWorkflow.sectionOutcome }).textContent).toContain(en.reviewWorkflow.outcome.rejected);
    expect(panel.getByText("Demo retained section needs a document decision", { selector: "p" })).toBeTruthy();
    expect((panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }) as HTMLTextAreaElement).value).toBe("Demo retained section needs a document decision");
    expect(panel.getByRole("combobox", { name: /Demo original document label/ }).textContent).toContain(en.reviewWorkflow.chooseDecision);
    expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(true);
    await choose(user, panel, /Demo original document label/, en.reviewWorkflow.outcome.rejected);
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }));
    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toEqual({ sectionRevisionId: section.revisionId, expectedDecisionId: uuid(1980), outcome: "rejected", comment: "Demo retained section needs a document decision",
      items: [{ subject: section.items[0]!.subject, outcome: "rejected" }] });
    await waitFor(() => expect(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }).hasAttribute("disabled")).toBe(true));
    expect(panel.queryByText(en.reviewWorkflow.errors.validation)).toBeNull();
  });
  it("uses the partial source's own final CAS and retains its completed new decision after another Unlock", async () => {
    const fixture = reviewFixture(), payloads: ReviewSectionDecisionInput[] = [], ownId = uuid(1991), completedId = uuid(1992);
    const section = fixture.workbench.sections.find(section => section.kind === "documents")!;
    // An individual-Core source has its own section decision while its captured document is still undecided.
    section.retainedDecisionId = ownId;
    section.decision = { id: ownId, outcome: "rejected", comment: "Demo final OWN source comment", decidedAt: REVIEW_NEW_TIME };
    Object.assign(fixture.sections.documents, { retainedDecisionId: ownId, decision: section.decision });
    stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: (_url, init) => {
      const body = JSON.parse(String(init?.body)) as ReviewSectionDecisionInput; payloads.push(body);
      section.decision = { id: completedId, outcome: body.outcome, comment: body.comment, decidedAt: REVIEW_NEW_TIME };
      section.items[0]!.decision = { ...section.decision, id: uuid(1993) };
      Object.assign(fixture.sections.documents, { decision: section.decision, items: section.items });
      return Response.json({ assignmentId: REVIEW_ID, sectionRevisionId: section.revisionId, decisions: [
        { ...section.items[0]!.decision, assignmentId: REVIEW_ID, expertId: fixture.workbench.assignment.expertId, subject: section.items[0]!.subject },
        { ...section.decision, assignmentId: REVIEW_ID, expertId: fixture.workbench.assignment.expertId, subject: { kind: "section", sectionRevisionId: section.revisionId } },
      ] });
    } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: /^Documents ·/ }));
    const panel = within(active(en.profileEditor.sections.documents));
    expect(panel.getByText("Demo final OWN source comment", { selector: "p" })).toBeTruthy();
    expect(panel.getByRole("combobox", { name: en.reviewWorkflow.sectionOutcome }).textContent).toContain(en.reviewWorkflow.outcome.rejected);
    await choose(user, panel, /Demo original document label/, en.reviewWorkflow.outcome.rejected);
    await user.clear(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }));
    await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Demo completed OWN batch comment");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }));
    await waitFor(() => expect(payloads).toHaveLength(1));
    expect(payloads[0]).toMatchObject({ expectedDecisionId: ownId, outcome: "rejected", comment: "Demo completed OWN batch comment", items: [{ subject: section.items[0]!.subject, outcome: "rejected" }] });
    await panel.findByText("Demo completed OWN batch comment", { selector: "p" });
    await waitFor(() => expect(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }).hasAttribute("disabled")).toBe(true));
    cleanup();

    const next = structuredClone(fixture), nextId = uuid(1994), nextApi = `/api/v1/reviews/assignments/${nextId}`, nextUrl = `/reviews/assignments/${nextId}`;
    next.workbench.assignment.id = nextId; next.workbench.canSubmitResult = true;
    next.workbench.sections.forEach((entry, index) => {
      if (entry.kind !== "documents") {
        entry.decision = { id: uuid(2000 + index), outcome: "verified", comment: null, decidedAt: REVIEW_TIME };
        entry.items.forEach(item => { item.decision = entry.decision; });
      }
      entry.reviewRequired = false; entry.retainedDecisionId = entry.decision!.id;
      Object.assign(next.sections[entry.kind], { decision: entry.decision, items: entry.items, reviewRequired: false, retainedDecisionId: entry.retainedDecisionId });
    });
    const nextFetch = stubReview("expert", { [`GET ${nextApi}`]: { body: next.workbench }, [`POST ${nextApi}/open`]: { body: next.workbench },
      ...Object.fromEntries(next.workbench.sections.map(entry => [`GET ${nextApi}/sections/${entry.kind}`, { body: next.sections[entry.kind] }])),
    }, next);
    const { user: nextUser } = renderRoute(nextUrl, { locale: "en", routes: [{ path: nextUrl, element: <ReviewWorkbenchPage assignmentId={nextId} /> }, { path: "/reviews", element: <h1>Demo queue</h1> }] });
    await screen.findByText("Demo submitted factory address"); await nextUser.click(screen.getByRole("button", { name: /^Documents ·/ }));
    const retained = within(within(active(en.profileEditor.sections.documents)).getByRole("region", { name: en.reviewWorkflow.sectionDecision }));
    expect(retained.getByText("Demo completed OWN batch comment")).toBeTruthy(); expect(retained.queryByText("Demo final OWN source comment")).toBeNull();
    expect(retained.getAllByText(en.reviewWorkflow.outcome.rejected)).toHaveLength(2); expect(retained.getByText(en.reviewWorkflow.retained)).toBeTruthy();
    expect(retained.queryByRole("combobox")).toBeNull(); expect(retained.queryByRole("button", { name: en.reviewWorkflow.saveDecision })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(false));
    expect(nextFetch.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => String(url))).toEqual([`${nextApi}/open`]);
  });
  it("kept rejection counts as an existing decision and submits Returned without new section clicks", async () => {
    const fixture = reviewFixture(); fixture.workbench.canSubmitResult = true;
    fixture.workbench.sections.forEach((section, index) => {
      section.decision = { id: uuid(1970 + index), outcome: section.kind === "documents" ? "rejected" : "verified", comment: section.kind === "documents" ? "Demo unchanged rejection after Unlock" : null, decidedAt: REVIEW_TIME };
      section.items.forEach(item => { item.decision = section.decision; });
      if (section.kind === "documents") { section.reviewRequired = false; section.retainedDecisionId = section.decision.id; }
      Object.assign(fixture.sections[section.kind], { decision: section.decision, items: section.items, reviewRequired: section.reviewRequired, retainedDecisionId: section.retainedDecisionId });
    });
    const api = stubReview("expert", { [`POST ${REVIEW_API}/submit-result`]: { body: { profileId: REVIEW_PROFILE, assignmentId: REVIEW_ID, profileStatus: "returned", closedAt: REVIEW_NEW_TIME, publishKinds: [], retainKinds: [] } } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address");
    await waitFor(() => expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(false));
    await user.click(screen.getByRole("button", { name: en.reviewWorkflow.submitResult })); await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: en.reviewWorkflow.confirmResult }));
    await screen.findByRole("heading", { name: en.reviewWorkflow.resultSaved }); expect(screen.getByText(en.profile.statusValue.returned)).toBeTruthy();
    const writes = api.mock.calls.filter(([, init]) => init?.method === "POST"); expect(writes.map(([url]) => String(url))).toEqual([`${REVIEW_API}/open`, `${REVIEW_API}/submit-result`]);
    expect(api.mock.calls.some(([url]) => String(url).includes("/notifications") || String(url).includes("/mail"))).toBe(false);
  });
  it("result requires saved server decisions and clean drafts and submits once with server publication outcome", async () => {
    const fixture = reviewFixture(); fixture.workbench.canSubmitResult = true;
    fixture.workbench.sections.forEach((section, index) => { section.decision = { id: uuid(1700 + index), outcome: "verified", comment: null, decidedAt: REVIEW_NEW_TIME }; section.items.forEach(item => { item.decision = section.decision; }); });
    const api = stubReview("expert", { [`POST ${REVIEW_API}/submit-result`]: { body: { profileId: REVIEW_PROFILE, assignmentId: REVIEW_ID, profileStatus: "verified", closedAt: REVIEW_NEW_TIME, publishKinds: ["products"], retainKinds: ["main_information"] } } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); const panel = within(active(en.profileEditor.sections.main_information));
    await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Demo unsaved");
    expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(true);
    await user.clear(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }));
    await waitFor(() => expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(false));
    await user.click(screen.getByRole("button", { name: en.reviewWorkflow.submitResult })); await user.click((await within(await screen.findByRole("dialog")).findByRole("button", { name: en.reviewWorkflow.confirmResult })));
    await screen.findByRole("heading", { name: en.reviewWorkflow.resultSaved }); expect(api.mock.calls.filter(([url]) => String(url).endsWith("/submit-result"))).toHaveLength(1);
    expect(screen.queryByRole("button", { name: en.reviewWorkflow.submitResult })).toBeNull();
  });
  it("subject keys use exact row/version identity rather than a stable identity or display name", () => {
    expect(reviewSubjectKey({ kind: "document", documentId: uuid(1) })).not.toBe(reviewSubjectKey({ kind: "document", documentId: uuid(2) }));
  });
  it("failed opening does not read submitted sections and retries only explicitly", async () => {
    let fail = true; const busy = problem(409, "assignment_changed") as (url: URL) => Response, fixture = reviewFixture();
    const api = stubReview("expert", { [`POST ${REVIEW_API}/open`]: url => fail ? busy(url) : Response.json(fixture.workbench) }, fixture);
    const { user } = mount(); await screen.findByText(en.reviewWorkflow.errors.changed);
    expect(api.mock.calls.filter(([url]) => String(url).includes("/sections/"))).toHaveLength(0);
    fail = false; await user.click(screen.getByRole("button", { name: en.common.retry })); await screen.findByText("Demo submitted factory address");
    expect(api.mock.calls.filter(([url]) => String(url).endsWith("/open"))).toHaveLength(2);
  });
  it("dirty navigation offers Stay and keeps the section comment", async () => {
    stubReview(); const { user } = mount(); await screen.findByText("Demo submitted factory address");
    const panel = within(active(en.profileEditor.sections.main_information)); await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Demo retained navigation draft");
    await user.click(screen.getByRole("link", { name: en.reviewWorkflow.backToQueue })); const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: en.profileEditor.stay }));
    expect((panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }) as HTMLTextAreaElement).value).toBe("Demo retained navigation draft");
    expect(screen.queryByRole("heading", { name: "Demo queue" })).toBeNull();
  });
  it("a missing captured photo never falls back to another version or enables verification", async () => {
    const fixture = reviewFixture(), production = fixture.sections.production; if (production.kind !== "production") throw new Error();
    production.data.editable.equipment[0]!.photoId = uuid(1800); production.data.equipmentPhotos[0] = null;
    stubReview("expert", {}, fixture); const { user } = mount(); await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: /^Production ·/ }));
    const panel = within(active(en.profileEditor.sections.production)); expect(panel.queryByRole("link")).toBeNull();
    await user.click(panel.getByRole("combobox", { name: en.reviewWorkflow.sectionOutcome })); expect((await screen.findByRole("option", { name: en.reviewWorkflow.outcome.verified })).getAttribute("aria-disabled")).toBe("true");
  });
  it.each([{ status: 403, code: "forbidden" }, { status: 409, code: "assignment_changed" }])("terminal $code blocks every section/result until explicit authority reload and preserves the draft", async ({ status, code }) => {
    const fixture = reviewFixture(); let denied = false;
    const refusal = problem(status, code) as (url: URL) => Response;
    const api = stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: url => { denied = true; return refusal(url); },
      [`GET ${REVIEW_API}`]: url => denied ? refusal(url) : Response.json(fixture.workbench) }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); const panel = within(active(en.profileEditor.sections.main_information));
    await choose(user, panel, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.verified);
    const comment = panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }) as HTMLTextAreaElement;
    await user.type(comment, "Retain intent after terminal scope change"); await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }));
    await panel.findByText(code === "forbidden" ? en.reviewWorkflow.errors.forbidden : en.reviewWorkflow.errors.changed);
    expect(comment.value).toBe("Retain intent after terminal scope change"); expect(comment.disabled).toBe(true);
    expect(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }).hasAttribute("disabled")).toBe(true);
    expect(panel.getByRole("button", { name: en.reviewWorkflow.reload })).toBeTruthy();
    expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: /^Production ·/ })); const production = within(active(en.profileEditor.sections.production));
    expect(production.getByRole("combobox", { name: en.reviewWorkflow.sectionOutcome }).hasAttribute("disabled")).toBe(true);
    expect(production.getByRole("button", { name: en.reviewWorkflow.saveDecision }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: /^Main information ·/ })); await user.click(panel.getByRole("button", { name: en.reviewWorkflow.reload }));
    await waitFor(() => expect(screen.queryByText("Demo submitted factory address")).toBeNull());
    expect(comment.value).toBe("Retain intent after terminal scope change");
    expect(within(screen.getByRole("region", { name: en.reviewWorkflow.reload })).getByRole("button", { name: en.reviewWorkflow.reload })).toBeTruthy();
    expect(api.mock.calls.filter(([url]) => String(url).endsWith("/section-decision"))).toHaveLength(1);
    expect(api.mock.calls.some(([url]) => String(url).endsWith("/submit-result"))).toBe(false);
  });
  it("fresh authority proof can re-enable actions while keeping the exact dirty section intent", async () => {
    const fixture = reviewFixture(); let changed = false;
    const api = stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: problem(403, "forbidden"), [`GET ${REVIEW_API}`]: () => {
      if (changed) fixture.workbench.sections[0]!.decision = { id: uuid(1900), outcome: "rejected", comment: "Demo current saved decision", decidedAt: REVIEW_NEW_TIME };
      return Response.json(fixture.workbench);
    } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); const panel = within(active(en.profileEditor.sections.main_information));
    await choose(user, panel, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.verified); await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Demo retained authorized intent");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await panel.findByText(en.reviewWorkflow.errors.forbidden);
    changed = true; await user.click(panel.getByRole("button", { name: en.reviewWorkflow.reload })); await panel.findByText(en.reviewWorkflow.rebased);
    expect((panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }) as HTMLTextAreaElement).value).toBe("Demo retained authorized intent");
    expect(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: /^Production ·/ })); expect(within(active(en.profileEditor.sections.production)).getByRole("combobox", { name: en.reviewWorkflow.sectionOutcome }).hasAttribute("disabled")).toBe(false);
    expect(api.mock.calls.filter(([url]) => String(url).endsWith("/section-decision"))).toHaveLength(1);
  });
  it("final-result authority refusal closes confirmation and blocks every assignment mutation", async () => {
    const fixture = reviewFixture(); fixture.workbench.canSubmitResult = true;
    fixture.workbench.sections.forEach((section, index) => { section.decision = { id: uuid(1920 + index), outcome: "verified", comment: null, decidedAt: REVIEW_NEW_TIME }; section.items.forEach(item => { item.decision = section.decision; }); });
    const api = stubReview("expert", { [`POST ${REVIEW_API}/submit-result`]: problem(403, "forbidden") }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); await user.click(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: en.reviewWorkflow.confirmResult }));
    const barrier = within(await screen.findByRole("region", { name: en.reviewWorkflow.reload })); await barrier.findByText(en.reviewWorkflow.errors.forbidden);
    expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(true);
    expect(within(active(en.profileEditor.sections.main_information)).getByRole("textbox", { name: en.reviewWorkflow.sectionComment }).hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("heading", { name: en.reviewWorkflow.resultSaved })).toBeNull();
    expect(api.mock.calls.filter(([url]) => String(url).endsWith("/submit-result"))).toHaveLength(1);
  });
  it("a fresh response for another assigned expert never restores authority", async () => {
    const fixture = reviewFixture(); let denied = false;
    const api = stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: url => { denied = true; return (problem(403, "forbidden") as (url: URL) => Response)(url); },
      [`GET ${REVIEW_API}`]: () => Response.json(denied ? { ...fixture.workbench, assignment: { ...fixture.workbench.assignment, expertId: uuid(1950) } } : fixture.workbench) }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); const panel = within(active(en.profileEditor.sections.main_information));
    await choose(user, panel, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.verified); await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Demo own intent");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await panel.findByText(en.reviewWorkflow.errors.forbidden);
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.reload })); await waitFor(() => expect(screen.queryByText("Demo submitted factory address")).toBeNull());
    expect(screen.getByRole("button", { name: en.reviewWorkflow.submitResult }).hasAttribute("disabled")).toBe(true);
    expect(api.mock.calls.filter(([url]) => String(url).endsWith("/section-decision"))).toHaveLength(1);
  });
  it("lost save response keeps intent then resolves the exact server decision without duplicate acceptance", async () => {
    const fixture = reviewFixture(); let first = true; const bodies: ReviewSectionDecisionInput[] = [];
    stubReview("expert", { [`POST ${REVIEW_API}/section-decision`]: async (url, init) => {
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      if (first) { first = false; fixture.workbench.sections[0]!.decision = { id: uuid(1940), outcome: body.outcome, comment: body.comment, decidedAt: REVIEW_NEW_TIME }; throw new TypeError("synthetic lost response"); }
      return (problem(409, "review_section_changed") as (url: URL) => Response)(url);
    } }, fixture);
    const { user } = mount(); await screen.findByText("Demo submitted factory address"); const panel = within(active(en.profileEditor.sections.main_information));
    await choose(user, panel, en.reviewWorkflow.sectionOutcome, en.reviewWorkflow.outcome.verified); await user.type(panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }), "Exact lost response intent");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await panel.findByText(en.reviewWorkflow.errors.internal);
    expect((panel.getByRole("textbox", { name: en.reviewWorkflow.sectionComment }) as HTMLTextAreaElement).value).toBe("Exact lost response intent");
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision })); await panel.findByText(en.reviewWorkflow.errors.changed);
    await user.click(panel.getByRole("button", { name: en.reviewWorkflow.reload })); await panel.findByText(en.reviewWorkflow.rebased);
    expect(bodies).toHaveLength(2); expect(panel.getByRole("button", { name: en.reviewWorkflow.saveDecision }).hasAttribute("disabled")).toBe(true);
  });
});

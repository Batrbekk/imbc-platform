import { ROLES } from "@imbc/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewQueuePage } from "@/features/reviews/queue";
import { reviewParams, reviewQuery } from "@/features/reviews/params";
import { renderRoute } from "./support/render";
import { problem } from "./support/api";
import { REVIEW_API, REVIEW_EXPERT, REVIEW_ID, REVIEW_NAME, REVIEW_OTHER_EXPERT, REVIEW_QUEUE, reviewMetadata, stubReview } from "./support/review-workflow";
import en from "../messages/en.json";

const mount = (admin = false, entry = admin ? "/admin/reviews" : "/reviews") => renderRoute(entry, { locale: "en", routes: [{ path: "*", element: <ReviewQueuePage admin={admin} /> }] });
describe("review assignment UI and queue boundaries", () => {
  it.each(ROLES.filter(role => role !== "expert"))("%s does not issue operational review or private queries", async role => {
    const api = stubReview(role); mount(); await screen.findByText(en.reviewWorkflow.errors.forbidden);
    expect(api.mock.calls.filter(([url]) => String(url).startsWith("/api/v1/reviews"))).toHaveLength(0);
  });
  it.each(ROLES.filter(role => role !== "administrator"))("%s does not issue assignment projection queries", async role => {
    const api = stubReview(role); mount(true); await screen.findByText(en.reviewWorkflow.errors.forbidden);
    expect(api.mock.calls.some(([url]) => String(url).startsWith("/api/v1/reviews"))).toBe(false);
  });
  it("administrator sees only three metadata fields and a safe assignment endpoint", async () => {
    const api = stubReview("administrator"); mount(true); await screen.findByText(REVIEW_NAME);
    expect(screen.getAllByRole("columnheader")).toHaveLength(3); expect(screen.queryByText("000100000001")).toBeNull();
    expect(screen.queryByText("Nov 2, 2026")).toBeNull(); expect(screen.queryByRole("link")).toBeNull();
    await screen.findByRole("button", { name: en.reviewWorkflow.assign });
    expect(api.mock.calls.map(([url]) => String(url)).filter(url => url.includes("/api/v1/"))).toEqual(expect.arrayContaining(["/api/v1/reviews/assignment-queue?offset=0&limit=25", "/api/v1/reviews/experts"]));
    expect(api.mock.calls.some(([url]) => String(url).includes("/sections/") || String(url).includes("/due-diligence") || String(url).includes("/files/") || new URL(String(url), location.origin).pathname === "/api/v1/reviews/queue")).toBe(false);
  });
  it("keeps unresolved rows without invented received date or review actions", async () => {
    stubReview("expert", { "GET /api/v1/reviews/queue": { body: { ...REVIEW_QUEUE, items: [{ ...REVIEW_QUEUE.items[0], assignmentId: null, receivedAt: null, unresolved: true }] } } }); mount();
    await screen.findByText(en.reviewWorkflow.unresolved); const row = within(screen.getByText(REVIEW_NAME).closest("tr")!);
    expect(row.getByText(en.reviewWorkflow.receivedUnknown)).toBeTruthy(); expect(row.queryByRole("button", { name: en.reviewWorkflow.take })).toBeNull(); expect(row.queryByRole("link", { name: en.reviewWorkflow.openReview })).toBeNull();
    expect(row.queryByRole("link", { name: en.reviewWorkflow.openReview })).toBeNull();
    expect(row.queryByRole("link", { name: en.reviewWorkflow.openDiligence })).toBeNull();
    expect(row.getByRole("link", { name: en.siteSurvey.openSurveys }).getAttribute("href")).toBe(`/imbc/profiles/${REVIEW_QUEUE.items[0]!.profileId}/site-surveys`);
  });
  it("keeps an operational legacy row with an unknown BIN without fabricating one", async () => {
    stubReview("expert", { "GET /api/v1/reviews/queue": { body: { ...REVIEW_QUEUE, items: [{ ...REVIEW_QUEUE.items[0], bin: null }] } } }); mount();
    await screen.findByText(REVIEW_NAME); const row = within(screen.getByText(REVIEW_NAME).closest("tr")!);
    expect(row.getByText("—")).toBeTruthy(); expect(row.queryByText("000100000001")).toBeNull();
    expect(row.getByRole("button", { name: en.reviewWorkflow.take })).toBeTruthy(); expect(row.getByText("Nov 2, 2026")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("Take does not Open; the acknowledged assignee receives a separate Open link", async () => {
    let taken = false;
    const assigned = { ...REVIEW_QUEUE.items[0]!, assignedExpertId: REVIEW_EXPERT, assignedExpert: "Demo SME" };
    const api = stubReview("expert", { "GET /api/v1/reviews/queue": () => Response.json({ ...REVIEW_QUEUE, items: [taken ? assigned : REVIEW_QUEUE.items[0]] }),
      [`POST ${REVIEW_API}/take`]: () => { taken = true; return Response.json(reviewMetadata(assigned)); } });
    const { user } = mount(); await user.click(await screen.findByRole("button", { name: en.reviewWorkflow.take }));
    expect((await screen.findByRole("link", { name: en.reviewWorkflow.openReview })).getAttribute("href")).toBe(`/reviews/assignments/${REVIEW_ID}`);
    expect(api.mock.calls.some(([url]) => String(url) === `${REVIEW_API}/open`)).toBe(false);
  });
  it("admin stale assignment reload retains the selected expert and uses a fresh CAS token", async () => {
    let changed = false; const bodies: unknown[] = [];
    const metadata = reviewMetadata(REVIEW_QUEUE.items[0]!);
    const stale = problem(409, "assignment_changed") as (url: URL) => Response;
    stubReview("administrator", { [`POST ${REVIEW_API}/assign`]: (url, init) => { bodies.push(JSON.parse(String(init?.body))); if (!changed) return stale(url); return Response.json({ ...metadata, assignedExpertId: REVIEW_OTHER_EXPERT, assignedExpert: "Demo second SME" }); },
      [`GET /api/v1/reviews/assignment-queue/${REVIEW_ID}`]: () => { changed = true; return Response.json({ ...metadata, assignedExpertId: REVIEW_EXPERT, assignedExpert: "Demo SME" }); } });
    const { user } = mount(true); await user.click(await screen.findByRole("button", { name: en.reviewWorkflow.assign }));
    const dialog = await screen.findByRole("dialog"); await user.click(within(dialog).getByRole("combobox", { name: en.reviews.assignee })); await user.click(await screen.findByRole("option", { name: "Demo second SME" }));
    await user.click(within(dialog).getByRole("button", { name: en.reviewWorkflow.saveAssignment })); await within(dialog).findByText(en.reviewWorkflow.errors.changed);
    expect(within(dialog).getByRole("button", { name: en.reviewWorkflow.saveAssignment }).hasAttribute("disabled")).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: en.reviewWorkflow.reload })); await within(dialog).findByText("Current SME: Demo SME");
    expect(within(dialog).getByRole("combobox").textContent).toContain("Demo second SME");
    await user.click(within(dialog).getByRole("button", { name: en.reviewWorkflow.saveAssignment })); await waitFor(() => expect(bodies).toEqual([{ expertId: REVIEW_OTHER_EXPERT, expectedExpertId: null }, { expertId: REVIEW_OTHER_EXPERT, expectedExpertId: REVIEW_EXPERT }]));
  });
  it("preserves all URL filter dimensions and paging on back/forward", async () => {
    const entry = `/reviews?q=Demo&status=submitted,pending_changes&assignee=unassigned,${REVIEW_OTHER_EXPERT}&receivedFrom=2026-11-01&receivedTo=2026-11-16&offset=25&limit=25`;
    const api = stubReview("expert", { "GET /api/v1/reviews/queue": { body: { ...REVIEW_QUEUE, total: 70, offset: 25 } } }); const { router, user } = mount(false, entry);
    await screen.findByText(REVIEW_NAME); await user.click(screen.getByRole("button", { name: en.reviewWorkflow.next }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("offset")).toBe("50"));
    const requested = new URL(String(api.mock.calls.filter(([url]) => new URL(String(url), location.origin).pathname === "/api/v1/reviews/queue").at(-1)![0]), location.origin);
    expect(requested.searchParams.get("assignee")).toBe(`unassigned,${REVIEW_OTHER_EXPERT}`); expect(requested.searchParams.get("receivedFrom")).toBe("2026-11-01");
    await act(() => router.navigate(-1)); await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("offset")).toBe("25"));
  });
  it("drops admin date fields and rejects reversed dates or duplicated known keys", () => {
    expect(reviewQuery(reviewParams(new URLSearchParams("receivedFrom=2026-01-01&q=Demo"), true).value, true)).not.toContain("received");
    expect(reviewParams(new URLSearchParams("receivedFrom=2026-11-16&receivedTo=2026-11-01"), false).valid).toBe(false);
    expect(reviewParams(new URLSearchParams("status=submitted&status=under_review"), false).valid).toBe(false);
  });
});

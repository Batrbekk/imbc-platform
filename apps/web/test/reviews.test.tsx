import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import ru from "../messages/ru.json";
import kk from "../messages/kk.json";
import { problem } from "./support/api";
import { renderRoute } from "./support/render";
import { REVIEW_NAME, REVIEW_QUEUE, stubReview } from "./support/review-workflow";

const queueCalls = (api: ReturnType<typeof stubReview>) => api.mock.calls.map(([url]) => String(url)).filter(url => new URL(url, location.origin).pathname === "/api/v1/reviews/queue");
describe("SME operational review queue REV04", () => {
  it("shows four business columns, BIN, status, assignee and separate DD navigation", async () => {
    stubReview(); renderRoute("/reviews", { locale: "ru" });
    await screen.findByText(REVIEW_NAME);
    expect(document.title).toBe(`${ru.reviews.title} · ${ru.common.appName}`);
    expect(screen.getAllByRole("columnheader").map(header => header.textContent)).toEqual([ru.reviews.manufacturer, ru.reviews.status, ru.reviews.assignee, ru.reviewWorkflow.receivedAt]);
    const row = within(screen.getByText(REVIEW_NAME).closest("tr")!);
    expect(row.getByText("000100000001")).toBeTruthy(); expect(row.getByText(ru.profile.statusValue.submitted)).toBeTruthy(); expect(row.getByText(ru.reviews.unassigned)).toBeTruthy();
    expect(row.getByRole("button", { name: ru.reviewWorkflow.take })).toBeTruthy();
    expect(row.getByRole("link", { name: ru.reviewWorkflow.openDiligence }).getAttribute("href")).toBe(`/imbc/profiles/${REVIEW_QUEUE.items[0]!.profileId}/due-diligence`);
  });
  it("applies status URL changes and does not forward malformed filters", async () => {
    const api = stubReview(); const { router, user } = renderRoute("/reviews?status=submitted", { locale: "en" });
    await screen.findByText(REVIEW_NAME);
    await user.click(screen.getByText(en.reviews.statusFilter, { selector: "summary" }));
    await user.click(screen.getByRole("checkbox", { name: en.profile.statusValue.submitted }));
    await user.click(screen.getByRole("checkbox", { name: en.reviews.pendingChanges }));
    await user.click(screen.getByRole("button", { name: en.reviewWorkflow.applyFilters }));
    await waitFor(() => expect(new URLSearchParams(router.state.location.search).get("status")).toBe("pending_changes"));
    expect(new URL(queueCalls(api).at(-1)!, location.origin).searchParams.get("status")).toBe("pending_changes");
    await user.click(screen.getByRole("button", { name: en.reviewWorkflow.clearFilters }));
    await waitFor(() => expect(router.state.location.search).toBe("")); cleanup();
    const invalid = stubReview(); renderRoute("/reviews?status=draft", { locale: "en" });
    await screen.findByText(en.reviewWorkflow.invalidFilters); expect(queueCalls(invalid)).toHaveLength(0);
  });
  it("distinguishes empty results from failed reads and retries explicitly", async () => {
    stubReview("expert", { "GET /api/v1/reviews/queue": { body: { items: [], total: 0, offset: 0, limit: 25 } } }); renderRoute("/reviews", { locale: "kk" });
    await screen.findByText(kk.reviewWorkflow.empty); expect(screen.queryByText(kk.reviewWorkflow.errors.internal)).toBeNull(); cleanup();
    let fail = true; const unavailable = problem(503, "unavailable") as (url: URL) => Response;
    const api = stubReview("expert", { "GET /api/v1/reviews/queue": url => fail ? unavailable(url) : Response.json(REVIEW_QUEUE) }); const { user } = renderRoute("/reviews", { locale: "kk" });
    const alert = await screen.findByRole("alert"); expect(within(alert).getByText(kk.reviewWorkflow.errors.internal)).toBeTruthy(); expect(screen.queryByText(kk.reviewWorkflow.empty)).toBeNull();
    fail = false; await user.click(within(alert).getByRole("button", { name: kk.common.retry })); await screen.findByText(REVIEW_NAME); expect(queueCalls(api)).toHaveLength(2);
  });
  it("formats actual received date in Almaty instead of registration date", async () => {
    stubReview(); renderRoute("/reviews", { locale: "kk" }); await screen.findByText("02.11.2026"); expect(screen.queryByText("01.10.2026")).toBeNull(); cleanup();
    stubReview(); renderRoute("/reviews", { locale: "en" }); await screen.findByText("Nov 2, 2026");
  });
});

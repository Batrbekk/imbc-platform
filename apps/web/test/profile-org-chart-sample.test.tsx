import { orgChartSampleCurrentSchema, type Locale } from "@imbc/contracts";
import { focusManager } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProfileOrgChartSample } from "@/features/profile/org-chart-sample";
import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

const PATH = "/api/v1/org-chart-sample/current";
const CONTENT = "/api/v1/org-chart-sample/current/content";
const messages = { en, kk, ru };
const passed = orgChartSampleCurrentSchema.parse({ current: {
  originalName: "IMBC organisation chart.docx", byteSize: 2048,
  mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  uploadedAt: "2026-11-16T06:00:00.000Z",
} });
const renderSample = (locale: Locale = "en", readOnly = false) => renderRoute("/", { locale,
  routes: [{ path: "/", element: readOnly ? <form><fieldset disabled><ProfileOrgChartSample /></fieldset></form> : <ProfileOrgChartSample /> }],
});
afterEach(() => { focusManager.setFocused(undefined); });

describe("MAN-19/ADM-11 producer organisation-chart sample", () => {
  it.each(["en", "ru", "kk"] as const)("renders a current passed sample as a real BFF download link in %s", async (locale) => {
    const requests = stubApi({ [`GET ${PATH}`]: { body: passed } });
    renderSample(locale);
    const t = messages[locale].profileOrgChartSample;
    const link = await screen.findByRole("link", { name: t.download });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe(CONTENT);
    expect(link.getAttribute("role")).toBeNull();
    expect(link.hasAttribute("data-discover")).toBe(false);
    expect(screen.getByRole("heading", { name: t.title })).toBeTruthy();
    expect(screen.getByText(passed.current!.originalName)).toBeTruthy();
    expect(screen.getByText(t.hint)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(requests.mock.calls).toHaveLength(1);
    expect(requests.mock.calls[0]?.[0]).toBe(PATH);
    expect(requests.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
  });
  it("keeps current sample download available alongside a read-only producer form", async () => {
    stubApi({ [`GET ${PATH}`]: { body: passed } });
    renderSample("en", true);
    const link = await screen.findByRole("link", { name: en.profileOrgChartSample.download });
    expect(link.getAttribute("href")).toBe(CONTENT);
    expect(link.getAttribute("aria-disabled")).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
  it.each(["en", "ru", "kk"] as const)("shows unavailable without creating a download target when no passed current sample exists in %s", async (locale) => {
    const requests = stubApi({ [`GET ${PATH}`]: { body: { current: null } } });
    renderSample(locale);
    expect(await screen.findByText(messages[locale].profileOrgChartSample.unavailable)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(requests.mock.calls.every(([path]) => path === PATH)).toBe(true);
  });
  it.each(["pending", "rejected"] as const)("fails closed if a malformed BFF response tries to expose %s current scan metadata", async (scanState) => {
    const requests = stubApi({ [`GET ${PATH}`]: { body: { current: { ...passed.current, scanState, originalName: "Unapproved private sample.docx" } } } });
    renderSample();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", en.profileOrgChartSample.readError);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Unapproved private sample.docx")).toBeNull();
    expect(requests.mock.calls).toHaveLength(1);
  });
  it("rejects leaked administrator history and never requests the administrative sample endpoint", async () => {
    const requests = stubApi({ [`GET ${PATH}`]: { body: { ...passed, latest: { fileId: "private", originalName: "Historical private chart.pdf", scanState: "rejected" } } } });
    renderSample();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", en.profileOrgChartSample.readError);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(passed.current!.originalName)).toBeNull();
    expect(screen.queryByText("Historical private chart.pdf")).toBeNull();
    expect(requests.mock.calls.every(([path]) => path === PATH)).toBe(true);
  });
  it("waits for validated current metadata before displaying a download link", async () => {
    let resolve!: (response: Response) => void;
    const response = new Promise<Response>((done) => { resolve = done; });
    stubApi({ [`GET ${PATH}`]: () => response });
    renderSample();
    expect(screen.getByRole("status").textContent).toBe(en.profileOrgChartSample.loading);
    expect(screen.queryByRole("link")).toBeNull();
    await act(async () => { resolve(Response.json(passed)); });
    expect(await screen.findByRole("link", { name: en.profileOrgChartSample.download })).toBeTruthy();
  });
  it.each(["en", "ru", "kk"] as const)("retries a failed current read without exposing server details or administrator controls in %s", async (locale) => {
    let attempts = 0;
    const requests = stubApi({ [`GET ${PATH}`]: () => ++attempts === 1
      ? Response.json({ code: "storage_unavailable", title: "Private server detail.docx" }, { status: 503 })
      : Response.json(passed) });
    const { user } = renderSample(locale);
    const t = messages[locale].profileOrgChartSample;
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", t.readError);
    expect(screen.queryByText("Private server detail.docx")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: t.retry }));
    expect(await screen.findByRole("link", { name: t.download })).toBeTruthy();
    expect(attempts).toBe(2);
    expect(requests.mock.calls.every(([path, init]) => path === PATH && !init?.method)).toBe(true);
  });
  it("does not provide a download target after a BFF permission refusal", async () => {
    stubApi({ [`GET ${PATH}`]: { status: 403, body: { code: "forbidden", title: "Private sample blocked" } } });
    renderSample();
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", en.profileOrgChartSample.readError);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Private sample blocked")).toBeNull();
  });
  it("hides cached metadata during revalidation and removes the previous sample when the BFF reports no current sample", async () => {
    let attempts = 0; let resolve!: (response: Response) => void;
    const next = new Promise<Response>((done) => { resolve = done; });
    stubApi({ [`GET ${PATH}`]: () => ++attempts === 1 ? Response.json(passed) : next });
    renderSample();
    await screen.findByRole("link", { name: en.profileOrgChartSample.download });
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await waitFor(() => expect(attempts).toBe(2));
    expect(screen.getByRole("status").textContent).toBe(en.profileOrgChartSample.loading);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(passed.current!.originalName)).toBeNull();
    await act(async () => { resolve(Response.json({ current: null })); });
    await screen.findByText(en.profileOrgChartSample.unavailable);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(passed.current!.originalName)).toBeNull();
  });
});

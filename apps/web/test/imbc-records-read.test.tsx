import { screen, within, waitFor as waitForFixture } from "@testing-library/react";
import { Link } from "react-router";
import { ROLES, imbcRecordHistoryQuerySchema } from "@imbc/contracts";
import { describe, expect, it } from "vitest";
import { RecordsPage } from "@/features/imbc-records/page";
import { RecordsFailure } from "@/features/imbc-records/feedback";
import { recordsParams, recordsReturn } from "@/features/imbc-records/params";
import { readHistory, readContext, readNotes, selectedReferences } from "@/features/imbc-records/api";
import { ApiError } from "@/lib/api";
import { problem } from "./support/api";
import {
  ACTOR,
  BASE,
  CONTEXT,
  ENGAGEMENT,
  fixtures,
  messages,
  mount,
  NEXT,
  note,
  NOTE,
  NOTES,
  ORG,
  PRODUCT,
  PROFILE,
  reference,
  SOURCE,
  TIME,
  URL,
  uuid,
  engagement,
} from "./support/imbc-records";
describe("Class C IMBC record read surfaces", () => {
  it("history initial and cursor pages obey the actual strict query contract without a literal undefined cursor", async () => {
    const queries: globalThis.URLSearchParams[] = [],
      next = uuid(780);
    fixtures("expert", {
      [`GET ${NOTES}/${NOTE}/history`]: (url) => {
        const parsed = imbcRecordHistoryQuerySchema.safeParse(Object.fromEntries(url.searchParams));
        if (!parsed.success) return Response.json({ status: 400, code: "validation" }, { status: 400 });
        queries.push(url.searchParams);
        return Response.json({ items: [], nextCursor: null });
      },
    });
    await readHistory({ profileId: PROFILE, organizationId: ORG }, { kind: "note", id: NOTE });
    await readHistory({ profileId: PROFILE, organizationId: ORG }, { kind: "note", id: NOTE }, next);
    expect(queries[0]!.has("beforeId")).toBe(false);
    expect(queries[0]!.get("limit")).toBe("25");
    expect(queries[1]!.get("beforeId")).toBe(next);
    expect(queries[1]!.get("limit")).toBe("25");
  });
  it.each(["en", "ru", "kk"] as const)(
    "%s keeps a removed product context and history reachable through authoritative retained descriptors",
    async (locale) => {
      const old = uuid(760),
        row = {
          ...contextForTest(),
          productLineIdentityId: old,
          source: "migration",
          recordedBy: null,
          createdAt: TIME,
          updatedAt: TIME,
        };
      const descriptor = {
          context: row,
          product: {
            productLineIdentityId: old,
            nameEn: "Demo historical product",
            nameRu: "Демо историческая продукция",
            sectionRevisionId: uuid(761),
            isCurrent: false,
          },
        },
        endpoint = `${BASE}/imbc-records/context-products`,
        ctx = `${BASE}/products/${old}/imbc-context`;
      const api = fixtures("director", {
        [`GET ${BASE}/imbc-records/product-options`]: {
          body: {
            profileId: PROFILE,
            organizationId: ORG,
            sectionRevisionId: uuid(762),
            items: [],
            total: 0,
            offset: 0,
            limit: 25,
          },
        },
        [`GET ${endpoint}`]: {
          body: { profileId: PROFILE, organizationId: ORG, items: [descriptor], total: 1, offset: 0, limit: 25 },
        },
        [`GET ${ctx}`]: { body: row },
        [`GET ${ctx}/history`]: { body: { items: [], nextCursor: null } },
      });
      const { user } = mount(<RecordsPage profileId={PROFILE} />, locale, `${URL}?view=products`),
        name = locale === "en" ? "Demo historical product" : "Демо историческая продукция";
      const choice = await screen.findByRole("button", {
        name: messages[locale].recordedProduct.replace("{name}", name) + " " + messages[locale].productRemoved,
      });
      await user.click(choice);
      await screen.findByRole("heading", { name });
      expect(screen.getAllByText(messages[locale].productRemoved).length).toBeGreaterThan(0);
      expect(screen.queryByText(old)).toBeNull();
      expect(screen.queryByRole("button", { name: messages[locale].editProductContext })).toBeNull();
      await user.click(screen.getByRole("button", { name: messages[locale].history }));
      await screen.findByRole("dialog");
      expect(api.mock.calls.some(([url]) => String(url).startsWith(`${ctx}/history`))).toBe(true);
      expect(api.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
    },
  );
  it("an off-page retained deep link resolves exact metadata and can edit existing context without creating a new product", async () => {
    const old = uuid(770),
      row = { ...contextForTest(), productLineIdentityId: old },
      endpoint = `${BASE}/imbc-records/context-products`,
      ctx = `${BASE}/products/${old}/imbc-context`;
    const descriptor = {
      context: row,
      product: { productLineIdentityId: old, nameEn: null, nameRu: null, sectionRevisionId: null, isCurrent: false },
    };
    const writes: unknown[] = [],
      api = fixtures("expert", {
        [`GET ${endpoint}`]: (url) =>
          Response.json({
            profileId: PROFILE,
            organizationId: ORG,
            items: url.searchParams.has("ids") ? [descriptor] : [],
            total: url.searchParams.has("ids") ? 1 : 0,
            offset: 0,
            limit: url.searchParams.has("ids") ? 1 : 25,
          }),
        [`GET ${ctx}`]: { body: row },
        [`PUT ${ctx}`]: (_url, init) => {
          writes.push(JSON.parse(String(init?.body)));
          return Response.json({ ...row, programmeId: uuid(606), updatedAt: NEXT });
        },
      });
    const { user } = mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=products&product=${old}`);
    await screen.findByRole("heading", { name: messages.en.unnamedProduct });
    expect(api.mock.calls.some(([url]) => String(url) === `${endpoint}?ids=${old}`)).toBe(true);
    await user.click(await screen.findByRole("button", { name: messages.en.editProductContext }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(await dialog.findByRole("checkbox", { name: "Demo LC" }));
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await waitForFixture(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ programmeId: uuid(606), priorityId: null, expectedUpdatedAt: TIME });
    expect(
      api.mock.calls.some(([url, init]) => String(url).includes("/product-options") && init?.method === "POST"),
    ).toBe(false);
  });
  it.each(ROLES)("%s uses only its permitted private record surface", async (role) => {
    const api = fixtures(role);
    mount(<RecordsPage profileId={PROFILE} />);
    if (role === "expert" || role === "director") {
      await screen.findByText("Demo historical note");
      expect(!!screen.queryByRole("button", { name: messages.en.editNote })).toBe(role === "expert");
      expect(!!screen.queryByRole("button", { name: messages.en.newNote })).toBe(role === "expert");
    } else {
      await screen.findByText(messages.en.errors.forbidden);
      expect(api.mock.calls.some(([url]) => String(url).startsWith(BASE))).toBe(false);
    }
    expect(
      api.mock.calls.some(([url]) =>
        /catalog\/companies|due-diligence|own\/sections|\/files(?:\/|$)|dictionaries/.test(String(url)),
      ),
    ).toBe(false);
    expect(api.mock.calls.some(([, init]) => !!init?.method && init.method !== "GET")).toBe(false);
  });
  it.each(["en", "ru", "kk"] as const)(
    "%s renders director nullable interactions without edit controls or fabricated defaults",
    async (locale) => {
      const api = fixtures("director");
      const { user } = mount(<RecordsPage profileId={PROFILE} />, locale, `${URL}?view=engagement`);
      await screen.findByText(messages[locale].historicalEoiDates);
      expect(screen.getAllByText(messages[locale].unknown).length).toBeGreaterThan(2);
      expect(screen.queryByRole("button", { name: messages[locale].editEngagement })).toBeNull();
      await user.click(screen.getByRole("tab", { name: messages[locale].products }));
      const selected = await screen.findByRole("button", {
        name: locale === "en" ? "Demo current product" : "Демо текущая продукция",
      });
      await user.click(selected);
      await screen.findByText(messages[locale].programme);
      expect(screen.queryByRole("button", { name: messages[locale].editProductContext })).toBeNull();
      expect(api.mock.calls.some(([, init]) => init?.method === "PUT" || init?.method === "POST")).toBe(false);
      expect(screen.queryByText(ACTOR)).toBeNull();
      expect(screen.queryByText(PRODUCT)).toBeNull();
    },
  );
  it.each([403, 404, 503] as const)(
    "a %s interaction read is an error rather than a nullable first-create record",
    async (status) => {
      fixtures("expert", {
        [`GET ${ENGAGEMENT}`]: problem(status, status === 403 ? "forbidden" : status === 404 ? "not_found" : "busy"),
      });
      mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=engagement`);
      await screen.findAllByText(
        messages.en.errors[status === 403 ? "forbidden" : status === 404 ? "notFound" : "busy"],
      );
      expect(screen.queryByText(messages.en.noEngagement)).toBeNull();
      expect(screen.queryByRole("button", { name: messages.en.editEngagement })).toBeNull();
    },
  );
  it("full historical note values are only opened on demand, keeping original kind/source/author and before/after text", async () => {
    const before = note({ body: "Demo old full history text", authorName: "Demo original author" }),
      after = note({ body: "Demo corrected full history text", authorName: "Demo original author", updatedAt: NEXT });
    const api = fixtures("director", {
      [`GET ${NOTES}/${NOTE}/history`]: {
        body: {
          items: [
            {
              id: uuid(700),
              at: NEXT,
              action: "imbc_note.updated",
              actorId: ACTOR,
              actorName: "Demo correcting SME",
              before,
              after,
            },
          ],
          nextCursor: null,
        },
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />);
    await screen.findByText("Demo historical note");
    expect(api.mock.calls.some(([url]) => String(url).includes("/history"))).toBe(false);
    await user.click(screen.getByRole("button", { name: messages.en.history }));
    const dialog = within(await screen.findByRole("dialog"));
    await dialog.findByText(/Demo correcting SME/);
    expect(dialog.queryByText("Demo old full history text")).toBeNull();
    await user.click(dialog.getByText(/Demo correcting SME/));
    await dialog.findByText("Demo old full history text");
    expect(dialog.getByText("Demo corrected full history text")).toBeTruthy();
    expect(dialog.getAllByText("Demo original author")).toHaveLength(2);
    expect(dialog.getAllByText(messages.en.noteKinds.migration_context)).toHaveLength(2);
    expect(dialog.getAllByText(messages.en.sources.migration)).toHaveLength(2);
    expect(dialog.queryByText(NOTE)).toBeNull();
  });
  it("historical source lookup includes retired selected metadata without acquiring the entire dictionary", async () => {
    const row = engagement({ sourceEntryIds: [SOURCE] }),
      source = reference(SOURCE, "legacy_source", true);
    const api = fixtures("director", {
      [`GET ${ENGAGEMENT}`]: { body: row },
      [`GET ${BASE}/imbc-records/reference-options/acquisition_source`]: (url) => {
        expect(url.searchParams.get("ids")).toBe(SOURCE);
        expect(url.searchParams.has("offset")).toBe(false);
        return Response.json({ dictionaryCode: "acquisition_source", items: [source], offset: 0, limit: 1, total: 1 });
      },
    });
    mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=engagement`);
    await screen.findByText("Demo legacy_source");
    expect(screen.getByText(messages.en.retired)).toBeTruthy();
    expect(api.mock.calls.some(([url]) => String(url).includes("/dictionaries"))).toBe(false);
  });
  it("canonical product paging keeps stable identities and never requests a forged or off-page product context", async () => {
    const api = fixtures("expert", {
      [`GET ${BASE}/imbc-records/product-options`]: (url) => {
        const offset = Number(url.searchParams.get("offset"));
        return Response.json({
          profileId: PROFILE,
          organizationId: ORG,
          sectionRevisionId: uuid(610),
          items: [
            {
              productLineIdentityId: offset ? uuid(710) : PRODUCT,
              nameEn: offset ? "Demo page two product" : "Demo current product",
              nameRu: null,
            },
          ],
          total: 26,
          offset,
          limit: 25,
        });
      },
    });
    const { user, router } = mount(
      <RecordsPage profileId={PROFILE} />,
      "en",
      `${URL}?view=products&product=${uuid(999)}`,
    );
    await screen.findByText("Demo current product");
    expect(api.mock.calls.some(([url]) => String(url).includes("/imbc-context"))).toBe(false);
    const page = within(screen.getByRole("navigation", { name: messages.en.currentProductPagination }));
    await user.click(page.getByRole("button", { name: messages.en.next }));
    await screen.findByText("Demo page two product");
    expect(router.state.location.search).toContain("productOffset=25");
    expect(router.state.location.search).not.toContain("product=");
    expect(api.mock.calls.some(([url]) => String(url).includes("/imbc-context"))).toBe(false);
  });
  it("note paging has matching bounded offset/limit and replaces the page while preserving the active view", async () => {
    const api = fixtures("director", {
      [`GET ${NOTES}`]: (url) => {
        const offset = Number(url.searchParams.get("offset"));
        return Response.json({
          profileId: PROFILE,
          organizationId: ORG,
          organizationName: "Demo internal manufacturer",
          canEdit: false,
          items: [note({ id: offset ? uuid(720) : NOTE, body: offset ? "Demo second page" : "Demo first page" })],
          total: 26,
          offset,
          limit: 25,
        });
      },
    });
    const { user, router } = mount(<RecordsPage profileId={PROFILE} />);
    await screen.findByText("Demo first page");
    await user.click(screen.getByRole("button", { name: messages.en.next }));
    await screen.findByText("Demo second page");
    expect(screen.queryByText("Demo first page")).toBeNull();
    expect(router.state.location.search).toContain("noteOffset=25");
    expect(api.mock.calls.some(([url]) => String(url) === `${NOTES}?offset=25&limit=25`)).toBe(true);
  });
  it.each([
    "/reviews?q=Demo&status=submitted&offset=25&limit=25",
    "/imbc/site-survey-requests?offset=50&limit=50",
    `/companies/${PROFILE}`,
  ])("safe origin %s is retained after changing tabs", async (origin) => {
    fixtures();
    const { user, router } = mount(<RecordsPage profileId={PROFILE} />, "en", "/entry", [
      {
        path: "/entry",
        element: (
          <Link to={URL} state={{ from: origin }}>
            Demo entry
          </Link>
        ),
      },
    ]);
    await user.click(screen.getByRole("link", { name: "Demo entry" }));
    await screen.findByText("Demo historical note");
    await user.click(screen.getByRole("tab", { name: messages.en.engagement }));
    await screen.findByText(messages.en.historicalEoiDates);
    const back = screen.getByRole("link", {
      name: messages.en[
        origin.startsWith("/reviews") ? "backToQueue" : origin.startsWith("/imbc") ? "backToRequests" : "backToCompany"
      ],
    });
    expect(back.getAttribute("href")).toBe(origin);
    await user.click(back);
    expect(router.state.location.pathname + router.state.location.search).toBe(origin);
  });
});
describe("IMBC records boundaries and source fidelity", () => {
  it.each([
    "view=other",
    "view=notes&view=products",
    "product=not-uuid",
    "productOffset=-1",
    "noteOffset=1000001",
    "unknown=true",
  ])("rejects invalid page parameters %s", (query) => {
    expect(recordsParams(new URLSearchParams(query)).valid).toBe(false);
  });
  it.each([
    "https://external.local/reviews",
    "//evil.local",
    "/reviews#fragment",
    "/reviews?unknown=x",
    `/companies/${uuid(999)}`,
    "/reviews?q=one&q=two",
    "/admin/reviews",
  ])("unsafe origin %s falls back to permitted staff navigation", (origin) => {
    expect(recordsReturn(origin, PROFILE, true).to).toBe("/reviews");
    expect(recordsReturn(origin, PROFILE, false).to).toBe("/catalog");
  });
  it("rejects cross-profile/org record responses before they can be displayed or replayed", async () => {
    fixtures("expert", {
      [`GET ${NOTES}`]: {
        body: {
          profileId: PROFILE,
          organizationId: ORG,
          organizationName: "Demo allowed metadata",
          canEdit: true,
          items: [note({ profileId: uuid(740) })],
          total: 1,
          offset: 0,
          limit: 25,
        },
      },
      [`GET ${CONTEXT}`]: { body: { ...contextForTest(), productLineIdentityId: uuid(741) } },
    });
    await expect(readNotes(PROFILE, 0, 25)).rejects.toMatchObject({ status: 404 });
    await expect(readContext({ profileId: PROFILE, organizationId: ORG }, PRODUCT)).rejects.toMatchObject({
      status: 404,
    });
  });
  it("rejects duplicated selected metadata and a foreign history subject rather than leaking a partial graph", async () => {
    const wrong = note({ id: uuid(750), updatedAt: NEXT });
    fixtures("expert", {
      [`GET ${BASE}/imbc-records/reference-options/acquisition_source`]: {
        body: {
          dictionaryCode: "acquisition_source",
          items: [reference(SOURCE, "a"), reference(SOURCE, "a")],
          total: 2,
          offset: 0,
          limit: 2,
        },
      },
      [`GET ${NOTES}/${NOTE}/history`]: {
        body: {
          items: [
            {
              id: uuid(751),
              at: NEXT,
              action: "imbc_note.created",
              actorId: ACTOR,
              actorName: null,
              before: null,
              after: wrong,
            },
          ],
          nextCursor: null,
        },
      },
    });
    await expect(selectedReferences(PROFILE, "acquisition_source", [SOURCE, uuid(752)])).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      readHistory({ profileId: PROFILE, organizationId: ORG }, { kind: "note", id: NOTE }),
    ).rejects.toMatchObject({ status: 404 });
  });
  it.each(["reference_invalid", "history_retained", "busy", "conflict"] as const)(
    "shows a distinct safe problem for %s",
    (code) => {
      fixtures();
      mount(<RecordsFailure error={new ApiError(code === "busy" ? 503 : code === "conflict" ? 409 : 400, code, "")} />);
      expect(
        screen.getByText(
          messages.en.errors[
            code === "reference_invalid"
              ? "reference"
              : code === "history_retained"
                ? "historyRetained"
                : code === "conflict"
                  ? "changed"
                  : "busy"
          ],
        ),
      ).toBeTruthy();
    },
  );
});
function contextForTest() {
  return {
    productLineIdentityId: PRODUCT,
    profileId: PROFILE,
    organizationId: ORG,
    programmeId: null,
    priorityId: null,
    source: "expert",
    recordedBy: ACTOR,
    recordedByName: null,
    createdAt: TIME,
    updatedAt: TIME,
  };
}

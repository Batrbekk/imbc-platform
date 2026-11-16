import { screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, afterEach, vi } from "vitest";
import { focusManager } from "@tanstack/react-query";
import type { ImbcEngagementPut, ImbcNoteUpdate, ImbcProductContextPut } from "@imbc/contracts";
import { RecordsPage } from "@/features/imbc-records/page";
import { problem } from "./support/api";
import { me as fixtureMe } from "./support/survey";
import { renderRoute } from "./support/render";
import {
  ACTOR,
  BASE,
  CONTEXT,
  ENGAGEMENT,
  EVENT,
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
  PROGRAMME,
  PRIORITY,
  reference,
  TIME,
  URL,
  uuid,
  engagement,
  context,
} from "./support/imbc-records";
const disabled = (el: HTMLElement) => el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true";
afterEach(() => {
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
});
async function noteEditor(user: ReturnType<typeof mount>["user"]) {
  await screen.findByText("Demo historical note");
  await user.click(screen.getByRole("button", { name: messages.en.editNote }));
  return within(await screen.findByRole("dialog"));
}
describe("Internal record save intent and authoritative scope", () => {
  it.each(["page", "mounted-app"] as const)(
    "background stale session503 keeps a hidden dirty draft in %s until explicit current-scope recovery",
    async (mode) => {
      let fail = false,
        failed = 0,
        successes = 0,
        writes = 0;
      fixtures("expert", {
        "GET /api/auth/me": () => {
          if (fail) {
            failed++;
            return Response.json({ status: 503, code: "busy" }, { status: 503 });
          }
          successes++;
          const me = fixtureMe("expert");
          me.user.id = ACTOR;
          return Response.json(me);
        },
        [`PUT ${NOTES}/${NOTE}`]: () => {
          writes++;
          return Response.json(note());
        },
      });
      const { user } =
        mode === "page" ? mount(<RecordsPage profileId={PROFILE} />) : renderRoute(URL, { locale: "en" });
      const dialog = await noteEditor(user);
      await user.clear(dialog.getByRole("textbox"));
      await user.type(dialog.getByRole("textbox"), "Demo dirty draft survives background outage");
      fail = true;
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(failed).toBeGreaterThan(0));
      await dialog.findByText(messages.en.authorityBlocked);
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(dialog.queryByRole("textbox")).toBeNull();
      expect(document.body.textContent).not.toContain("Demo historical note");
      expect(document.body.textContent).not.toContain("Demo dirty draft survives background outage");
      expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(true);
      await user.click(dialog.getByRole("button", { name: messages.en.save }));
      expect(writes).toBe(0);
      const previous = successes;
      fail = false;
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await waitFor(() => expect(successes).toBeGreaterThan(previous));
      // Fresh identity alone does not prove the current private record permission.
      expect(dialog.queryByRole("textbox")).toBeNull();
      await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
      await dialog.findByText(messages.en.rebased);
      expect((dialog.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "Demo dirty draft survives background outage",
      );
      expect(writes).toBe(0);
    },
  );
  it("background network outage keeps the mounted app draft but current scope denial cannot restore stale edit authority", async () => {
    let fail = false,
      scopeAllowed = true,
      failed = 0,
      writes = 0;
    fixtures("expert", {
      "GET /api/auth/me": () => {
        if (fail) {
          failed++;
          throw new TypeError("Demo unavailable session transport");
        }
        const me = fixtureMe("expert");
        me.user.id = ACTOR;
        return Response.json(me);
      },
      [`GET ${NOTES}`]: () =>
        Response.json({
          profileId: PROFILE,
          organizationId: ORG,
          organizationName: "Demo private company",
          canEdit: scopeAllowed,
          items: [note()],
          total: 1,
          offset: 0,
          limit: 25,
        }),
      [`PUT ${NOTES}/${NOTE}`]: () => {
        writes++;
        return Response.json(note());
      },
    });
    const { user } = renderRoute(URL, { locale: "en" }),
      dialog = await noteEditor(user);
    await user.type(dialog.getByRole("textbox"), " retained during network failure");
    fail = true;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(failed).toBeGreaterThan(0));
    await dialog.findByText(messages.en.authorityBlocked);
    fail = false;
    scopeAllowed = false;
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.errors.forbidden);
    expect(dialog.queryByRole("textbox")).toBeNull();
    expect(writes).toBe(0);
    scopeAllowed = true;
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.rebased);
    expect((dialog.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Demo historical note retained during network failure",
    );
    expect(writes).toBe(0);
  });
  it("a write accepted in flight cannot repopulate Class C after a background session barrier", async () => {
    let fail = false,
      failed = 0,
      writes = 0,
      stored = note(),
      finish!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    fixtures("expert", {
      "GET /api/auth/me": () => {
        if (fail) {
          failed++;
          return Response.json({ status: 503, code: "busy" }, { status: 503 });
        }
        const me = fixtureMe("expert");
        me.user.id = ACTOR;
        return Response.json(me);
      },
      [`GET ${NOTES}`]: () =>
        Response.json({
          profileId: PROFILE,
          organizationId: ORG,
          organizationName: "Demo private company",
          canEdit: true,
          items: [stored],
          total: 1,
          offset: 0,
          limit: 25,
        }),
      [`PUT ${NOTES}/${NOTE}`]: () => {
        writes++;
        return response;
      },
    });
    const { user } = renderRoute(URL, { locale: "en" }),
      dialog = await noteEditor(user);
    await user.clear(dialog.getByRole("textbox"));
    await user.type(dialog.getByRole("textbox"), "Demo accepted while session probe is unavailable");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await waitFor(() => expect(writes).toBe(1));
    fail = true;
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(failed).toBeGreaterThan(0));
    await dialog.findByText(messages.en.authorityBlocked);
    stored = note({ body: "Demo accepted while session probe is unavailable", updatedAt: NEXT });
    await act(async () => {
      finish(Response.json(stored));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.textContent).not.toContain(stored.body);
    expect(document.body.textContent).not.toContain("Demo private company");
    expect(screen.queryByRole("button", { name: messages.en.newNote })).toBeNull();
    expect(writes).toBe(1);
    fail = false;
    await user.click(screen.getByRole("button", { name: messages.en.retry }));
    expect(
      await within(await screen.findByRole("tabpanel", { name: messages.en.notes })).findByText(stored.body),
    ).toBeTruthy();
    expect(writes).toBe(1);
  });
  it("a temporary actor probe failure preserves the blocked dirty editor and an explicit later recovery restores its draft", async () => {
    let phase = "initial";
    const forbidden = problem(403, "forbidden") as (url: globalThis.URL) => Response,
      unavailable = problem(503, "busy") as (url: globalThis.URL) => Response;
    fixtures("expert", {
      "GET /api/auth/me": (url) => {
        if (phase === "blocked") {
          phase = "retry";
          return unavailable(url);
        }
        const me = fixtureMe("expert");
        me.user.id = ACTOR;
        return Response.json(me);
      },
      [`PUT ${NOTES}/${NOTE}`]: (url) => {
        phase = "blocked";
        return forbidden(url);
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />),
      dialog = await noteEditor(user);
    await user.type(dialog.getByRole("textbox"), " Demo retained after actor outage");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await dialog.findByText(messages.en.authorityBlocked);
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.errors.busy);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(dialog.queryByRole("textbox")).toBeNull();
    expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(true);
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.rebased);
    expect((dialog.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Demo historical note Demo retained after actor outage",
    );
  });
  it("an unknown interaction save retries its canonically parsed folder link with the same operation key", async () => {
    const writes: { body: ImbcEngagementPut; key: string }[] = [];
    fixtures("expert", {
      [`PUT ${ENGAGEMENT}`]: (_url, init) => {
        const body = JSON.parse(String(init?.body));
        writes.push({ body, key: (init!.headers as Record<string, string>)["Idempotency-Key"]! });
        if (writes.length === 1) throw new TypeError("Demo acknowledgement lost");
        return Response.json(engagement({ folderUrl: body.folderUrl, updatedAt: NEXT }));
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=engagement`);
    await screen.findByText(messages.en.historicalEoiDates);
    await user.click(screen.getByRole("button", { name: messages.en.editEngagement }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.type(dialog.getByRole("textbox", { name: messages.en.folderUrl }), "https://EXAMPLE.com:443/folder");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await dialog.findByText(messages.en.retryExactIntent);
    expect(disabled(dialog.getByRole("textbox", { name: messages.en.folderUrl }))).toBe(true);
    await user.click(dialog.getByRole("button", { name: messages.en.retry }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]!.body.folderUrl).toBe("https://example.com/folder");
    expect(writes[1]).toEqual(writes[0]);
  });
  it("a new reference retired after picker loading explains the disabled save and can be removed without losing other fields", async () => {
    const row = reference(PROGRAMME, "LC");
    fixtures("expert", {
      [`GET ${CONTEXT}`]: { body: null },
      [`GET ${BASE}/imbc-records/reference-options/programme`]: (url) =>
        Response.json({
          dictionaryCode: "programme",
          items: [url.searchParams.has("ids") ? { ...row, retiredAt: TIME } : row],
          total: 1,
          offset: 0,
          limit: url.searchParams.has("ids") ? 1 : 25,
        }),
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=products&product=${PRODUCT}`);
    await screen.findByText(messages.en.noProductContext);
    await user.click(screen.getByRole("button", { name: messages.en.editProductContext }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(await dialog.findByRole("checkbox", { name: "Demo LC" }));
    await dialog.findByText(messages.en.errors.reference);
    expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(true);
    await user.click(dialog.getByRole("checkbox", { name: /Demo LC/ }));
    await user.click(dialog.getByRole("checkbox", { name: "Demo 1" }));
    await waitFor(() => expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(false));
    expect(dialog.queryByText(messages.en.errors.reference)).toBeNull();
  });
  it("an actor change during explicit authority recovery never transfers the old private draft or starts a stale write", async () => {
    let changed = false;
    const forbidden = problem(403, "forbidden") as (url: globalThis.URL) => Response;
    const api = fixtures("expert", {
      "GET /api/auth/me": () => {
        const me = fixtureMe("expert");
        me.user.id = changed ? uuid(780) : ACTOR;
        return Response.json(me);
      },
      [`PUT ${NOTES}/${NOTE}`]: (url) => {
        changed = true;
        return forbidden(url);
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />),
      dialog = await noteEditor(user);
    await user.type(dialog.getByRole("textbox"), " Demo private old-actor draft");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await dialog.findByText(messages.en.authorityBlocked);
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await screen.findByText("Demo historical note");
    expect(document.body.textContent).not.toContain("Demo private old-actor draft");
    expect(api.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
  it.each(["en", "ru", "kk"] as const)(
    "%s opens a localized note editor and restores keyboard focus after clean close",
    async (locale) => {
      fixtures();
      const { user } = mount(<RecordsPage profileId={PROFILE} />, locale);
      await screen.findByText("Demo historical note");
      const trigger = screen.getByRole("button", { name: messages[locale].newNote });
      await user.click(trigger);
      const dialog = within(await screen.findByRole("dialog"));
      expect(dialog.getByRole("textbox", { name: messages[locale].noteBody })).toBeTruthy();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(document.activeElement).toBe(trigger);
    },
  );
  it("preserves note provenance and rebases a one-microsecond CAS conflict only after explicit reload", async () => {
    let stale = false;
    const writes: { body: ImbcNoteUpdate; key: string }[] = [],
      conflict = problem(409, "conflict") as (url: globalThis.URL) => Response;
    fixtures("expert", {
      [`GET ${NOTES}/${NOTE}`]: () => Response.json(note(stale ? { updatedAt: NEXT, body: "Demo other editor" } : {})),
      [`PUT ${NOTES}/${NOTE}`]: (url, init) => {
        const body = JSON.parse(String(init?.body));
        writes.push({ body, key: (init!.headers as Record<string, string>)["Idempotency-Key"]! });
        if (!stale) {
          stale = true;
          return conflict(url);
        }
        return Response.json(note({ body: body.body, updatedAt: NEXT }));
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />),
      dialog = await noteEditor(user);
    await user.clear(dialog.getByRole("textbox"));
    await user.type(dialog.getByRole("textbox"), "Demo preserved draft");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await dialog.findByText(messages.en.errors.changed);
    expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(true);
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.rebased);
    expect((dialog.getByRole("textbox") as HTMLInputElement).value).toBe("Demo preserved draft");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((w) => w.body.expectedUpdatedAt)).toEqual([TIME, NEXT]);
    expect(writes[1]!.key).not.toBe(writes[0]!.key);
    expect(Object.keys(writes[1]!.body).sort()).toEqual(["body", "expectedUpdatedAt"]);
  });
  it.each(["create", "edit"] as const)(
    "%s retries an unknown acknowledgement with exact parsed body and UUID key, never replacing the current record with the receipt",
    async (mode) => {
      const writes: { body: unknown; key: string }[] = [],
        receipt = note({
          id: mode === "create" ? uuid(650) : NOTE,
          body: "Demo captured original intent",
          updatedAt: NEXT,
        });
      let committed = false;
      fixtures("expert", {
        [`GET ${NOTES}`]: () =>
          Response.json({
            profileId: PROFILE,
            organizationId: ORG,
            organizationName: "Demo internal manufacturer",
            canEdit: true,
            items: [
              committed ? note({ body: "Demo later current edit", updatedAt: "2026-11-02T00:00:00.000000Z" }) : note(),
            ],
            total: 1,
            offset: 0,
            limit: 25,
          }),
        [`${mode === "create" ? "POST" : "PUT"} ${mode === "create" ? NOTES : `${NOTES}/${NOTE}`}`]: (_url, init) => {
          writes.push({
            body: JSON.parse(String(init?.body)),
            key: (init!.headers as Record<string, string>)["Idempotency-Key"]!,
          });
          if (!committed) {
            committed = true;
            throw new TypeError("Demo ACK lost after commit");
          }
          return Response.json(receipt, { status: mode === "create" ? 201 : 200 });
        },
      });
      const { user } = mount(<RecordsPage profileId={PROFILE} />);
      await screen.findByText("Demo historical note");
      await user.click(screen.getByRole("button", { name: messages.en[mode === "create" ? "newNote" : "editNote"] }));
      const dialog = within(await screen.findByRole("dialog"));
      await user.clear(dialog.getByRole("textbox"));
      await user.type(dialog.getByRole("textbox"), "Demo captured original intent");
      await user.click(dialog.getByRole("button", { name: messages.en.save }));
      await dialog.findByText(messages.en.retryExactIntent);
      expect(disabled(dialog.getByRole("textbox"))).toBe(true);
      await user.click(dialog.getByRole("button", { name: messages.en.retry }));
      await waitFor(() => expect(writes).toHaveLength(2));
      expect(writes[1]).toEqual(writes[0]);
      expect(writes[0]!.key).toMatch(/^[a-f0-9-]{36}$/);
      await screen.findByText("Demo later current edit");
      await user.click(screen.getByText(messages.en.saveReceipt));
      const ack = within(screen.getByText(messages.en.saveReceipt).closest("details")!);
      expect(ack.getByText("Demo captured original intent")).toBeTruthy();
      expect(ack.queryByText("Demo later current edit")).toBeNull();
    },
  );
  it("403 hides all private record content, retains draft memory, blocks every mutation, and cannot recover from read-only metadata", async () => {
    let refused = false;
    const forbidden = problem(403, "forbidden") as (url: globalThis.URL) => Response;
    const api = fixtures("expert", {
      [`GET ${NOTES}`]: () =>
        Response.json({
          profileId: PROFILE,
          organizationId: ORG,
          organizationName: "Demo internal manufacturer",
          canEdit: !refused,
          items: [note()],
          total: 1,
          offset: 0,
          limit: 25,
        }),
      [`PUT ${NOTES}/${NOTE}`]: (url) => {
        refused = true;
        return forbidden(url);
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />),
      dialog = await noteEditor(user);
    await user.type(dialog.getByRole("textbox"), " Demo retained intent");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await dialog.findByText(messages.en.authorityBlocked);
    expect(dialog.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("Demo internal manufacturer")).toBeNull();
    expect(screen.queryByText("Demo historical note")).toBeNull();
    expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(true);
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.errors.forbidden);
    expect(dialog.queryByRole("textbox")).toBeNull();
    expect(api.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);
  });
  it("a fresh authorized recovery restores the same dirty draft without transferring it to a new actor", async () => {
    let refused = false;
    const forbidden = problem(403, "forbidden") as (url: globalThis.URL) => Response;
    fixtures("expert", {
      [`PUT ${NOTES}/${NOTE}`]: (url) => {
        refused = true;
        return forbidden(url);
      },
      [`GET ${NOTES}/${NOTE}`]: () => Response.json(note(refused ? { updatedAt: NEXT } : {})),
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />),
      dialog = await noteEditor(user);
    await user.type(dialog.getByRole("textbox"), " Demo retained intent");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await dialog.findByText(messages.en.authorityBlocked);
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.rebased);
    expect((dialog.getByRole("textbox") as HTMLInputElement).value).toBe("Demo historical note Demo retained intent");
    expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(false);
  });
  it("dirty route navigation requires deliberate discard and Stay keeps the note", async () => {
    fixtures();
    const { user, router } = mount(<RecordsPage profileId={PROFILE} />),
      dialog = await noteEditor(user);
    await user.type(dialog.getByRole("textbox"), " Demo dirty");
    void router.navigate("/away");
    const confirmation = within(await screen.findByRole("alertdialog"));
    await user.click(confirmation.getByRole("button", { name: "Stay here" }));
    expect((dialog.getByRole("textbox") as HTMLInputElement).value).toBe("Demo historical note Demo dirty");
    await user.click(dialog.getByRole("button", { name: "Cancel" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Discard and leave" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
  it("creates nullable interaction context with historical date, explicit unknowns, and no outreach or registration writes", async () => {
    const writes: ImbcEngagementPut[] = [];
    const api = fixtures("expert", {
      [`GET ${ENGAGEMENT}`]: { body: null },
      [`PUT ${ENGAGEMENT}`]: (_url, init) => {
        const body = JSON.parse(String(init?.body));
        writes.push(body);
        return Response.json(
          engagement({
            receiptConfirmed: body.receiptConfirmed,
            eoiEvents: body.eoiEvents.map((row: { id: string; sentOn: string }) => ({
              ...row,
              source: "expert",
              recordedBy: ACTOR,
              recordedByName: "Demo SME",
              createdAt: NEXT,
              updatedAt: NEXT,
            })),
            updatedAt: NEXT,
          }),
        );
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=engagement`);
    await screen.findByText(messages.en.noEngagement);
    await user.click(screen.getByRole("button", { name: messages.en.editEngagement }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: messages.en.addHistoricalDate }));
    fireEvent.change(dialog.getByLabelText("EOI date 1"), { target: { value: "2018-09-07" } });
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      receiptConfirmed: null,
      response: null,
      responseSummary: null,
      readyForSiteVisit: null,
      addedToImbcYear: null,
      folderUrl: null,
      sourceEntryIds: [],
      expectedUpdatedAt: null,
    });
    expect(writes[0]!.eoiEvents[0]!.sentOn).toBe("2018-09-07");
    expect(writes[0]!.eoiEvents[0]!.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(api.mock.calls.some(([url]) => /notifications|campaign|registration|lps|eoi\/send/.test(String(url)))).toBe(
      false,
    );
  });
  it("retains concurrent historical EOI IDs during CAS recovery while preserving the user date correction", async () => {
    const newId = uuid(670);
    let stale = false;
    const writes: ImbcEngagementPut[] = [],
      conflict = problem(409, "conflict") as (url: globalThis.URL) => Response;
    fixtures("expert", {
      [`GET ${ENGAGEMENT}`]: () =>
        Response.json(
          engagement(
            stale
              ? {
                  updatedAt: NEXT,
                  eoiEvents: [
                    ...engagement().eoiEvents,
                    { ...engagement().eoiEvents[0]!, id: newId, sentOn: "2019-01-02" },
                  ],
                }
              : {},
          ),
        ),
      [`PUT ${ENGAGEMENT}`]: (url, init) => {
        writes.push(JSON.parse(String(init?.body)));
        stale = true;
        return conflict(url);
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=engagement`);
    await screen.findByText(messages.en.historicalEoiDates);
    await user.click(screen.getByRole("button", { name: messages.en.editEngagement }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.queryByRole("button", { name: messages.en.removeUnsavedDate })).toBeNull();
    fireEvent.change(dialog.getByLabelText("EOI date 1"), { target: { value: "2020-05-05" } });
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await dialog.findByText(messages.en.errors.changed);
    await user.click(dialog.getByRole("button", { name: messages.en.reloadKeepDraft }));
    await dialog.findByText(messages.en.rebased);
    expect((dialog.getByLabelText("EOI date 1") as HTMLInputElement).value).toBe("2020-05-05");
    expect((dialog.getByLabelText("EOI date 2") as HTMLInputElement).value).toBe("2019-01-02");
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.eoiEvents).toEqual([
      { id: EVENT, sentOn: "2020-05-05" },
      { id: newId, sentOn: "2019-01-02" },
    ]);
    expect(writes[1]!.expectedUpdatedAt).toBe(NEXT);
  });
  it("selects actual programme and priority for a canonical stable product and sends no public LPS/ranking/source fields", async () => {
    const writes: ImbcProductContextPut[] = [],
      api = fixtures("expert", {
        [`GET ${CONTEXT}`]: { body: null },
        [`PUT ${CONTEXT}`]: (_url, init) => {
          const body = JSON.parse(String(init?.body));
          writes.push(body);
          return Response.json(
            context({ programmeId: body.programmeId, priorityId: body.priorityId, updatedAt: NEXT }),
          );
        },
      });
    const { user } = mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=products&product=${PRODUCT}`);
    await screen.findByText(messages.en.noProductContext);
    await user.click(screen.getByRole("button", { name: messages.en.editProductContext }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(await dialog.findByRole("checkbox", { name: "Demo LC" }));
    await user.click(await dialog.findByRole("checkbox", { name: "Demo 1" }));
    await waitFor(() => expect(disabled(dialog.getByRole("button", { name: messages.en.save }))).toBe(false));
    await user.click(dialog.getByRole("button", { name: messages.en.save }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ programmeId: PROGRAMME, priorityId: PRIORITY, expectedUpdatedAt: null });
    expect(
      api.mock.calls.some(
        ([url]) =>
          String(url).includes("/lps") ||
          String(url).includes("/own/sections") ||
          String(url).includes("/dictionaries"),
      ),
    ).toBe(false);
  });
  it("retired selected metadata remains visible and removable, but a retired option cannot be newly chosen", async () => {
    const rows = [reference(PROGRAMME, "LC", true), reference(uuid(680), "LPS", true)];
    fixtures("expert", {
      [`GET ${CONTEXT}`]: { body: context({ programmeId: PROGRAMME }) },
      [`GET ${BASE}/imbc-records/reference-options/programme`]: (url) => {
        const ids = url.searchParams.get("ids")?.split(",");
        const items = ids ? rows.filter((row) => ids.includes(row.id)) : rows;
        return Response.json({
          dictionaryCode: "programme",
          items,
          total: items.length,
          offset: 0,
          limit: ids?.length ?? 25,
        });
      },
    });
    const { user } = mount(<RecordsPage profileId={PROFILE} />, "en", `${URL}?view=products&product=${PRODUCT}`);
    await screen.findByText("Demo LC");
    await user.click(screen.getByRole("button", { name: messages.en.editProductContext }));
    const dialog = within(await screen.findByRole("dialog"));
    const retained = await dialog.findByRole("checkbox", { name: /Demo LC/ });
    expect(disabled(retained)).toBe(false);
    expect(disabled(dialog.getByRole("checkbox", { name: /Demo LPS/ }))).toBe(true);
    await user.click(retained);
    expect(disabled(retained)).toBe(true);
  });
});

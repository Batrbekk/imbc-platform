import { SECTION_KINDS, type ProfileSubmissionState, type ProfileSubmitInput } from "@imbc/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi, type ApiReply } from "./support/api";
import { MANUFACTURER, contactsSection, overview, ownProfile, uuid } from "./support/profile-fixtures";
import { renderRoute } from "./support/render";

function fixture(replies: Record<string, ApiReply> = {}, initial: Partial<ProfileSubmissionState> = {}) {
  let state: ProfileSubmissionState = {
    profileId: uuid(10),
    profileStatus: "draft",
    activeAssignmentId: null,
    hasUnsubmittedChanges: false,
    ...initial,
  };
  let vectorVersion = 3;
  const sent: ProfileSubmitInput[] = [];
  const unlocks: unknown[] = [];
  const assignmentId = uuid(900);
  const currentOverview = () =>
    overview({
      profileStatus: state.profileStatus,
      readOnly: state.activeAssignmentId !== null,
      completenessPct: 100,
      hasPendingChanges: state.profileStatus === "verified" && Boolean(state.activeAssignmentId),
      sections: SECTION_KINDS.map((kind, index) => ({
        ...overview().sections[index],
        kind,
        available: true,
        profileStatus: state.profileStatus,
        revisionId: uuid(20 + index),
        revisionState: state.activeAssignmentId
          ? state.profileStatus === "verified"
            ? "verified"
            : "submitted"
          : "working",
        editVersion: vectorVersion,
        readOnly: state.activeAssignmentId !== null,
        completeness: { percent: 100, missing: [] },
      })),
    });
  const requests = stubApi({
    "GET /api/auth/me": { body: MANUFACTURER },
    "GET /api/v1/profiles/own": () => Response.json(ownProfile({ status: state.profileStatus })),
    "GET /api/v1/profiles/own/sections": () => Response.json(currentOverview()),
    "GET /api/v1/profiles/own/submission": () => Response.json(state),
    "GET /api/v1/profiles/own/sections/contacts": () =>
      Response.json(
        contactsSection(undefined, {
          profileStatus: state.profileStatus,
          readOnly: state.activeAssignmentId !== null,
          revisionState: state.activeAssignmentId ? "verified" : "working",
        }),
      ),
    "GET /api/v1/dictionaries/contact_role/choices": { body: { items: [], total: 0, page: 1, pageSize: 100 } },
    "POST /api/v1/profiles/own/submit": (_url, init) => {
      const body: ProfileSubmitInput = JSON.parse(String(init?.body));
      sent.push(body);
      state = {
        ...state,
        profileStatus: state.profileStatus === "verified" ? "verified" : "submitted",
        activeAssignmentId: assignmentId,
        hasUnsubmittedChanges: false,
      };
      return Response.json({
        profileId: state.profileId,
        profileStatus: state.profileStatus,
        assignmentId,
        receivedAt: "2026-11-16T09:00:00Z",
        mode: state.profileStatus === "verified" ? "verified_changes" : "initial",
        sections: body.expectedSections.map(({ kind, revisionId }) => ({
          kind,
          revisionId,
          reviewRequired: state.profileStatus !== "verified",
          retainedDecisionId: state.profileStatus === "verified" ? uuid(950 + SECTION_KINDS.indexOf(kind)) : null,
        })),
      });
    },
    "POST /api/v1/profiles/own/unlock": (_url, init) => {
      unlocks.push(JSON.parse(String(init?.body)));
      state = {
        ...state,
        profileStatus: state.profileStatus === "verified" ? "verified" : "draft",
        activeAssignmentId: null,
        hasUnsubmittedChanges: state.profileStatus === "verified",
      };
      return Response.json({
        profileId: state.profileId,
        profileStatus: state.profileStatus,
        assignmentId,
        unlockedAt: "2026-11-16T09:10:00Z",
      });
    },
    ...replies,
  });
  return {
    requests,
    sent,
    unlocks,
    advance: () => {
      vectorVersion++;
    },
    state: () => state,
  };
}
const postBodies = (requests: ReturnType<typeof stubApi>, path = "submit") =>
  requests.mock.calls
    .filter(([url, init]) => String(url).endsWith(`/own/${path}`) && init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init?.body)));

async function openSend(user: ReturnType<typeof renderRoute>["user"], name = en.profileSubmission.send) {
  await user.click(await screen.findByRole("button", { name }));
  return within(await screen.findByRole("dialog"));
}

describe("manufacturer Send and Unlock", () => {
  it.each([
    ["en", en],
    ["ru", ru],
    ["kk", kk],
  ] as const)("requires a fresh manual accuracy confirmation in %s", async (locale, messages) => {
    const api = fixture();
    const { user } = renderRoute("/profile", { locale });
    let dialog = await openSend(user, messages.profileSubmission.send);
    expect(
      (dialog.getByRole("button", { name: messages.profileSubmission.confirmSend }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(dialog.getByRole("checkbox", { name: messages.profileSubmission.accuracy }));
    await user.click(dialog.getByRole("button", { name: messages.profileSubmission.cancel }));
    dialog = await openSend(user, messages.profileSubmission.send);
    expect(
      dialog.getByRole("checkbox", { name: messages.profileSubmission.accuracy }).getAttribute("aria-checked"),
    ).toBe("false");
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: messages.profileSubmission.confirmSend }));
    await screen.findByText(messages.profileSubmission.sent);
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0].accuracyConfirmed).toBe(true);
    expect(api.sent[0].expectedSections).toEqual(
      SECTION_KINDS.map((kind, index) => ({ kind, revisionId: uuid(20 + index), editVersion: 3 })),
    );
    expect(
      ((await screen.findByRole("button", { name: messages.profileSubmission.unlock })) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText(api.sent[0].operationKey)).toBeNull();
  });

  it("retries the exact request after an ambiguous network failure", async () => {
    let count = 0;
    const api = fixture({
      "POST /api/v1/profiles/own/submit": (_url, init) => {
        if (++count === 1) return Promise.reject(new TypeError("network secret"));
        const body: ProfileSubmitInput = JSON.parse(String(init?.body));
        return Response.json({
          profileId: uuid(10),
          profileStatus: "submitted",
          assignmentId: uuid(900),
          receivedAt: "2026-11-16T09:00:00Z",
          mode: "initial",
          sections: body.expectedSections.map(({ kind, revisionId }) => ({
            kind,
            revisionId,
            reviewRequired: true,
            retainedDecisionId: null,
          })),
        });
      },
    });
    const { user } = renderRoute("/profile", { locale: "en" });
    const dialog = await openSend(user);
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
    await screen.findByText(en.profileSubmission.errors.network);
    api.advance();
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.retry }));
    await screen.findByText(en.profileSubmission.sent);
    expect(postBodies(api.requests)).toHaveLength(2);
    expect(postBodies(api.requests)[1]).toEqual(postBodies(api.requests)[0]);
    expect(screen.queryByText("network secret")).toBeNull();
  });

  it("stale conflict requires explicit rereading and new confirmation", async () => {
    const api = fixture({
      "POST /api/v1/profiles/own/submit": () =>
        Response.json({ code: "section_changed", title: "private metadata" }, { status: 409 }),
    });
    const { user } = renderRoute("/profile", { locale: "en" });
    let dialog = await openSend(user);
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
    await screen.findByText(en.profileSubmission.errors.stale);
    expect((dialog.getByRole("button", { name: en.profileSubmission.confirmSend }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const old = postBodies(api.requests)[0];
    api.advance();
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.reload }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    dialog = await openSend(user);
    expect(dialog.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
    await waitFor(() => expect(postBodies(api.requests)).toHaveLength(2));
    expect(postBodies(api.requests)[1].operationKey).not.toBe(old.operationKey);
    expect(
      postBodies(api.requests)[1].expectedSections.every(
        (section: { editVersion: number }) => section.editVersion === 4,
      ),
    ).toBe(true);
    expect(screen.queryByText("private metadata")).toBeNull();
  });

  it.each(["cancel", "escape"] as const)(
    "keeps the stale barrier after %s until explicit rereading succeeds",
    async (dismiss) => {
      const api = fixture({
        "POST /api/v1/profiles/own/submit": () => Response.json({ code: "section_changed" }, { status: 409 }),
      });
      const { user } = renderRoute("/profile", { locale: "en" });
      let dialog = await openSend(user);
      await user.click(dialog.getByRole("checkbox"));
      await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
      await screen.findByText(en.profileSubmission.errors.stale);
      if (dismiss === "cancel") await user.click(dialog.getByRole("button", { name: en.profileSubmission.cancel }));
      else await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const send = screen.getByRole("button", { name: en.profileSubmission.send });
      expect((send as HTMLButtonElement).disabled).toBe(true);
      await user.click(send);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(postBodies(api.requests)).toHaveLength(1);
      api.advance();
      await user.click(screen.getByRole("button", { name: en.profileSubmission.reload }));
      await waitFor(() =>
        expect((screen.getByRole("button", { name: en.profileSubmission.send }) as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      dialog = await openSend(user);
      expect(dialog.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
      await user.click(dialog.getByRole("checkbox"));
      await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
      await waitFor(() => expect(postBodies(api.requests)).toHaveLength(2));
      expect(postBodies(api.requests)[1].operationKey).not.toBe(postBodies(api.requests)[0].operationKey);
      expect(
        postBodies(api.requests)[1].expectedSections.every(
          (section: { editVersion: number }) => section.editVersion === 4,
        ),
      ).toBe(true);
    },
  );

  it("keeps the stale barrier when rereading fails until all saved data can be loaded", async () => {
    let reads = 0;
    const fresh = overview({
      profileStatus: "draft",
      completenessPct: 100,
      sections: SECTION_KINDS.map((kind, index) => ({
        ...overview().sections[index],
        kind,
        available: true,
        profileStatus: "draft",
        revisionId: uuid(20 + index),
        revisionState: "working",
        editVersion: 4,
        completeness: { percent: 100, missing: [] },
      })),
    });
    const api = fixture({
      "GET /api/v1/profiles/own/sections": () => {
        if (++reads === 2) return Promise.reject(new TypeError("offline during reload"));
        return Response.json({
          ...fresh,
          sections: fresh.sections.map((section) => ({ ...section, editVersion: reads === 1 ? 3 : 4 })),
        });
      },
      "POST /api/v1/profiles/own/submit": () => Response.json({ code: "section_changed" }, { status: 409 }),
    });
    const { user } = renderRoute("/profile", { locale: "en" });
    let dialog = await openSend(user);
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
    await screen.findByText(en.profileSubmission.errors.stale);
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.reload }));
    await screen.findByText(en.profileSubmission.reloadError);
    expect((screen.getByRole("button", { name: en.profileSubmission.send }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: en.profileSubmission.reload }));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: en.profileSubmission.send }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    dialog = await openSend(user);
    expect(dialog.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
    await waitFor(() => expect(postBodies(api.requests)).toHaveLength(2));
    expect(
      postBodies(api.requests)[1].expectedSections.every(
        (section: { editVersion: number }) => section.editVersion === 4,
      ),
    ).toBe(true);
    expect(screen.queryByText("offline during reload")).toBeNull();
  });

  it("shows current new requirements by name and links to correction even at cached 100 percent", async () => {
    const typeId = uuid(700);
    fixture({
      "POST /api/v1/profiles/own/submit": () =>
        Response.json(
          {
            code: "profile_incomplete",
            title: "private",
            missing: [{ kind: "documents", path: `requiredTypes.${typeId}`, code: "required" }],
            requirements: [{ kind: "documents", requiredTypeIds: [typeId] }],
          },
          { status: 400 },
        ),
      "GET /api/v1/profiles/own/sections/documents/choices": {
        body: {
          requiredTypes: [
            {
              id: typeId,
              code: "new-required",
              names: { en: "New safety permit", ru: null, kk: null },
              customNameAllowed: false,
            },
          ],
        },
      },
    });
    const { user } = renderRoute("/profile", { locale: "en" });
    const dialog = await openSend(user);
    await user.click(dialog.getByRole("checkbox"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
    await screen.findByText("New safety permit");
    expect(dialog.getByRole("link", { name: en.profileEditor.sections.documents }).getAttribute("href")).toBe(
      "/profile/documents",
    );
    expect(screen.queryByText(typeId)).toBeNull();
    expect((dialog.getByRole("button", { name: en.profileSubmission.confirmSend }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("uses canonical active review even when retained revisions have no pending pointers, then allows retained C2 resubmit", async () => {
    const api = fixture({}, { profileStatus: "verified", activeAssignmentId: uuid(900), hasUnsubmittedChanges: false });
    const { user } = renderRoute("/profile", { locale: "en" });
    expect(
      ((await screen.findByRole("button", { name: en.profileSubmission.unlock })) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByRole("button", { name: en.profileSubmission.sendChanges })).toBeNull();
    await user.click(screen.getByRole("button", { name: en.profileSubmission.unlock }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmUnlock }));
    await screen.findByText(en.profileSubmission.unlocked);
    expect(api.unlocks).toHaveLength(1);
    expect(api.unlocks[0]).toMatchObject({ expectedAssignmentId: uuid(900) });
    expect(
      ((await screen.findByRole("button", { name: en.profileSubmission.sendChanges })) as HTMLButtonElement).disabled,
    ).toBe(false);
    const send = await openSend(user, en.profileSubmission.sendChanges);
    await user.click(send.getByRole("checkbox"));
    await user.click(send.getByRole("button", { name: en.profileSubmission.confirmSend }));
    await screen.findByText(en.profileSubmission.sent);
    expect(api.sent[0].expectedSections.map((section) => section.revisionId)).toEqual(
      SECTION_KINDS.map((_kind, index) => uuid(20 + index)),
    );
    expect(
      ((await screen.findByRole("button", { name: en.profileSubmission.unlock })) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("keeps all retained active sections read only when opening an editor", async () => {
    fixture({}, { profileStatus: "verified", activeAssignmentId: uuid(900) });
    renderRoute("/profile/contacts", { locale: "en" });
    expect(
      (await screen.findAllByRole("textbox", { name: en.profileEditor.fullName }))[0].hasAttribute("readonly"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: en.profileEditor.save })).toBeNull();
    expect(screen.queryByRole("button", { name: en.profileEditor.edit })).toBeNull();
  });
  it("does not issue a second Send or dismiss while the first request is in flight", async () => {
    let complete: ((response: Response) => void) | undefined;
    let request: ProfileSubmitInput | undefined;
    const api = fixture({
      "POST /api/v1/profiles/own/submit": (_url, init) => {
        request = JSON.parse(String(init?.body));
        return new Promise<Response>((resolve) => {
          complete = resolve;
        });
      },
    });
    const { user } = renderRoute("/profile", { locale: "en" });
    const dialog = await openSend(user);
    await user.click(dialog.getByRole("checkbox"));
    await user.dblClick(dialog.getByRole("button", { name: en.profileSubmission.confirmSend }));
    expect(postBodies(api.requests)).toHaveLength(1);
    expect((dialog.getByRole("button", { name: en.profileSubmission.processing }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeTruthy();
    complete!(
      Response.json({
        profileId: uuid(10),
        profileStatus: "submitted",
        assignmentId: uuid(900),
        receivedAt: "2026-11-16T09:00:00Z",
        mode: "initial",
        sections: request!.expectedSections.map(({ kind, revisionId }) => ({
          kind,
          revisionId,
          reviewRequired: true,
          retainedDecisionId: null,
        })),
      }),
    );
    await screen.findByText(en.profileSubmission.sent);
  });

  it("retries Unlock with the original assignment and operation after a network failure", async () => {
    let count = 0;
    const api = fixture(
      {
        "POST /api/v1/profiles/own/unlock": () => {
          if (++count === 1) return Promise.reject(new TypeError("offline"));
          return Response.json({
            profileId: uuid(10),
            profileStatus: "verified",
            assignmentId: uuid(900),
            unlockedAt: "2026-11-16T09:10:00Z",
          });
        },
      },
      { profileStatus: "verified", activeAssignmentId: uuid(900) },
    );
    const { user } = renderRoute("/profile", { locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.profileSubmission.unlock }));
    const dialog = within(await screen.findByRole("dialog"));
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.confirmUnlock }));
    await screen.findByText(en.profileSubmission.errors.network);
    await user.click(dialog.getByRole("button", { name: en.profileSubmission.retry }));
    await screen.findByText(en.profileSubmission.unlocked);
    expect(postBodies(api.requests, "unlock")).toHaveLength(2);
    expect(postBodies(api.requests, "unlock")[1]).toEqual(postBodies(api.requests, "unlock")[0]);
  });

  it("fails closed when the current review status has an invalid shape", async () => {
    const api = fixture({
      "GET /api/v1/profiles/own/submission": { body: { profileStatus: "verified", activeAssignmentId: null } },
    });
    renderRoute("/profile", { locale: "en" });
    await screen.findByText(en.profileSubmission.stateError);
    expect(screen.queryByRole("button", { name: en.profileSubmission.sendChanges })).toBeNull();
    expect(screen.queryByRole("button", { name: en.profileSubmission.unlock })).toBeNull();
    expect(postBodies(api.requests)).toHaveLength(0);
  });
});

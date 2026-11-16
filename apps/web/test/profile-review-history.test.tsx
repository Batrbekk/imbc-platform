import { SECTION_KINDS, type ProfileOwnReviewDetails } from "@imbc/contracts";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { stubApi } from "./support/api";
import { MANUFACTURER, mainSection, uuid } from "./support/profile-fixtures";
import { renderRoute } from "./support/render";

type ReviewItem = ProfileOwnReviewDetails["sections"][number]["items"][number];
function setup(
  appliesToCurrentRevision: boolean,
  selectedKind: "documents" | "certificates" = "documents",
  itemOverrides?: ReviewItem[],
) {
  const type = {
    id: uuid(750),
    code: "old-required",
    names: { en: "Historical permit", ru: null, kk: null },
    customNameAllowed: false,
  };
  const newType = {
    ...type,
    id: uuid(751),
    code: "new-required",
    names: { en: "Current safety permit", ru: null, kk: null },
  };
  const decision = {
    id: uuid(800),
    outcome: "rejected" as const,
    comment: "Replace the expired certificate.",
    decidedAt: "2026-11-15T10:00:00Z",
  };
  return stubApi({
    "GET /api/auth/me": { body: MANUFACTURER },
    "GET /api/v1/profiles/own/submission": {
      body: { profileId: uuid(10), profileStatus: "verified", activeAssignmentId: null, hasUnsubmittedChanges: true },
    },
    [`GET /api/v1/profiles/own/sections/${selectedKind}`]: {
      body: {
        ...mainSection(),
        kind: selectedKind,
        profileStatus: "verified",
        revisionState: "verified",
        revisionId: uuid(20),
        data:
          selectedKind === "documents"
            ? {
                editable: { documents: [] },
                documents: [],
                requiredTypes: [type],
                requirementSource: "submission_snapshot",
              }
            : {
                editable: { certificates: [] },
                certificates: [],
                requiredTypes: [type],
                requirementSource: "submission_snapshot",
              },
      },
    },
    "GET /api/v1/profiles/own/sections/documents/choices": { body: { requiredTypes: [newType] } },
    "GET /api/v1/dictionaries/document_type/choices": { body: { items: [], total: 0, page: 1, pageSize: 100 } },
    "GET /api/v1/profiles/own/review": {
      body: {
        profileId: uuid(10),
        assignment: {
          id: uuid(900),
          receivedAt: "2026-11-14T10:00:00Z",
          closedAt: "2026-11-15T10:00:00Z",
          expertId: uuid(901),
        },
        sections: SECTION_KINDS.map((kind) => ({
          kind,
          currentRevisionId: kind === selectedKind ? uuid(20) : null,
          reviewedRevisionId: kind === selectedKind ? uuid(appliesToCurrentRevision ? 20 : 19) : null,
          reviewRequired: kind === selectedKind ? true : null,
          appliesToCurrentRevision: kind === selectedKind && appliesToCurrentRevision,
          decision:
            kind === selectedKind
              ? { ...decision, outcome: "verified", comment: "Previously accepted section." }
              : null,
          items:
            kind === selectedKind
              ? (itemOverrides ?? [
                  {
                    subject: { kind: "document", documentId: uuid(850) },
                    stableIdentityId: uuid(851),
                    fileObjectId: null,
                    label: {
                      kind: "document",
                      positionInList: 4,
                      type: { code: type.code, names: type.names },
                      customName: "Expired permit",
                    },
                    decision,
                  },
                ])
              : [],
        })),
      },
    },
  });
}
describe("historical review context and current editing requirements", () => {
  it("keeps past decisions separate from current edits without rendering technical identifiers", async () => {
    setup(false);
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    await user.click(await screen.findByText(en.profileReviewHistory.title));
    await screen.findByText(en.profileReviewHistory.previous);
    expect(screen.getByText("Previously accepted section.")).toBeTruthy();
    expect(screen.getByText("Replace the expired certificate.")).toBeTruthy();
    expect(screen.getByText(en.profileReviewHistory.rejected)).toBeTruthy();
    expect(screen.queryByText(uuid(19))).toBeNull();
    expect(screen.queryByText(uuid(850))).toBeNull();
    expect(screen.queryByText(en.profileReviewHistory.current)).toBeNull();
  });
  it("labels an exact current reviewed revision explicitly", async () => {
    setup(true);
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    await user.click(await screen.findByText(en.profileReviewHistory.title));
    await screen.findByText(en.profileReviewHistory.current);
    expect(screen.queryByText(en.profileReviewHistory.previous)).toBeNull();
  });
  it("shows historical requirements while viewing, current required types after explicit Edit and adds the new required document", async () => {
    const api = setup(false);
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    await screen.findByText("Historical permit");
    expect(screen.queryByText("Current safety permit")).toBeNull();
    expect(api.mock.calls.some(([url]) => String(url).endsWith("/sections/documents/choices"))).toBe(false);
    await user.click(screen.getByRole("button", { name: en.profileEditor.edit }));
    const label = await screen.findByText("Current safety permit");
    expect(screen.queryByText("Historical permit")).toBeNull();
    await user.click(within(label.parentElement!).getByRole("button", { name: en.profileDocuments.add }));
    expect(await screen.findByText(en.profileDocuments.number.replace("{number}", "1"))).toBeTruthy();
    expect(screen.queryByText(uuid(751))).toBeNull();
  });
  it.each(["documents", "certificates"] as const)(
    "identifies deleted historical %s by their frozen labels and original positions",
    async (kind) => {
      const decision = (id: number, comment: string) => ({
        id: uuid(id),
        outcome: "rejected" as const,
        comment,
        decidedAt: "2026-11-15T10:00:00Z",
      });
      const historicalType = { code: "historical-type", names: { en: "Old evidence type", ru: null, kk: null } };
      const subject = (id: number): ReviewItem["subject"] =>
        kind === "documents"
          ? { kind: "document", documentId: uuid(id) }
          : { kind: "certificate", certificateId: uuid(id) };
      const label = (positionInList: number, name: string): ReviewItem["label"] =>
        kind === "documents"
          ? { kind: "document", positionInList, type: historicalType, customName: name }
          : {
              kind: "certificate",
              positionInList,
              type: historicalType,
              customTypeName: name,
              number: "OLD-CERT-2016",
            };
      const items: ReviewItem[] = [
        {
          subject: subject(840),
          stableIdentityId: uuid(841),
          fileObjectId: null,
          label: label(2, "Undecided old evidence"),
          decision: null,
        },
        {
          subject: subject(850),
          stableIdentityId: uuid(851),
          fileObjectId: null,
          label: label(7, "Deleted old evidence"),
          decision: decision(860, "Correct the deleted old evidence."),
        },
        {
          subject: subject(870),
          stableIdentityId: uuid(871),
          fileObjectId: null,
          label: label(0, "First old evidence"),
          decision: decision(880, "Correct the first old evidence."),
        },
        {
          subject: { kind: "file", fileVersionId: uuid(890) },
          stableIdentityId: null,
          fileObjectId: uuid(891),
          label: { kind: "file", originalName: "original-reviewed-scan.pdf" },
          decision: decision(892, "Replace this exact old scan."),
        },
      ];
      setup(false, kind, items);
      const { user } = renderRoute(`/profile/${kind}`, { locale: "en" });
      await user.click(await screen.findByText(en.profileReviewHistory.title));
      await screen.findByText("Deleted old evidence");
      const deleted = screen.getByText("Deleted old evidence").closest("li")!;
      const first = screen.getByText("First old evidence").closest("li")!;
      expect(
        within(deleted).getByText(
          en.profileReviewHistory.item[kind === "documents" ? "document" : "certificate"].replace("{number}", "8"),
        ),
      ).toBeTruthy();
      expect(within(deleted).getByText("Correct the deleted old evidence.")).toBeTruthy();
      expect(
        within(first).getByText(
          en.profileReviewHistory.item[kind === "documents" ? "document" : "certificate"].replace("{number}", "1"),
        ),
      ).toBeTruthy();
      expect(within(first).getByText("Correct the first old evidence.")).toBeTruthy();
      expect(screen.queryByText("Undecided old evidence")).toBeNull();
      if (kind === "certificates") expect(within(deleted).getByText("Certificate number: OLD-CERT-2016")).toBeTruthy();
      const file = screen.getByText("original-reviewed-scan.pdf").closest("li")!;
      expect(within(file).getByText("Replace this exact old scan.")).toBeTruthy();
      expect(screen.getByText(en.profileReviewHistory.previous)).toBeTruthy();
      expect(screen.queryByText(uuid(850))).toBeNull();
      expect(screen.queryByText(uuid(890))).toBeNull();
    },
  );
});

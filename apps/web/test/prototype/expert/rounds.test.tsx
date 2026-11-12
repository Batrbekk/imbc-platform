// Кабинет SME: признак правки после решения, круг ожидающих изменений, письмо NOT-05 по NOT-27 и NOT-28,
// права SME (REV-01, REV-06, REV-07, REV-08, IMBC-18, MAN-44).
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { nextCheckDate } from "@/prototype/expert/dossier";
import { readExt } from "@/prototype/expert/ext";

import { renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

const card = (title: string) =>
  screen.getByText(title, { selector: "[data-slot=card-title]" }).closest("[data-slot=card]") as HTMLElement;

async function rejectSection(
  user: ReturnType<typeof renderCabinet>["user"],
  title: string,
  button: string,
  comment: string,
) {
  await user.click(within(card(title)).getByRole("button", { name: button }));
  const dialog = await screen.findByRole("alertdialog");
  await user.type(within(dialog).getByRole("textbox", { name: "Comment on the section" }), comment);
  await user.click(within(dialog).getByRole("button", { name: button }));
}

describe("кабинет SME: круг проверки и письмо о результате", () => {
  it("отклонение ожидающего изменения: правка остаётся у производителя, круг закрыт, профиль вне очереди (REV-08)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p02", { role: "expert" });
    await screen.findByRole("heading", { name: "ТОО «Каспий Демо Сервис»" });
    await rejectSection(user, "Contacts", "Reject change", "Телефон нового контакта не отвечает");

    const p = state().profiles.find((x) => x.id === "p02")!;
    expect(p.status).toBe("verified");
    expect(p.pendingChanges).toBe(false);
    expect(p.pending.contacts?.map((c) => c.id)).toContain("p02-c4");
    expect(p.sections.contacts.map((c) => c.id)).not.toContain("p02-c4");
    expect(p.review.contacts).toMatchObject({
      decision: "rejected",
      comment: "Телефон нового контакта не отвечает",
      changed: false,
    });
    expect(state().notifications.at(-1)).toMatchObject({
      profileId: "p02",
      notId: "NOT-05",
      params: {
        result: "changes",
        accepted: "",
        rejected: "contacts",
        "comment.contacts": "Телефон нового контакта не отвечает",
      },
    });
    expect(readExt(state()).changeRound.p02).toBeUndefined();
    cleanup();

    renderCabinet("/proto/expert/profiles", { role: "expert", keepState: true });
    await screen.findByRole("heading", { name: "Profiles in work" });
    expect(screen.queryByRole("link", { name: "ТОО «Каспий Демо Сервис»" })).toBeNull();
  });

  it("полная проверка: каждое решение сбрасывает признак правки, в том числе повторное отклонение (MAN-44)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p11", {
      role: "expert",
      prepare: (d) => {
        d.profiles.find((x) => x.id === "p11")!.review.shareholders.changed = true;
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Демо Электро Монтаж»" });
    await rejectSection(user, "Shareholders", "Reject section", "Первый комментарий");
    expect(state().profiles.find((x) => x.id === "p11")!.review.shareholders).toMatchObject({
      decision: "rejected",
      comment: "Первый комментарий",
      changed: false,
    });
    await rejectSection(user, "Shareholders", "Reject section", "Второй комментарий");
    expect(state().profiles.find((x) => x.id === "p11")!.review.shareholders).toMatchObject({
      decision: "rejected",
      comment: "Второй комментарий",
      changed: false,
    });
    await user.click(screen.getByRole("button", { name: "Verify section Main information" }));
    expect(state().profiles.find((x) => x.id === "p11")!.review.main).toMatchObject({
      decision: "verified",
      comment: null,
      changed: false,
    });
  });

  it("Returned: NOT-05 перечисляет только отклонённые секции с комментариями (NOT-27)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p11", {
      role: "expert",
      prepare: (d) => {
        const p = d.profiles.find((x) => x.id === "p11")!;
        for (const s of ["shareholders", "products", "production", "certificates", "documents"] as const) {
          p.review[s] = {
            decision: "verified",
            comment: null,
            decidedBy: "acc-expert",
            decidedAt: null,
            changed: false,
          };
        }
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Демо Электро Монтаж»" });
    await user.click(screen.getByRole("button", { name: "Submit result" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Submit result" }));
    expect(state().notifications.at(-1)!.params).toEqual({
      result: "returned",
      rejected: "personnel",
      "comment.personnel": "Оргструктура не совпадает с численностью персонала.",
    });
  });

  it("принятие и отклонение в одном круге — одно письмо с обоими списками", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p02", {
      role: "expert",
      prepare: (d) => {
        const p = d.profiles.find((x) => x.id === "p02")!;
        p.pending.personnel = { ...p.sections.personnel, managers: 50 };
        p.review.personnel.changed = true;
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Каспий Демо Сервис»" });
    const before = state().notifications.length;
    await user.click(screen.getByRole("button", { name: "Accept change Contacts" }));
    expect(state().notifications).toHaveLength(before);
    expect(state().profiles.find((x) => x.id === "p02")!.pendingChanges).toBe(true);
    await rejectSection(user, "Personnel", "Reject change", "Численность не подтверждена");
    expect(state().notifications).toHaveLength(before + 1);
    expect(state().notifications.at(-1)!.params).toEqual({
      result: "changes",
      accepted: "contacts",
      rejected: "personnel",
      "comment.personnel": "Численность не подтверждена",
    });
    expect(state().profiles.find((x) => x.id === "p02")!.pendingChanges).toBe(false);
  });

  it("ожидающие изменения без изменённых секций не зависают: досье предлагает закрыть круг", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p02", {
      role: "expert",
      prepare: (d) => {
        d.profiles.find((x) => x.id === "p02")!.review.contacts.changed = false;
      },
    });
    expect(await screen.findByText(/No changed section is left to decide/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close the round" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Close the round" }));
    expect(state().profiles.find((x) => x.id === "p02")!.pendingChanges).toBe(false);
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.close_changes" });
  });

  it("круг, начатый до разблокировки производителем, не попадает в письмо следующего круга", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p02", {
      role: "expert",
      prepare: (d) => {
        d.ext.expert = {
          ddLineNotes: {},
          changeRound: {
            p02: { startedAt: "2026-11-01T10:00:00.000Z", accepted: ["main"], rejected: [], comments: {} },
          },
        };
        d.audit.push({
          id: "au-unlock",
          at: "2026-11-05T10:00:00.000Z",
          actor: {
            accountId: "acc-org-m02",
            email: "x@company2.demo.local",
            name: "—",
            role: "manufacturer",
            organizationId: "org-m02",
          },
          action: "profile.send_changes",
          subject: { type: "profile", id: "p02", label: "p02" },
          summary: { en: "", ru: "", kk: "" },
        });
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Каспий Демо Сервис»" });
    await user.click(screen.getByRole("button", { name: "Accept change Contacts" }));
    expect(state().notifications.at(-1)!.params).toEqual({ result: "changes", accepted: "contacts", rejected: "" });
  });

  it("сохранённые свои данные другой формы не роняют экран", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p02", {
      role: "expert",
      prepare: (d) => {
        d.ext.expert = { ddLineNotes: { x: 5 }, changeRound: { p02: { accepted: "contacts", rejected: null } } };
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Каспий Демо Сервис»" });
    await user.click(screen.getByRole("button", { name: "Accept change Contacts" }));
    expect(state().notifications.at(-1)!.params).toEqual({ result: "changes", accepted: "contacts", rejected: "" });
  });

  it("принятие документа снимает прежний комментарий отклонения", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p11", {
      role: "expert",
      prepare: (d) => {
        const cert = d.profiles.find((x) => x.id === "p11")!.sections.certificates[0]!;
        cert.status = "rejected";
        cert.comment = "Скан нечитаемый";
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Демо Электро Монтаж»" });
    await user.click(screen.getByRole("button", { name: "Verify ISO 9001" }));
    expect(state().profiles.find((x) => x.id === "p11")!.sections.certificates[0]).toMatchObject({
      status: "verified",
      comment: null,
    });
  });

  it("права SME: только «взять себе», без назначения другому; operator requests и заметки — только просмотр", async () => {
    renderCabinet("/proto/expert/profiles?scope=all", { role: "expert" });
    await screen.findByRole("heading", { name: "Profiles in work" });
    const buttons = screen.getAllByRole("button").map((b) => b.textContent ?? "");
    expect(buttons.some((b) => /assign/i.test(b))).toBe(false);
    expect(screen.getAllByRole("button", { name: /^Take / })).toHaveLength(1); // только p09
    cleanup();

    for (const tab of ["operator", "notes"]) {
      renderCabinet(`/proto/expert/requests?tab=${tab}`, { role: "expert" });
      const panel = await screen.findByRole("tabpanel");
      expect(within(panel).queryAllByRole("button")).toEqual([]);
      expect(within(panel).queryAllByRole("textbox")).toEqual([]);
      cleanup();
    }
  });

  it("следующая плановая проверка — через квартал, без перехода за конец месяца (IMBC-07)", () => {
    expect(nextCheckDate("2026-11-30T10:00:00+05:00")).toBe("2027-02-28");
    expect(nextCheckDate("2026-09-03T10:05:00+05:00")).toBe("2026-12-03");
    expect(nextCheckDate("2027-11-30T10:00:00+05:00")).toBe("2028-02-29");
  });

  it("внешние проверки на языке интерфейса", async () => {
    const { user } = renderCabinet("/proto/expert/profiles/p05?tab=checks", { role: "expert", locale: "ru" });
    await user.click(await screen.findByRole("button", { name: "Запустить проверки (имитация)" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Запустить проверки (имитация)" }),
    );
    expect(await screen.findByText("Действующее юрлицо")).toBeTruthy();
    cleanup();
    renderCabinet("/proto/expert/profiles/p05?tab=checks", { role: "expert", keepState: true });
    expect(await screen.findByText("Active legal entity")).toBeTruthy();
    expect(screen.getAllByText("Legal-entity registry (mock)").length).toBeGreaterThan(0);
  });
});

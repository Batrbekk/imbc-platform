// Кабинет SME: решения по секциям и документам, Submit result, ожидающие изменения (REV-06, REV-07, REV-08, MAN-44).
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

const card = (title: string) =>
  screen.getByText(title, { selector: "[data-slot=card-title]" }).closest("[data-slot=card]") as HTMLElement;

describe("кабинет SME: проверка профиля", () => {
  it("досье показывает восемь секций с документами и решениями (REV-05)", async () => {
    const { api } = renderCabinet("/proto/expert/profiles/p11", { role: "expert" });
    expect(await screen.findByRole("heading", { name: "ТОО «Демо Электро Монтаж»" })).toBeTruthy();
    for (const title of [
      "Main information",
      "Contacts",
      "Personnel",
      "Shareholders",
      "Products",
      "Production",
      "Certificates",
      "Documents",
    ]) {
      expect(card(title)).toBeTruthy();
    }
    expect(within(card("Personnel")).getByText(/Оргструктура не совпадает/)).toBeTruthy();
    expect(within(card("Certificates")).getByText("p11-iso-9001.pdf", { exact: false })).toBeTruthy();
    expect(screen.getByText("Sections decided: 3 of 8")).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("отклонение секции требует комментария и пишется в review секции (REV-06)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p11", { role: "expert" });
    const shareholders = await waitFor(() => card("Shareholders"));
    await user.click(within(shareholders).getByRole("button", { name: "Reject section" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject section" });
    expect(confirm.hasAttribute("disabled") || confirm.getAttribute("aria-disabled") === "true").toBe(true);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Comment on the section" }),
      "Доли не сходятся с выпиской",
    );
    await user.click(within(dialog).getByRole("button", { name: "Reject section" }));

    expect(state().profiles.find((p) => p.id === "p11")!.review.shareholders).toMatchObject({
      decision: "rejected",
      comment: "Доли не сходятся с выпиской",
      decidedBy: "acc-expert",
    });
    expect(state().audit.at(-1)).toMatchObject({
      action: "section.reject",
      summary: { ru: "Отклонил секцию «Акционеры»" },
    });
    expect(await within(card("Shareholders")).findByText("Section rejected")).toBeTruthy();
  });

  it("секция сертификатов принимается только после принятия каждого сертификата (REV-06, MAN-35)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p11", { role: "expert" });
    await screen.findByRole("heading", { name: "ТОО «Демо Электро Монтаж»" });
    const verify = () => screen.getByRole("button", { name: "Verify section Certificates" });
    expect(verify().hasAttribute("disabled")).toBe(true);
    for (const type of ["ISO 9001", "ISO 14001", "ISO 45001"]) {
      await user.click(screen.getByRole("button", { name: `Verify ${type}` }));
    }
    expect(
      state()
        .profiles.find((p) => p.id === "p11")!
        .sections.certificates.every((c) => c.status === "verified"),
    ).toBe(true);
    expect(state().audit.at(-1)).toMatchObject({ action: "document.verify" });
    await waitFor(() => expect(verify().hasAttribute("disabled")).toBe(false));
    await user.click(verify());
    expect(state().profiles.find((p) => p.id === "p11")!.review.certificates.decision).toBe("verified");
  });

  it("Submit result после решения по всем секциям: есть отклонённая — Returned и одно письмо NOT-05 (REV-07)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p11", {
      role: "expert",
      prepare: (d) => {
        const p = d.profiles.find((x) => x.id === "p11")!;
        for (const c of p.sections.certificates) c.status = "verified";
        for (const doc of p.sections.documents) doc.status = "verified";
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Демо Электро Монтаж»" });
    expect(screen.getByRole("button", { name: "Submit result" }).hasAttribute("disabled")).toBe(true);
    for (const s of ["Shareholders", "Products", "Production", "Certificates", "Documents"]) {
      await user.click(screen.getByRole("button", { name: `Verify section ${s}` }));
    }
    expect(screen.getByText("Sections decided: 8 of 8")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Submit result" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Оргструктура не совпадает/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Submit result" }));

    const p = state().profiles.find((x) => x.id === "p11")!;
    expect(p.status).toBe("returned");
    expect(p.review.personnel.decision).toBe("rejected");
    const mails = state().notifications.filter((n) => n.profileId === "p11" && n.notId === "NOT-05");
    expect(mails).toHaveLength(1);
    expect(mails[0]!.params).toEqual({ result: "returned", rejected: "personnel" });
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.submit_result" });
    expect(await screen.findByText(/Returned: the profile is back with the manufacturer/)).toBeTruthy();
  });

  it("все секции приняты — Verified; при red due diligence профиль не виден операторам (REV-07, IMBC-11, MAN-16)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p11", {
      role: "expert",
      prepare: (d) => {
        const p = d.profiles.find((x) => x.id === "p11")!;
        for (const s of Object.keys(p.review) as (keyof typeof p.review)[]) {
          p.review[s] = {
            decision: "verified",
            comment: null,
            decidedBy: "acc-expert",
            decidedAt: "2026-11-12T10:00:00+05:00",
            changed: false,
          };
        }
      },
    });
    await screen.findByRole("heading", { name: "ТОО «Демо Электро Монтаж»" });
    await user.click(screen.getByRole("button", { name: "Submit result" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Due diligence is red/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Submit result" });
    expect(confirm.hasAttribute("disabled") || confirm.getAttribute("aria-disabled") === "true").toBe(true);
    await user.click(within(dialog).getByRole("checkbox", { name: /I contacted the manufacturer/ }));
    await user.click(within(dialog).getByRole("button", { name: "Submit result" }));

    const p = state().profiles.find((x) => x.id === "p11")!;
    expect(p.status).toBe("verified");
    expect(p.updateStatus).toBe("active");
    expect(state().notifications.at(-1)).toMatchObject({
      profileId: "p11",
      notId: "NOT-05",
      params: { result: "verified" },
    });
    expect(
      await screen.findAllByText(/Due diligence is red: operators and observers do not see this profile/),
    ).toBeTruthy();
  });

  it("ожидающие изменения: принятое заменяет значения, профиль остаётся Verified (REV-08, NOT-28)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p02", { role: "expert" });
    await screen.findByRole("heading", { name: "ТОО «Каспий Демо Сервис»" });
    expect(screen.getByText(/Pending change \(waiting for the SME\)/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verify section Main information" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Accept change Contacts" }));

    const p = state().profiles.find((x) => x.id === "p02")!;
    expect(p.status).toBe("verified");
    expect(p.pendingChanges).toBe(false);
    expect(p.pending.contacts).toBeUndefined();
    expect(p.sections.contacts.map((c) => c.id)).toContain("p02-c4");
    expect(p.review.contacts).toMatchObject({ decision: "verified", changed: false, decidedBy: "acc-expert" });
    expect(state().notifications.at(-1)).toMatchObject({
      profileId: "p02",
      notId: "NOT-05",
      params: { result: "changes", accepted: "contacts", rejected: "" },
    });
    expect(state().audit.at(-1)).toMatchObject({ action: "section.accept_change" });
  });

  it("профиль другого SME и Returned — только просмотр", async () => {
    renderCabinet("/proto/expert/profiles/p10", { role: "expert" });
    await screen.findByRole("heading", { name: "ТОО «Демо Агро Өнім»" });
    expect(screen.getByText(/Returned: the profile is back/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Verify section/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit result" })).toBeNull();
    expect(within(card("Contacts")).getByText(/Телефон focal point не отвечает/)).toBeTruthy();
  });
});

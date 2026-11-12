// Журнал аудита директора (AUD-01, AUD-03): события всех ролей, в том числе только что сделанные другой ролью в
// этом же браузере; фильтры по пользователю, роли, организации, объекту, действию, названию и периоду работают
// вместе, живут в адресе и ничего не пишут (GEN-04).
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AuditEvent, ProtoState } from "@/prototype/data";
import { STORAGE_KEY } from "@/prototype/store";

import { renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

type Actor = AuditEvent["actor"];
const expert: Actor = {
  accountId: "acc-expert",
  email: "expert@imbc.local",
  name: "Эксперт IMBC",
  role: "expert",
  organizationId: "org-imbc",
};
const manufacturer = (organizationId: string): Actor => ({
  accountId: "acc-manufacturer",
  email: "manufacturer@demo.local",
  name: "—",
  role: "manufacturer",
  organizationId,
});
const phrase = (en: string): AuditEvent["summary"] => ({ en, ru: en, kk: en });

/** События, которые пишут кабинеты SME и производителя, — с объектами разного вида. */
function addEvents(draft: ProtoState) {
  const at = "2026-11-12T12:00:00+05:00";
  const add = (action: string, actor: Actor, subject: AuditEvent["subject"], summary: string) =>
    draft.audit.push({ id: `t-${draft.audit.length}`, at, actor, action, subject, summary: phrase(summary) });
  add("profile.submit_result", expert, { type: "profile", id: "p03", label: "result-a" }, "Review result: Verified");
  add("profile.submit_result", expert, { type: "profile", id: "p04", label: "result-b" }, "Review result: Returned");
  add("section.save", manufacturer("org-m01"), { type: "section", id: "p01:main", label: "section-subject" }, "Saved");
  add("document.verify", expert, { type: "document", id: "p02-cert1", label: "document-subject" }, "Doc verified");
  add(
    "tier_record.request",
    manufacturer("org-m01"),
    { type: "tier_record", id: "p03-pl1", label: "product-subject" },
    "AGAR asked",
  );
  add("nda.accept", manufacturer("org-m02"), { type: "nda", id: "nda-2", label: "nda-subject" }, "NDA 2.0 accepted");
  add(
    "notification.read",
    manufacturer("org-m05"),
    { type: "notification", id: "n-01", label: "notification-subject" },
    "Read",
  );
  add(
    "reference.add",
    { ...expert, role: "administrator", accountId: "acc-admin" },
    { type: "reference", id: "regions", label: "reference-subject" },
    "Added",
  );
}

const rows = () => {
  const table = screen.getByRole("columnheader", { name: "What changed" }).closest("table")!;
  return within(table).getAllByRole("row").slice(1);
};

describe("журнал аудита директора", () => {
  it("событие другой роли видно сразу: отметка оператора — первой строкой", async () => {
    // Оператор ставит отметку works-with в том же браузере.
    const operator = renderCabinet("/proto/operator/manufacturers/p03", { role: "operator" });
    await operator.user.click(await screen.findByRole("button", { name: "Mark “works with”" }));
    await operator.user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm" }));
    const event = operator.state().audit.at(-1)!;
    expect(event.action).toBe("works_with.set");
    cleanup();

    const { state } = renderCabinet("/proto/director/audit", { role: "director", keepState: true });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    const total = state().audit.length;
    expect(screen.getByText(`Events: ${total} of ${total}`)).toBeTruthy();
    const first = rows()[0]!;
    expect(within(first).getByText("Специалист оператора")).toBeTruthy();
    expect(within(first).getByText("Operator")).toBeTruthy();
    expect(within(first).getByText("Оператор (демо)")).toBeTruthy();
    expect(within(first).getByText(event.summary.en)).toBeTruthy();
    expect(within(first).getByText("works_with.set")).toBeTruthy();
    expect(within(first).getByRole("link", { name: `Open the dossier: ${event.subject.label}` })).toBeTruthy();
    // Чтение журнала не пишет событие «просмотрено».
    expect(state().audit).toHaveLength(total);
  });

  it("в журнале — решение SME, приглашение администратора и действия производителя", async () => {
    renderCabinet("/proto/director/audit", { role: "director" });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    expect(screen.getByText("Submitted result: Returned")).toBeTruthy();
    expect(screen.getByText("Invited an operator user")).toBeTruthy();
    expect(screen.getByText("Replied to an operator request")).toBeTruthy();
    expect(screen.getByText("Мадина Ержанова")).toBeTruthy();
  });

  it("фильтры работают вместе и живут в адресе, хранилище не меняется", async () => {
    const { user, router, state } = renderCabinet("/proto/director/audit", { role: "director" });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const total = state().audit.length;

    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(await screen.findByRole("option", { name: "IMBC administrator" }));
    expect(router.state.location.search).toContain("role=administrator");
    const admin = state().audit.filter((e) => e.actor.role === "administrator").length;
    expect(screen.getByText(`Events: ${admin} of ${total}`)).toBeTruthy();

    await user.click(screen.getByRole("combobox", { name: "Object" }));
    await user.click(await screen.findByRole("option", { name: "NDA" }));
    expect(rows()).toHaveLength(2);
    expect(screen.getByText("Published NDA version 1.0")).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: "Object name" }), "2.0");
    expect(rows()).toHaveLength(1);
    expect(router.state.location.search).toMatch(/role=administrator.*object=nda.*q=2\.0/);

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText(`Events: ${total} of ${total}`)).toBeTruthy();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    expect(state().audit).toHaveLength(total);
  });

  it("период и пользователь из адреса; ничего не подошло — своё пустое состояние", async () => {
    renderCabinet("/proto/director/audit?from=2026-11-12&to=2026-11-12", { role: "director" });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    // 12.11.2026 по Алматы: блокировка аккаунта и взятие профиля в работу.
    expect(rows()).toHaveLength(2);
    cleanup();

    renderCabinet("/proto/director/audit?who=acc-expert-2", { role: "director" });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    expect(rows()).toHaveLength(1);
    expect(screen.getByText("Submitted result: Returned")).toBeTruthy();
    cleanup();

    const { user } = renderCabinet("/proto/director/audit?role=observer", { role: "director" });
    expect(await screen.findByText("No event matches these filters.")).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Clear filters" }).at(-1)!);
    expect(screen.queryByText("No event matches these filters.")).toBeNull();
  });

  it("пустой журнал отличается от пустого результата фильтра", async () => {
    renderCabinet("/proto/director/audit", {
      role: "director",
      prepare: (draft) => {
        draft.audit = [];
      },
    });
    expect(await screen.findByText("The audit log has no events yet.")).toBeTruthy();
  });

  it("ссылки на досье: секция, документ, продукт, принятие NDA и письмо ведут к своему профилю", async () => {
    renderCabinet("/proto/director/audit", { role: "director", prepare: addEvents });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    const href = (label: string) =>
      screen.getByRole("link", { name: `Open the dossier: ${label}` }).getAttribute("href");
    expect(href("section-subject")).toBe("/proto/director/profiles/p01");
    expect(href("document-subject")).toBe("/proto/director/profiles/p02");
    // Ключ продукта важнее организации того, кто действовал.
    expect(href("product-subject")).toBe("/proto/director/profiles/p03");
    expect(href("nda-subject")).toBe("/proto/director/profiles/p02");
    expect(href("notification-subject")).toBe("/proto/director/profiles/p01");
    // Объект без профиля — без ссылки.
    expect(screen.getByText("reference-subject")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open the dossier: reference-subject" })).toBeNull();
  });

  it("действие с разными фразами подписано нейтрально; варианты — по алфавиту подписи", async () => {
    const { user } = renderCabinet("/proto/director/audit", { role: "director", prepare: addEvents });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    await user.click(screen.getByRole("combobox", { name: "Action" }));
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent ?? "");
    expect(options).toContain("Review result submitted · profile.submit_result");
    expect(options.some((o) => o.startsWith("Review result: "))).toBe(false);
    // Одна фраза у всех событий кода — подпись по ней.
    expect(options).toContain("Saved · section.save");
    const labels = options.slice(1);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    await user.click(screen.getByRole("option", { name: "Review result submitted · profile.submit_result" }));
    // Выбран код целиком: и Verified, и Returned.
    expect(rows()).toHaveLength(2);
  });
});

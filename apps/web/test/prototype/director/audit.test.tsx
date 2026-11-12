// Журнал аудита директора (AUD-01, AUD-03): события всех ролей, в том числе только что сделанные другой ролью в
// этом же браузере; фильтры по пользователю, роли, организации, объекту, действию, названию и периоду работают
// вместе, живут в адресе и ничего не пишут (GEN-04).
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "@/prototype/store";

import { renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

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
});

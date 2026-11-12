// Организации и аккаунты администратора: создание, приглашение, блокировка, смена почты (ADM-01…ADM-06, GEN-05).
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const URL = "/proto/administrator/organizations";

/** Строка таблицы с этим текстом (адрес сеанса есть и в меню пользователя). */
async function rowOf(text: string) {
  const cells = await screen.findAllByText(text);
  return cells.map((cell) => cell.closest("tr")).find((row) => row !== null)!;
}

describe("организации и аккаунты (ADM-01…ADM-06)", () => {
  it("операторы с аккаунтами и последним входом, без запросов к API", async () => {
    const { api } = renderCabinet(URL, { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "Organisations and accounts" })).toBeTruthy();
    expect(screen.getByText("Оператор Б (демо)")).toBeTruthy();
    expect(screen.getByText("zhanar.imanova@operator-b.demo.local")).toBeTruthy();
    expect(within(await rowOf("dauren.mukashev@operator-c.demo.local")).getByText("Never")).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("создаёт организацию оператора с отметкой major operator (ADM-03, GEN-05)", async () => {
    const { user, state } = renderCabinet(URL, { role: "administrator" });
    await user.click(await screen.findByRole("button", { name: "Create organisation" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Organisation name" }), "Оператор Г (демо)");
    await user.click(within(dialog).getByRole("switch", { name: "Major operator" }));
    await user.click(within(dialog).getByRole("button", { name: "Create organisation" }));

    expect(await screen.findByText("Оператор Г (демо)")).toBeTruthy();
    expect(state().organizations.at(-1)).toMatchObject({
      name: "Оператор Г (демо)",
      type: "operator",
      majorOperator: true,
    });
    expect(state().audit.at(-1)).toMatchObject({
      action: "organization.create",
      subject: { type: "organization", label: "Оператор Г (демо)" },
      actor: { role: "administrator" },
    });
  });

  it("создаёт организацию наблюдателя и переходит на её вкладку (ADM-03)", async () => {
    const { user, state } = renderCabinet(URL, { role: "administrator" });
    await user.click(await screen.findByRole("button", { name: "Create organisation" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Organisation name" }), "Наблюдатель 2 (демо)");
    await user.click(within(dialog).getByRole("radio", { name: "Observer" }));
    await user.click(within(dialog).getByRole("button", { name: "Create organisation" }));

    expect(await screen.findByText("Наблюдатель 2 (демо)")).toBeTruthy();
    expect(screen.getByText("Наблюдатель (демо)")).toBeTruthy();
    expect(state().organizations.at(-1)).toMatchObject({ type: "observer", majorOperator: false });
  });

  it("приглашает аккаунт: один аккаунт на адрес (ADM-01, GEN-02)", async () => {
    const { user, state } = renderCabinet(URL, { role: "administrator" });
    const card = (await screen.findByText("Оператор В (демо)")).closest<HTMLElement>("[data-slot=card]")!;
    await user.click(within(card).getByRole("button", { name: "Invite account" }));
    const dialog = await screen.findByRole("alertdialog");
    const email = within(dialog).getByRole("textbox", { name: "Email" });
    await user.type(email, "operator@operator.local");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Новый специалист");
    expect(within(dialog).getByText(/already exists/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Send invitation" }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(email);
    await user.type(email, "new.user@operator-c.demo.local");
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));

    await waitFor(() => expect(within(card).getByText("new.user@operator-c.demo.local")).toBeTruthy());
    expect(within(await rowOf("new.user@operator-c.demo.local")).getByText("Invited")).toBeTruthy();
    expect(state().accounts.at(-1)).toMatchObject({
      organizationId: "org-operator-c",
      role: "operator",
      state: "invited",
    });
    expect(state().audit.at(-1)).toMatchObject({ action: "account.invite", subject: { type: "account" } });
  });

  it("приглашает сотрудника IMBC с выбором роли (ADM-01)", async () => {
    const { user, state } = renderCabinet(`${URL}?type=imbc`, { role: "administrator" });
    await user.click(await screen.findByRole("button", { name: "Invite account" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Email" }), "new.sme@imbc.demo.local");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Новый SME");
    await user.click(within(dialog).getByRole("radio", { name: "IMBC general director" }));
    await user.click(within(dialog).getByRole("button", { name: "Send invitation" }));
    await waitFor(() =>
      expect(state().accounts.at(-1)).toMatchObject({ email: "new.sme@imbc.demo.local", role: "director" }),
    );
  });

  it("блокирует и разблокирует аккаунт; свой аккаунт не блокируется (ADM-02, AUTH-06)", async () => {
    const { user, state } = renderCabinet(URL, { role: "administrator" });
    await user.click(
      within(await rowOf("zhanar.imanova@operator-b.demo.local")).getByRole("button", { name: "Block" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Open sessions of this account end at once/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Block" }));

    expect(await within(await rowOf("zhanar.imanova@operator-b.demo.local")).findByText("Blocked")).toBeTruthy();
    expect(state().accounts.find((a) => a.id === "acc-operator-b")?.state).toBe("blocked");
    expect(state().audit.at(-1)).toMatchObject({ action: "account.block" });

    await user.click(
      within(await rowOf("zhanar.imanova@operator-b.demo.local")).getByRole("button", { name: "Unblock" }),
    );
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unblock" }));
    await waitFor(() => expect(state().accounts.find((a) => a.id === "acc-operator-b")?.state).toBe("active"));
    expect(state().audit.at(-1)).toMatchObject({ action: "account.unblock" });

    await user.click(screen.getByRole("tab", { name: "IMBC" }));
    expect(within(await rowOf("admin@imbc.local")).getByText("Your account")).toBeTruthy();
  });

  it("меняет почту для входа производителя (ADM-05)", async () => {
    const { user, state } = renderCabinet(`${URL}?type=manufacturer`, { role: "administrator" });
    await user.click(
      within(await rowOf("account@company5.demo.local")).getByRole("button", { name: "Change login email" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "New login email" }), "office@company5.demo.local");
    await user.click(within(dialog).getByRole("button", { name: "Change login email" }));

    expect(await screen.findByText("office@company5.demo.local")).toBeTruthy();
    expect(state().accounts.find((a) => a.organizationId === "org-m05")?.email).toBe("office@company5.demo.local");
    expect(state().audit.at(-1)).toMatchObject({ action: "account.change_email", subject: { type: "account" } });
  });

  it("у производителя без аккаунта — ссылка на приглашение перенесённых", async () => {
    renderCabinet(`${URL}?type=manufacturer`, { role: "administrator" });
    expect(within(await rowOf("АО «Пример Кабель»")).getByText("No account yet")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Invite migrated manufacturers" }).getAttribute("href")).toBe(
      "/proto/administrator/migration",
    );
  });

  it("major operator снимается и ставится переключателем (ADM-03)", async () => {
    const { user, state } = renderCabinet(URL, { role: "administrator" });
    const card = (await screen.findByText("Оператор В (демо)")).closest<HTMLElement>("[data-slot=card]")!;
    await user.click(within(card).getByRole("switch", { name: "Major operator" }));
    await waitFor(() =>
      expect(state().organizations.find((o) => o.id === "org-operator-c")?.majorOperator).toBe(false),
    );
    expect(state().audit.at(-1)).toMatchObject({ action: "organization.unmark_major" });
  });

  it("смена почты на тот же адрес не подтверждается (ADM-05)", async () => {
    const { user, state } = renderCabinet(`${URL}?type=manufacturer`, { role: "administrator" });
    const before = state().audit.length;
    await user.click(
      within(await rowOf("account@company5.demo.local")).getByRole("button", { name: "Change login email" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "New login email" }), "ACCOUNT@company5.demo.local");
    expect(within(dialog).getByText("This is the current login email.")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Change login email" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(state().audit).toHaveLength(before);
  });
});

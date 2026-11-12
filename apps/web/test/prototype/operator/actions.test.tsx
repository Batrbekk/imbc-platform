// Действия оператора: меняют общее хранилище, пишут журнал, последствие видно на экране.
// OPR-14, OPR-15, OPR-17, OPR-19, OPR-21, OPR-22, OPR-23, OPR-25, OPR-27, OPR-28, GEN-12.
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "@/prototype/store";

import { renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const ACTOR = { accountId: "acc-operator", role: "operator", organizationId: "org-operator-demo" };

function cardOf(text: string | RegExp): HTMLElement {
  return screen.getByText(text).closest<HTMLElement>("[data-slot=card]")!;
}

describe("отметки и заметки на карточке компании", () => {
  it("works-with: отметка уходит в IMBC и ждёт подтверждения (OPR-19)", async () => {
    const { user, state } = renderCabinet("/proto/operator/manufacturers/p03", { role: "operator" });
    await user.click(await screen.findByRole("button", { name: "Mark “works with”" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm" }));

    const mark = state().worksWithMarks.at(-1)!;
    expect(mark).toMatchObject({
      operatorOrgId: "org-operator-demo",
      profileId: "p03",
      value: true,
      state: "waiting",
      createdBy: "acc-operator",
    });
    expect(state().audit.at(-1)).toMatchObject({ action: "works_with.set", actor: ACTOR });
    expect(await screen.findByText(/Mark set on .*: waiting for IMBC/)).toBeTruthy();
    // Пока изменение ждёт IMBC, нового не отправить.
    expect(screen.getByRole("button", { name: "Mark “works with”" }).hasAttribute("disabled")).toBe(true);
    // Подтверждённых отметок по-прежнему нет: число major operators не растёт (OPR-20).
    expect(screen.getByText("0 of 3")).toBeTruthy();
  });

  it("works-with: снятие подтверждённой отметки тоже ждёт IMBC", async () => {
    const { user, state } = renderCabinet("/proto/operator/manufacturers/p01", { role: "operator" });
    await user.click(await screen.findByRole("button", { name: "Remove the mark" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm" }));
    expect(state().worksWithMarks.at(-1)).toMatchObject({ profileId: "p01", value: false, state: "waiting" });
    expect(state().audit.at(-1)?.action).toBe("works_with.remove");
    expect(await screen.findByText(/Removal on .*: waiting for IMBC/)).toBeTruthy();
  });

  it("отметка визита: дата и файл по желанию, решение IMBC не показывается (OPR-21, IMBC-04)", async () => {
    const { user, state } = renderCabinet("/proto/operator/manufacturers/p03", { role: "operator" });
    const send = await screen.findByRole("button", { name: "Send visit mark" });
    expect(send.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Visit date"), { target: { value: "2099-01-01" } });
    expect(screen.getByText("The visit date cannot be in the future.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Visit date"), { target: { value: "2026-11-01" } });
    await user.click(send);

    expect(state().visitMarks.at(-1)).toMatchObject({
      operatorOrgId: "org-operator-demo",
      profileId: "p03",
      visitedOn: "2026-11-01",
      decision: "waiting",
      createdBy: "acc-operator",
    });
    expect(state().audit.at(-1)?.action).toBe("visit.create");
    expect(await screen.findByText("Sent to IMBC")).toBeTruthy();
    cleanup();

    // Решение IMBC по визиту оператор не видит: принятая отметка выглядит так же.
    renderCabinet("/proto/operator/manufacturers/p01", { role: "operator" });
    await screen.findByText("Sent to IMBC");
    expect(screen.queryByText(/accepted|rejected/i)).toBeNull();
  });

  it("заметка: видна коллеге по организации; удаляет только автор, правок нет (OPR-22, OPR-23)", async () => {
    const { user, state } = renderCabinet("/proto/operator/manufacturers/p01", { role: "operator" });
    await user.type(await screen.findByRole("textbox", { name: "New note" }), "Нужен образец сварного шва");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(state().operatorNotes.at(-1)).toMatchObject({
      operatorOrgId: "org-operator-demo",
      authorId: "acc-operator",
      profileId: "p01",
      text: "Нужен образец сварного шва",
    });
    expect(state().audit.at(-1)?.action).toBe("operator_note.create");
    expect(await screen.findByText("Нужен образец сварного шва")).toBeTruthy();
    // Своих заметок две (opn-01 и новая), заметка коллеги без кнопки удаления.
    expect(within(cardOf("Notes")).getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    cleanup();

    const colleague = renderCabinet("/proto/operator/manufacturers/p01", {
      role: "operator",
      email: "arman.bekov@operator.demo.local",
      keepState: true,
    });
    expect(await screen.findByText("Нужен образец сварного шва")).toBeTruthy();
    const notes = cardOf("Notes");
    expect(within(notes).getAllByRole("button", { name: "Delete" })).toHaveLength(1); // только opn-02
    await colleague.user.click(within(notes).getByRole("button", { name: "Delete" }));
    await colleague.user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(colleague.state().operatorNotes.some((n) => n.id === "opn-02")).toBe(false);
    expect(colleague.state().audit.at(-1)).toMatchObject({
      action: "operator_note.delete",
      actor: { accountId: "acc-operator-2" },
    });
    expect(screen.queryByText("Готовы к аудиту поставщика в декабре.")).toBeNull();
  });
});

describe("запросы", () => {
  it("IMBC request: отправить с компанией и продолжить переписку (OPR-25)", async () => {
    const { user, state } = renderCabinet("/proto/operator/requests?tab=imbc&profile=p03", { role: "operator" });
    await user.type(await screen.findByLabelText("Subject"), "Кабельная продукция для склада");
    await user.type(screen.getByLabelText("Message"), "Есть ли у компании сертификат на огнестойкий кабель?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    const request = state().imbcRequests.at(-1)!;
    expect(request).toMatchObject({
      operatorOrgId: "org-operator-demo",
      senderId: "acc-operator",
      subject: "Кабельная продукция для склада",
      profileId: "p03",
      status: "open",
    });
    expect(state().audit.at(-1)?.action).toBe("imbc_request.send");
    const card = cardOf("Кабельная продукция для склада");
    expect(within(card).getByText(/АО «Пример Кабель»/)).toBeTruthy();
    expect(within(card).getByText("Waiting for IMBC's reply.")).toBeTruthy();

    // Ответ SME в закрытой переписке виден; продолжить можно открытую.
    const answered = cardOf("Сроки site survey");
    expect(within(answered).getByText(/визит 15 октября/)).toBeTruthy();
    expect(within(answered).queryByRole("button", { name: "Continue the thread" })).toBeNull();

    const open = cardOf("Сертификаты ISO у производителя арматуры");
    await user.type(within(open).getByRole("textbox"), "Нужна и копия сертификата.");
    await user.click(within(open).getByRole("button", { name: "Continue the thread" }));
    expect(
      state()
        .imbcRequests.find((r) => r.id === "ir-01")!
        .messages.at(-1),
    ).toMatchObject({
      authorId: "acc-operator",
      text: "Нужна и копия сертификата.",
    });
    expect(state().audit.at(-1)?.action).toBe("imbc_request.reply");
    expect(await within(open).findByText("Нужна и копия сертификата.")).toBeTruthy();
  });

  it("operator request: секция профиля, производитель не узнаёт, кто спросил; ответ виден (OPR-27–OPR-29)", async () => {
    const { user, state } = renderCabinet("/proto/operator/requests?tab=operator&profile=p03", { role: "operator" });
    expect(await screen.findByText(/The manufacturer is not told which operator asked/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("combobox", { name: "Profile section" }));
    await user.click(await screen.findByRole("option", { name: "Certificates" }));
    await user.click(send);

    expect(state().operatorRequests.at(-1)).toMatchObject({
      operatorOrgId: "org-operator-demo",
      senderId: "acc-operator",
      profileId: "p03",
      section: "certificates",
      reply: null,
      status: "open",
    });
    expect(state().audit.at(-1)?.action).toBe("operator_request.send");
    // Новый запрос — первым (сначала новые); у or-01 та же секция.
    const card = screen.getAllByText("Section: Certificates")[0]!.closest<HTMLElement>("[data-slot=card]")!;
    expect(within(card).getByText("АО «Пример Кабель»")).toBeTruthy();
    expect(within(card).getByText("No reply yet.")).toBeTruthy();
    // Ответ производителя на прежний запрос.
    expect(screen.getByText("Сертификат обновлён в профиле, действует до 2028 года.")).toBeTruthy();
  });
});

describe("выгрузка и подписки", () => {
  it("выгрузка текущего поиска пишет историю организации и журнал (OPR-14)", async () => {
    const { user, state } = renderCabinet("/proto/operator/export?group=B", { role: "operator" });
    await screen.findByText(/Found: \d+ manufacturers/);
    await user.click(screen.getByRole("radio", { name: "CSV" }));
    await user.click(screen.getByRole("button", { name: "Company: None" }));
    await user.click(screen.getByRole("button", { name: "Build file" }));

    const record = state().exportRecords.at(-1)!;
    expect(record).toMatchObject({
      operatorOrgId: "org-operator-demo",
      userId: "acc-operator",
      format: "csv",
      filters: "group=B",
    });
    expect(record.rows).toBeGreaterThan(0);
    expect(state().audit.at(-2)).toMatchObject({
      action: "export.create",
      summary: { en: expect.stringContaining("CSV") },
    });
    // Скачивание собранного файла — своё событие журнала (AUD-01).
    expect(state().audit.at(-1)).toMatchObject({ action: "export.download", actor: ACTOR });
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/imbc-export-.*\.csv is ready/);
    expect(screen.getAllByText("Group B").length).toBeGreaterThan(0);
  });

  it("поиск из двух слов с пробелом набирается как есть и находит компанию (OPR-14)", async () => {
    const { user } = renderCabinet("/proto/operator/export", { role: "operator" });
    const field = await screen.findByLabelText("Name or BIN");
    await user.type(field, "Демо Насос");
    expect((field as HTMLInputElement).value).toBe("Демо Насос");
    expect(screen.getByText(/Found: 1 manufacturers/)).toBeTruthy();
    expect(screen.getByText("ТОО «Демо Насос Завод»")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build file" }).hasAttribute("disabled")).toBe(false);
  });

  it("без колонок файл не собирается", async () => {
    const { user } = renderCabinet("/proto/operator/export", { role: "operator" });
    await screen.findByText(/Found: \d+ manufacturers/);
    for (const group of ["Company", "Focal point", "Activity and product", "Production", "Personnel", "Checks"]) {
      await user.click(screen.getByRole("button", { name: `${group}: None` }));
    }
    expect(screen.getByText("Choose at least one column.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Build file" }).hasAttribute("disabled")).toBe(true);
  });

  it("подписка на сохранённый поиск: создать, приостановить, удалить (OPR-15, OPR-17)", async () => {
    const { user, state } = renderCabinet("/proto/operator/subscriptions?group=C", { role: "operator" });
    expect(await screen.findByText("Group C")).toBeTruthy();
    // Письмо — только на email своего аккаунта из демо-данных (OPR-16).
    expect(within(screen.getByRole("main")).getByText(/operator@operator\.local/)).toBeTruthy();
    await user.type(screen.getByLabelText("Name"), "Кабель, ежемесячно");
    await user.click(screen.getByRole("combobox", { name: "Period" }));
    await user.click(await screen.findByRole("option", { name: "Monthly" }));
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(state().exportSubscriptions.at(-1)).toMatchObject({
      operatorOrgId: "org-operator-demo",
      userId: "acc-operator",
      name: "Кабель, ежемесячно",
      filters: "group=C",
      period: "monthly",
      paused: false,
    });
    expect(state().audit.at(-1)?.action).toBe("subscription.create");

    const card = cardOf("Кабель, ежемесячно");
    await user.click(within(card).getByRole("button", { name: "Pause" }));
    expect(state().exportSubscriptions.at(-1)!.paused).toBe(true);
    expect(state().audit.at(-1)?.action).toBe("subscription.pause");
    expect(within(cardOf("Кабель, ежемесячно")).getByText("Paused")).toBeTruthy();

    await user.click(within(cardOf("Кабель, ежемесячно")).getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    expect(state().exportSubscriptions.some((s) => s.name === "Кабель, ежемесячно")).toBe(false);
    expect(state().audit.at(-1)?.action).toBe("subscription.delete");
    expect(screen.queryByText("Кабель, ежемесячно")).toBeNull();
  });

  it("скачивание файла подписки пишет журнал (AUD-01)", async () => {
    const { user, state } = renderCabinet("/proto/operator/subscriptions", { role: "operator" });
    await screen.findByText("Арматура, еженедельно");
    const card = cardOf("Арматура, еженедельно");
    await user.click(within(card).getAllByRole("button", { name: "Download" })[0]!);
    expect(state().audit.at(-1)).toMatchObject({
      action: "subscription.download",
      subject: { type: "subscription", id: "sub-01" },
      actor: ACTOR,
    });
  });

  it("подписки только свои: коллега по организации чужих не видит (раздел 4: own only)", async () => {
    renderCabinet("/proto/operator/subscriptions", { role: "operator", email: "arman.bekov@operator.demo.local" });
    expect(await screen.findByText("You have no subscriptions.")).toBeTruthy();
    expect(screen.queryByText("Арматура, еженедельно")).toBeNull();
  });
});

describe("сеанс не из демо-данных", () => {
  it("email сеанса не попадает ни в записи модуля, ни в журнал", async () => {
    const email = "someone@real.example";
    const { user } = renderCabinet("/proto/operator/manufacturers/p03", { role: "operator", email });
    await user.type(await screen.findByRole("textbox", { name: "New note" }), "Заметка с реального входа");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    await user.click(screen.getByRole("button", { name: "Mark “works with”" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm" }));
    cleanup();
    const exp = renderCabinet("/proto/operator/export", { role: "operator", email, keepState: true });
    await exp.user.click(await screen.findByRole("button", { name: "Build file" }));
    cleanup();
    const sub = renderCabinet("/proto/operator/subscriptions", { role: "operator", email, keepState: true });
    await sub.user.type(await screen.findByLabelText("Name"), "Всё");
    await sub.user.click(screen.getByRole("button", { name: "Subscribe" }));
    // Оболочка показывает сеанс в меню пользователя; экраны модуля — нет.
    expect(within(screen.getByRole("main")).queryByText(new RegExp(email))).toBeNull();

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as Record<string, unknown>;
    expect(JSON.stringify(stored.operatorNotes)).toContain("Заметка с реального входа");
    // Ни в записях модуля, ни в журнале: действует демо-персона роли.
    expect(JSON.stringify(stored)).not.toContain(email);
    expect((stored.audit as { actor: unknown }[]).at(-1)?.actor).toMatchObject(ACTOR);
  });
});

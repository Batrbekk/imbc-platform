// Кабинет производителя: актуальность, запросы операторов, прогноз и STR/KTRE, тир и AGAR, письма.
// UPD-02, UPD-05, GEN-11, OPR-28, OPR-29, FC-01, FC-03, FC-04, FC-06, FC-08, IMBC-20, IMBC-22, IMBC-25, NOT-32.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialState, type ProtoState } from "@/prototype/data";
import { resetViewAs } from "@/prototype/manufacturer/view-as";
import { STORAGE_KEY } from "@/prototype/store";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  resetViewAs();
});

/** Всё, что называет оператора: организации и аккаунты операторов из общих данных (GEN-11). */
const OPERATOR_NAMES = (() => {
  const data = createInitialState();
  const orgs = data.organizations.filter((o) => o.type === "operator");
  const people = data.accounts.filter((a) => a.role === "operator" || orgs.some((o) => o.id === a.organizationId));
  return [...orgs.map((o) => o.name), ...people.flatMap((a) => [a.fullName, a.email, a.email.split("@")[1]!])];
})();

function expectNoOperatorNamed() {
  const text = document.body.textContent ?? "";
  for (const name of OPERATOR_NAMES) expect(text).not.toContain(name);
}

describe("кабинет производителя: запросы операторов", () => {
  it("входящие запросы без названия оператора (GEN-11, OPR-28)", async () => {
    const { api } = renderCabinet("/proto/manufacturer/requests", { role: "manufacturer" });
    expect(await screen.findByRole("heading", { level: 1, name: "Operator requests" })).toBeTruthy();
    expect(screen.getByText("Какой максимальный пролёт модульных конструкций вы изготавливаете?")).toBeTruthy();
    expect(screen.getByText("Уточните загрузку цехов на первый квартал.")).toBeTruthy();
    expect(screen.getAllByText("An operator").length).toBe(3);
    expectNoOperatorNamed();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("один ответ на запрос: запись, журнал, запрос закрыт (OPR-29)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/requests", { role: "manufacturer" });
    const card = (await screen.findByText(/максимальный пролёт/)).closest("[data-slot=card]") as HTMLElement;
    await user.type(within(card).getByRole("textbox", { name: "Your reply" }), "До 36 метров без промежуточных опор.");
    await user.click(within(card).getByRole("button", { name: "Send reply" }));

    const request = state().operatorRequests.find((r) => r.id === "or-02")!;
    expect(request.reply).toMatchObject({ text: "До 36 метров без промежуточных опор.", authorId: "acc-manufacturer" });
    expect(request.status).toBe("closed");
    expect(state().audit.at(-1)).toMatchObject({ action: "operator_request.reply" });
    expect(await within(card).findByText("До 36 метров без промежуточных опор.")).toBeTruthy();
    expect(within(card).queryByRole("textbox", { name: "Your reply" })).toBeNull();
  });

  it("сеанс с настоящим адресом: адрес не попадает в записи модуля", async () => {
    const email = "someone@real.example";
    const { user, state } = renderCabinet("/proto/manufacturer/requests", { role: "manufacturer", email });
    const card = (await screen.findByText(/максимальный пролёт/)).closest("[data-slot=card]") as HTMLElement;
    await user.type(within(card).getByRole("textbox", { name: "Your reply" }), "Ответ.");
    await user.click(within(card).getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(state().operatorRequests.find((r) => r.id === "or-02")!.reply).not.toBeNull());

    // Ни в одной записи хранилища, включая журнал, адреса сеанса нет.
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain(email);
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toContain("real.example");
  });
});

describe("кабинет производителя: актуальность", () => {
  it("active: одно подтверждение пишет журнал и сдвигает квартал (UPD-02)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/update-status", { role: "manufacturer" });
    expect(await screen.findByRole("heading", { level: 1, name: "Update status" })).toBeTruthy();
    const before = state().profiles.find((p) => p.id === "p01")!.lastConfirmedAt;
    await user.click(screen.getByRole("button", { name: "Confirm data is current" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm data is current" }),
    );
    await waitFor(() => expect(state().profiles.find((p) => p.id === "p01")!.lastConfirmedAt).not.toBe(before));
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.confirm_current" });
  });

  it("unresponsive: подтверждение каждой секции, последняя возвращает active (UPD-05)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/update-status?as=p04", { role: "manufacturer" });
    expect(await screen.findByText(/Confirmed: 0 of 8/)).toBeTruthy();
    const sections = ["Main information", "Contacts", "Personnel", "Shareholders", "Products", "Production"];
    for (const s of [...sections, "Certificates"]) {
      await user.click(screen.getByRole("button", { name: `Confirm section ${s}` }));
    }
    expect(state().profiles.find((p) => p.id === "p04")!.updateStatus).toBe("unresponsive");
    expect(screen.getByText(/Confirmed: 7 of 8/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm section Documents" }));
    await waitFor(() => expect(state().profiles.find((p) => p.id === "p04")!.updateStatus).toBe("active"));
    expect(state().audit.filter((e) => e.action === "section.confirm_current")).toHaveLength(8);
  });

  it("не Verified — статуса актуальности нет", async () => {
    renderCabinet("/proto/manufacturer/update-status?as=p12", { role: "manufacturer" });
    expect(await screen.findByText(/Update status applies once the profile is Verified/)).toBeTruthy();
  });
});

describe("кабинет производителя: прогноз, STR и KTRE", () => {
  it("Verified с текущей NDA видит весь прогноз, фильтр по началу ТН ВЭД, без скачивания (FC-04, FC-06)", async () => {
    const { user } = renderCabinet("/proto/manufacturer/forecast", { role: "manufacturer" });
    expect(await screen.findByRole("heading", { level: 1, name: "Demand forecast" })).toBeTruthy();
    expect(screen.getByText("Release 2", { selector: "[data-slot=badge]" })).toBeTruthy();
    expect(screen.getByText(/cannot be downloaded or printed/)).toBeTruthy();
    expect(screen.getByText("Lines shown: 16 of 16")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /download|print/i })).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "TN VED prefix" }), "8481");
    expect(screen.getByText("Lines shown: 2 of 16")).toBeTruthy();
    expect(screen.getByText("Краны шаровые DN50 PN40")).toBeTruthy();
  });

  it("новая версия NDA закрывает раздел до принятия (FC-03)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/forecast?as=p02", { role: "manufacturer" });
    expect(await screen.findByText("Accept NDA 2.0")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    const accept = screen.getByRole("button", { name: "Accept and open" });
    expect(accept.hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /I accept NDA 2.0/ }));
    await user.click(accept);
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(state().profiles.find((p) => p.id === "p02")!.nda?.versionId).toBe("nda-2");
    expect(state().audit.at(-1)).toMatchObject({ action: "nda.accept" });
  });

  it("не Verified — прогноз закрыт (FC-01)", async () => {
    renderCabinet("/proto/manufacturer/forecast?as=p10", { role: "manufacturer" });
    expect(await screen.findByText(/opens once IMBC has verified your profile/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("STR и KTRE — по группам и продуктам, просмотр без скачивания (FC-08)", async () => {
    const { user, api } = renderCabinet("/proto/manufacturer/technical-requirements", { role: "manufacturer" });
    expect(await screen.findByRole("heading", { level: 1, name: "STR and KTRE" })).toBeTruthy();
    expect(screen.getByText(/not an operator's catalogue/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open KTRE: Кабель силовой 1 кВ" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/view only, no download or print/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Zoom in" }));
    expect(within(dialog).getByText("125 %")).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });
});

describe("кабинет производителя: тир и AGAR", () => {
  it("свой тир и статус AGAR; запрос site survey без продукта (IMBC-20, IMBC-22)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/tier", { role: "manufacturer" });
    expect(await screen.findByRole("heading", { level: 1, name: "Tier and AGAR" })).toBeTruthy();
    expect(screen.getByText("Tier 2")).toBeTruthy();
    expect(screen.getByText("Report issued")).toBeTruthy();
    expect(screen.getByText("Tier 3")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Request a site survey" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Request a site survey" }),
    );
    expect(state().siteSurveyRequests.some((r) => r.profileId === "p01" && r.status === "open")).toBe(true);
    expect(await screen.findByText(/Site survey requested/)).toBeTruthy();
  });

  it("AGAR запрашивается только для продукта со STR (IMBC-25)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/tier?as=p03", { role: "manufacturer" });
    await user.click(await screen.findByRole("button", { name: "Request AGAR" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Request AGAR" }));
    expect(state().tierRecords.find((r) => r.profileId === "p03")).toMatchObject({
      kind: "agar",
      status: "requested",
      requestedByManufacturer: true,
    });
    expect(await screen.findByText("Requested")).toBeTruthy();
    cleanup();
    resetViewAs();

    // У продукта нет записи и нет STR: запрос не принимается.
    renderCabinet("/proto/manufacturer/tier", {
      role: "manufacturer",
      prepare: (d) => {
        d.tierRecords = d.tierRecords.filter((r) => r.profileId !== "p01");
        d.techFiles = d.techFiles.filter((f) => f.tnved !== "7308909809");
      },
    });
    expect(await screen.findByText(/No STR for this product/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Request AGAR" })).toBeNull();
  });
});

describe("кабинет производителя: уведомления", () => {
  const withResult = (params: Record<string, string>) => (d: ProtoState) => {
    d.notifications = [
      {
        id: "n-x",
        profileId: "p01",
        notId: "NOT-05",
        at: "2026-11-12T12:00:00+05:00",
        recipients: ["account"],
        params,
        read: false,
      },
    ];
  };

  it("NOT-05 по правкам: принятые и отклонённые с комментарием, без «возвращён» (NOT-28)", async () => {
    renderCabinet("/proto/manufacturer/notifications", {
      role: "manufacturer",
      prepare: withResult({
        result: "changes",
        accepted: "contacts,products",
        rejected: "personnel",
        "comment.personnel": "Численность не подтверждена.",
      }),
    });
    expect(await screen.findByText(/IMBC decided on your pending changes/)).toBeTruthy();
    expect(screen.getByText("Accepted: Contacts, Products")).toBeTruthy();
    expect(screen.getByText("Personnel")).toBeTruthy();
    expect(screen.getByText(/Численность не подтверждена\./)).toBeTruthy();
    expect(screen.queryByText(/returned/i)).toBeNull();
  });

  it("NOT-05 о возврате: отклонённые секции с комментариями (NOT-27); старая запись без списка", async () => {
    renderCabinet("/proto/manufacturer/notifications", {
      role: "manufacturer",
      prepare: (d) => {
        withResult({ result: "returned", rejected: "contacts,certificates", "comment.contacts": "Нет телефона." })(d);
        d.notifications.push({ ...d.notifications[0]!, id: "n-y", params: { result: "returned" } });
      },
    });
    expect((await screen.findAllByText(/IMBC returned your profile/)).length).toBe(2);
    expect(screen.getByText("Contacts")).toBeTruthy();
    expect(screen.getByText("Certificates")).toBeTruthy();
    expect(screen.getByText(/Нет телефона\./)).toBeTruthy();
  });

  it("письма производителю, запрос оператора без его названия, отметка о прочтении (NOT-32)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/notifications", { role: "manufacturer" });
    expect(await screen.findByRole("heading", { level: 1, name: "Notifications" })).toBeTruthy();
    expect(screen.getByText("Review result")).toBeTruthy();
    expect(screen.getAllByText("An operator sent a request")).toHaveLength(3);
    expect(screen.getByText("Уточните загрузку цехов на первый квартал.")).toBeTruthy();
    expectNoOperatorNamed();
    const unread = screen.getAllByRole("button", { name: "Mark as read" });
    expect(unread).toHaveLength(3);
    await user.click(unread[0]!);
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Mark as read" })).toHaveLength(2));
    expect(state().audit.at(-1)).toMatchObject({ action: "notification.read" });
  });

  it("ответ сохраняется в браузере и виден после повторного входа", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/requests", { role: "manufacturer" });
    const card = (await screen.findByText(/загрузку цехов/)).closest("[data-slot=card]") as HTMLElement;
    await user.type(within(card).getByRole("textbox", { name: "Your reply" }), "Загрузка 70 %.");
    await user.click(within(card).getByRole("button", { name: "Send reply" }));
    await waitFor(() => expect(state().operatorRequests.find((r) => r.id === "or-03")!.reply).not.toBeNull());
    cleanup();
    renderCabinet("/proto/manufacturer/requests", { role: "manufacturer", keepState: true });
    expect(await screen.findByText("Загрузка 70 %.")).toBeTruthy();
  });
});

// Кабинет SME: отметки операторов, запросы, запросы производителей; адрес сеанса не попадает в хранилище
// (IMBC-04, IMBC-16, IMBC-17, IMBC-18, IMBC-20, OPR-20).
import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { worksWithCount } from "@/prototype/rules";
import { STORAGE_KEY } from "@/prototype/store";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

describe("кабинет SME: отметки и запросы", () => {
  it("подтверждение works-with засчитывается в число major operators; решение по визиту (IMBC-16, IMBC-04)", async () => {
    const { user, state, api } = renderCabinet("/proto/expert/marks", { role: "expert" });
    expect(await screen.findByRole("heading", { name: "Operator marks" })).toBeTruthy();
    expect(worksWithCount(state(), "p02")).toBe(0);
    await user.click(screen.getByRole("button", { name: "Validate ТОО «Каспий Демо Сервис» · Оператор (демо)" }));
    expect(state().worksWithMarks.find((m) => m.id === "ww-02")).toMatchObject({
      state: "validated",
      decidedBy: "acc-expert",
    });
    expect(worksWithCount(state(), "p02")).toBe(1);
    expect(state().audit.at(-1)).toMatchObject({
      action: "works_with.validate",
      summary: { ru: "Подтвердил изменение «works with» от Оператор (демо)" },
    });

    // Снятие отметки, подтверждённое SME, убирает организацию из «кто с кем работает».
    expect(worksWithCount(state(), "p08")).toBe(0);
    await user.click(screen.getByRole("button", { name: "Reject ТОО «Демо Насос Завод» · Оператор (демо)" }));
    expect(state().visitMarks.find((v) => v.id === "visit-06")).toMatchObject({
      decision: "rejected",
      decidedBy: "acc-expert",
    });
    const who = screen
      .getByText("Who works with whom", { selector: "[data-slot=card-title]" })
      .closest("[data-slot=card]") as HTMLElement;
    expect(within(who).getByText("ТОО «Каспий Демо Сервис»")).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("IMBC request: ответ в переписке и закрытие (IMBC-17)", async () => {
    const { user, state } = renderCabinet("/proto/expert/requests", { role: "expert" });
    expect(await screen.findByText("Подтвердите, пожалуйста, что ISO 45001 у компании действующий.")).toBeTruthy();
    expect(screen.getByText("From Специалист оператора, Оператор (демо)", { exact: false })).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Your message" }), "Да, ISO 45001 действует до 2028 года.");
    await user.click(screen.getByRole("button", { name: "Send reply" }));
    const request = state().imbcRequests.find((r) => r.id === "ir-01")!;
    expect(request.messages.at(-1)).toMatchObject({
      authorId: "acc-expert",
      text: "Да, ISO 45001 действует до 2028 года.",
    });
    expect(await screen.findByText("Да, ISO 45001 действует до 2028 года.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Close request" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Close request" }));
    expect(state().imbcRequests.find((r) => r.id === "ir-01")!.status).toBe("closed");
    expect(state().audit.at(-1)).toMatchObject({ action: "imbc_request.close" });
  });

  it("operator requests и заметки всех операторов видны SME с названием организации (IMBC-18)", async () => {
    renderCabinet("/proto/expert/requests?tab=operator", { role: "expert" });
    expect(await screen.findByText("Уточните загрузку цехов на первый квартал.")).toBeTruthy();
    expect(screen.getByText("Да, исполнение для кислых сред — по запросу.")).toBeTruthy();
    expect(screen.getAllByText("Оператор Б (демо)").length).toBeGreaterThan(0);
    cleanup();
    renderCabinet("/proto/expert/requests?tab=notes", { role: "expert" });
    expect(await screen.findByText("Насосы прошли входной контроль организации Б.")).toBeTruthy();
  });

  it("запросы производителей: site survey и AGAR в списке SME (IMBC-20, IMBC-25)", async () => {
    const { user, state } = renderCabinet("/proto/expert/manufacturer-requests", { role: "expert" });
    expect(await screen.findByRole("heading", { name: "Manufacturer requests" })).toBeTruthy();
    expect(screen.getByText("ТОО «Демо Насос Завод»")).toBeTruthy(); // AGAR requested p06
    const links = screen.getAllByRole("link", { name: "AGAR" }).map((a) => a.getAttribute("href"));
    expect(links).toContain("/proto/expert/profiles/p06?tab=tiers");
    await user.click(screen.getByRole("button", { name: "Mark request done" }));
    expect(state().siteSurveyRequests.find((r) => r.id === "ssr-03")!.status).toBe("done");
  });

  it("сеанс не из демо-данных: его адрес не попадает в хранилище, журнал включительно", async () => {
    const email = "someone@real.example";
    const first = renderCabinet("/proto/expert/profiles/p04?tab=notes", { role: "expert", email });
    const { user, state } = first;
    await user.type(await screen.findByRole("textbox", { name: "Note text" }), "Заметка с чужого сеанса");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(state().imbcNotes.at(-1)!.authorId).toBe("acc-expert");
    cleanup();
    const second = renderCabinet("/proto/expert/marks", { role: "expert", email, keepState: true });
    await second.user.click(
      await screen.findByRole("button", { name: "Validate ТОО «Каспий Демо Сервис» · Оператор (демо)" }),
    );
    expect(second.state().worksWithMarks.find((m) => m.id === "ww-02")!.decidedBy).toBe("acc-expert");

    // Всё сохранённое состояние, журнал включительно: адреса сеанса нет нигде.
    const stored = window.localStorage.getItem(STORAGE_KEY)!;
    expect(stored).toContain("Заметка с чужого сеанса");
    expect(stored).not.toContain(email);
  });
});

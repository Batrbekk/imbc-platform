// Кабинет SME: профили в работе, «взять в работу», открытие досье (REV-01, REV-02, REV-04), права раздела 4.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

describe("кабинет SME: профили в работе", () => {
  it("очередь: Submitted, Under review и ожидающие изменения, без запросов к /api/v1 (REV-04)", async () => {
    const { api } = renderCabinet("/proto/expert/profiles", { role: "expert" });
    expect(await screen.findByRole("heading", { name: "Profiles in work" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ТОО «Жаңа Демо Құрылыс»" })).toBeTruthy(); // p09 submitted
    expect(screen.getByRole("link", { name: "ТОО «Демо Электро Монтаж»" })).toBeTruthy(); // p11 under review
    expect(screen.getByRole("link", { name: "ТОО «Каспий Демо Сервис»" })).toBeTruthy(); // p02 pending changes
    expect(screen.queryByRole("link", { name: "ТОО «Демо Жоба»" })).toBeNull(); // p12 draft — не в очереди
    expect(screen.getByRole("link", { name: "Profiles in work" })).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("SME видит все профили, в том числе невидимые операторам (раздел 4)", async () => {
    renderCabinet("/proto/expert/profiles?scope=all", { role: "expert" });
    await screen.findByRole("heading", { name: "Profiles in work" });
    expect(screen.getByText("Profiles: 12")).toBeTruthy();
    // Draft и red due diligence — не видны операторам, но есть у SME.
    const draft = screen.getByRole("link", { name: "ТОО «Демо Жоба»" }).closest("tr")!;
    expect(within(draft).getByText("No")).toBeTruthy();
    const red = screen.getByRole("link", { name: "ТОО «Демо Электро Монтаж»" }).closest("tr")!;
    expect(within(red).getByText("Red")).toBeTruthy();
  });

  it("«Взять в работу» назначает профиль себе, открытие делает его Under review (REV-01, REV-02)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles", { role: "expert" });
    await user.click(await screen.findByRole("button", { name: "Take ТОО «Жаңа Демо Құрылыс»" }));
    expect(state().profiles.find((p) => p.id === "p09")!.assignedExpertId).toBe("acc-expert");
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.take", subject: { id: "p09" } });
    expect(screen.queryByRole("button", { name: "Take ТОО «Жаңа Демо Құрылыс»" })).toBeNull();

    await user.click(screen.getByRole("link", { name: "ТОО «Жаңа Демо Құрылыс»" }));
    await waitFor(() => expect(state().profiles.find((p) => p.id === "p09")!.status).toBe("under_review"));
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.open_review" });
    expect(state().audit.filter((e) => e.action === "profile.open_review")).toHaveLength(1);
  });

  it("досье несуществующего профиля — «не найдено» со ссылкой назад", async () => {
    renderCabinet("/proto/expert/profiles/p99", { role: "expert" });
    expect(await screen.findByRole("heading", { name: "Profile not found" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Back to profiles" }).length).toBeGreaterThan(0);
  });

  it("досье на казахском и русском: меню и вкладки своего языка", async () => {
    renderCabinet("/proto/expert/profiles/p01?tab=due-diligence", { role: "expert", locale: "kk" });
    expect(await screen.findByRole("link", { name: "Жұмыстағы профильдер" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Тирлер және AGAR" })).toBeTruthy();
    cleanup();
    renderCabinet("/proto/expert/profiles/p01?tab=site-survey", { role: "expert", locale: "ru" });
    expect(await screen.findByRole("link", { name: "Профили в работе" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Записать site survey" })).toBeTruthy();
  });

  it("другая роль не открывает кабинет SME", async () => {
    const { router } = renderCabinet("/proto/expert/profiles", {
      role: "operator",
      api: { "GET /api/v1/dashboard": { status: 500 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByText("Profiles in work")).toBeNull();
  });
});

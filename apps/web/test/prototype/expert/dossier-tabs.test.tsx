// Кабинет SME: site survey, AGAR и CDP, внешние проверки, заметки IMBC, операторы в досье
// (IMBC-01, IMBC-02, IMBC-15, IMBC-20, IMBC-23, IMBC-24, EXT-02).
import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { isSiteSurveyed, profileTier } from "@/prototype/rules";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

describe("кабинет SME: вкладки досье", () => {
  it("site survey: запись с отчётом даёт tier 2, запрос производителя закрывается отдельно (IMBC-01, IMBC-20)", async () => {
    const { user, state, api } = renderCabinet("/proto/expert/profiles/p03?tab=site-survey", { role: "expert" });
    expect(await screen.findByText("Not site surveyed")).toBeTruthy();
    expect(screen.getByText("Производство на реконструкции.")).toBeTruthy();
    const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    await user.type(input("Visit from"), "2026-11-10");
    await user.type(input("Visit to"), "2026-11-11");
    await user.upload(
      screen.getByLabelText("Signed report"),
      new File(["x"], "p03-survey.pdf", { type: "application/pdf" }),
    );
    await user.type(input("Expiry date"), "2028-11-10");
    await user.click(screen.getByRole("button", { name: "Record site survey" }));

    const record = state().siteSurveys.at(-1)!;
    expect(record).toMatchObject({
      profileId: "p03",
      visitFrom: "2026-11-10",
      visitTo: "2026-11-11",
      result: true,
      expiresOn: "2028-11-10",
      recordedBy: "acc-expert",
    });
    expect(record.report?.name).toBe("p03-survey.pdf");
    expect(isSiteSurveyed(state(), "p03")).toBe(true);
    expect(
      profileTier(
        state(),
        state().profiles.find((p) => p.id === "p03")!,
      ),
    ).toBe("tier_2");
    expect(await screen.findByText("Site surveyed")).toBeTruthy();
    // Запрос не закрывается записью (IMBC-20).
    expect(state().siteSurveyRequests.find((r) => r.id === "ssr-03")!.status).toBe("open");
    await user.click(screen.getByRole("button", { name: "Mark request done" }));
    expect(state().siteSurveyRequests.find((r) => r.id === "ssr-03")!.status).toBe("done");
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("AGAR: requested по запросу производителя переводится дальше по порядку (IMBC-24)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p06?tab=tiers", { role: "expert" });
    expect(await screen.findByText("Requested by the manufacturer")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Set: Shortlisted: Насосы центробежные" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(state().tierRecords.find((r) => r.id === "agar-06")).toMatchObject({
      status: "shortlisted",
      updatedBy: "acc-expert",
    });
    expect(state().audit.at(-1)).toMatchObject({
      action: "tier_record.status",
      summary: { en: "Set the AGAR or CDP status: Shortlisted" },
    });
  });

  it("AGAR без запроса: шорт-лист нового AGAR; report issued требует файл и даёт tier 3 (IMBC-21, IMBC-23)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p03?tab=tiers", {
      role: "expert",
      prepare: (d) => {
        d.tierRecords.push({
          id: "agar-x",
          profileId: "p03",
          productId: "p03-pl1",
          kind: "agar",
          status: "technical_assessment_done",
          report: null,
          comment: null,
          requestedByManufacturer: false,
          updatedAt: "2026-11-01T10:00:00+05:00",
          updatedBy: "acc-expert",
        });
      },
    });
    await screen.findByText("AGAR and CDP by product");
    await user.click(screen.getByRole("button", { name: "Set: Report issued: Кабель силовой 1 кВ" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    expect(confirm.hasAttribute("disabled") || confirm.getAttribute("aria-disabled") === "true").toBe(true);
    await user.upload(
      within(dialog).getByLabelText("Report"),
      new File(["x"], "agar.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(state().tierRecords.find((r) => r.id === "agar-x")).toMatchObject({
      status: "report_issued",
      report: { name: "agar.pdf" },
    });
    expect(await screen.findByText("Tier 3")).toBeTruthy();
  });

  it("внешние проверки: имитация всех коннекторов, заглушки — тестовые данные (EXT-02, EXT-04)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p02?tab=checks", { role: "expert" });
    expect(await screen.findByText(/Simulated run: Adata is not called; mock connectors/)).toBeTruthy();
    const before = state().externalChecks.length;
    await user.click(screen.getByRole("button", { name: "Run the checks (simulated)" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Run the checks (simulated)" }),
    );
    const added = state().externalChecks.slice(before);
    expect(added.map((c) => c.connector).sort()).toEqual(["accounting", "adata", "e_ondiris", "legal_registry"]);
    expect(added.find((c) => c.connector === "accounting")!.status).toBe("unavailable");
    expect(added.find((c) => c.connector === "legal_registry")!.testData).toBe(true);
    expect(screen.getAllByText("Service unavailable").length).toBeGreaterThan(1);
  });

  it("заметки IMBC: список с полями из Excel и новая заметка с автором (IMBC-15)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p04?tab=notes", { role: "expert" });
    expect(await screen.findByText(/Общий рейтинг \(Excel\): B/)).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "Note text" }), "Дозвонились, обещали обновить сертификат");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(state().imbcNotes.at(-1)).toMatchObject({
      profileId: "p04",
      authorId: "acc-expert",
      text: "Дозвонились, обещали обновить сертификат",
    });
    expect(await screen.findByText("Дозвонились, обещали обновить сертификат")).toBeTruthy();
  });

  it("операторы в досье: все организации с именами, заметки и operator requests (IMBC-16, IMBC-18)", async () => {
    renderCabinet("/proto/expert/profiles/p01?tab=operators", { role: "expert" });
    expect(
      await screen.findByText(/Works with: Оператор \(демо\), Оператор Б \(демо\)\. Major operators counted: 2\./),
    ).toBeTruthy();
    expect(screen.getByText("Своя заметка организации Б: интерес к сварным конструкциям.")).toBeTruthy();
    expect(screen.getByText("Поставляли модульные конструкции для склада, сроки соблюдены.")).toBeTruthy();
    expect(screen.getByText("Уточните загрузку цехов на первый квартал.")).toBeTruthy();
  });
});

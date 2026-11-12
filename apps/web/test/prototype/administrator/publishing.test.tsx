// Прогноз спроса и файлы STR/KTRE (Release 2): импорт-имитация, отчёт, публикация; загрузка и удаление (ADM-12…ADM-15).
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishedForecast } from "@/prototype/rules";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const xlsx = (name: string) =>
  new File(["x"], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

describe("прогноз спроса (ADM-12…ADM-14)", () => {
  it("версии, бейдж Release 2 и строки опубликованной версии", async () => {
    const { api } = renderCabinet("/proto/administrator/forecast", { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "Demand forecast" })).toBeTruthy();
    expect(screen.getAllByText("Release 2").length).toBeGreaterThan(0);
    expect(
      within(screen.getByText("forecast-2026-11.xlsx").closest("tr")!).getByText("Shown to manufacturers"),
    ).toBeTruthy();
    expect(
      within(screen.getByText("forecast-2026-11-update.xlsx").closest("tr")!).getByText("Not published"),
    ).toBeTruthy();
    expect(screen.getByText("Металлоконструкции каркасов зданий")).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("импорт XLSX — новая неопубликованная версия с отчётом об ошибках (ADM-13)", async () => {
    const { user, state } = renderCabinet("/proto/administrator/forecast", { role: "administrator" });
    await user.upload(await screen.findByLabelText("Forecast file (XLSX)"), xlsx("forecast-2026-12.xlsx"));

    expect(await screen.findByText("Problem report: forecast-2026-12.xlsx")).toBeTruthy();
    expect(screen.getByText(/Количество не число/)).toBeTruthy();
    expect(screen.getByText(/forecast-2026-12.xlsx is imported and not published yet/)).toBeTruthy();
    const version = state().forecastVersions.at(-1)!;
    expect(version).toMatchObject({ fileName: "forecast-2026-12.xlsx", publishedAt: null, rowsTotal: 18 });
    expect(state().forecastLines.filter((l) => l.versionId === version.id)).toHaveLength(16);
    expect(state().audit.at(-1)).toMatchObject({ action: "forecast.import", subject: { type: "forecast" } });
    expect(publishedForecast(state())?.id).toBe("fc-2026-11");
  });

  it("не XLSX — не импортируется", async () => {
    const { user, state } = renderCabinet("/proto/administrator/forecast", { role: "administrator" });
    const before = state().forecastVersions.length;
    await user.upload(
      await screen.findByLabelText("Forecast file (XLSX)"),
      new File(["x"], "forecast.pdf", { type: "application/pdf" }),
    );
    expect(await screen.findByText(/Only an XLSX file is imported/)).toBeTruthy();
    expect(state().forecastVersions).toHaveLength(before);
  });

  it("публикация: версия видна производителям и заменяет прежнюю (ADM-14)", async () => {
    const { user, state } = renderCabinet("/proto/administrator/forecast", { role: "administrator" });
    await screen.findByText("forecast-2026-11-update.xlsx");
    await user.click(
      within(screen.getByText("forecast-2026-11-update.xlsx").closest("tr")!).getByRole("button", { name: "Publish" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/replaces the previous one/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(publishedForecast(state())?.id).toBe("fc-2026-11b"));
    expect(state().forecastLines.filter((l) => l.versionId === "fc-2026-11b").length).toBeGreaterThan(0);
    expect(
      within(screen.getByText("forecast-2026-11.xlsx").closest("tr")!).getByText("Published earlier"),
    ).toBeTruthy();
    expect(state().audit.at(-1)).toMatchObject({ action: "forecast.publish" });
  });
});

describe("файлы STR и KTRE (ADM-15, FC-08)", () => {
  it("по группам и продуктам; сказано, что это тексты IMBC", async () => {
    renderCabinet("/proto/administrator/tech-files", { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "STR and KTRE files" })).toBeTruthy();
    expect(screen.getByText(/They are not an operator’s catalogue/)).toBeTruthy();
    expect(screen.getByText("Group B")).toBeTruthy();
    const valves = screen.getByRole("region", { name: "Краны шаровые DN50" });
    expect(within(valves).getByText(/str-8481805190.pdf/)).toBeTruthy();
    expect(within(valves).getByText(/ktre-8481805190.pdf/)).toBeTruthy();
    expect(screen.getAllByText("Release 2").length).toBeGreaterThan(0);
  });

  it("загружает недостающий KTRE и удаляет файл", async () => {
    const { user, state } = renderCabinet("/proto/administrator/tech-files", { role: "administrator" });
    const pumps = await screen.findByRole("region", { name: "Насосы центробежные" });
    await user.upload(
      within(pumps).getByLabelText("KTRE · Насосы центробежные"),
      new File(["x"], "ktre-pumps.pdf", { type: "application/pdf" }),
    );
    await waitFor(() =>
      expect(state().techFiles.find((f) => f.tnved === "8413702100" && f.kind === "ktre")?.file.name).toBe(
        "ktre-pumps.pdf",
      ),
    );
    expect(state().audit.at(-1)).toMatchObject({ action: "tech_file.upload", subject: { type: "tech_file" } });

    const cable = screen.getByRole("region", { name: "Кабель силовой 1 кВ" });
    await user.click(within(cable).getAllByRole("button", { name: "Remove" })[0]!);
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(state().techFiles.find((f) => f.id === "tf-5")).toBeUndefined());
    expect(state().audit.at(-1)).toMatchObject({ action: "tech_file.remove" });
  });

  it("добавляет продукт с файлом", async () => {
    const { user, state } = renderCabinet("/proto/administrator/tech-files", { role: "administrator" });
    await user.click(await screen.findByRole("button", { name: "Add product" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("radio", { name: "Group D" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Product" }), "Реагенты буровые");
    await user.type(within(dialog).getByRole("textbox", { name: "TN VED code" }), "3824999609");
    await user.upload(
      within(dialog).getByLabelText("PDF file"),
      new File(["x"], "str-reagents.pdf", { type: "application/pdf" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Add product" }));

    expect(await screen.findByRole("region", { name: "Реагенты буровые" })).toBeTruthy();
    expect(state().techFiles.at(-1)).toMatchObject({ group: "D", kind: "str", tnved: "3824999609" });
  });

  it("тот же продукт и вид файла — замена существующего, а не вторая запись (ADM-15)", async () => {
    const { user, state } = renderCabinet("/proto/administrator/tech-files", { role: "administrator" });
    const before = state().techFiles.length;
    await user.click(await screen.findByRole("button", { name: "Add product" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("radio", { name: "Group B" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Product" }), "Краны шаровые DN50");
    await user.type(within(dialog).getByRole("textbox", { name: "TN VED code" }), "8481805190");
    await user.upload(
      within(dialog).getByLabelText("PDF file"),
      new File(["x"], "str-valves-v2.pdf", { type: "application/pdf" }),
    );
    expect(
      within(dialog).getByText(/already has an STR file \(str-8481805190.pdf\): it will be replaced/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Replace existing file" }));

    await waitFor(() => expect(state().techFiles.find((f) => f.id === "tf-2")?.file.name).toBe("str-valves-v2.pdf"));
    expect(state().techFiles).toHaveLength(before);
    expect(state().audit.at(-1)).toMatchObject({ action: "tech_file.replace" });
  });
});

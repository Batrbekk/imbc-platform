// Справочники, обязательные типы, NDA и образец оргструктуры (ADM-08…ADM-11, DATA-04, FC-03).
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { currentNda, forecastOpen } from "@/prototype/rules";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("справочники (ADM-08, ADM-09, ADM-11)", () => {
  it("типы сертификатов с отметкой обязательных, без запросов к API", async () => {
    const { api } = renderCabinet("/proto/administrator/references", { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "Reference lists" })).toBeTruthy();
    expect(
      (screen.getByRole("switch", { name: "Mandatory: ISO 9001" }) as HTMLElement).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByRole("switch", { name: "Mandatory: ASME" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/applies to profiles submitted afterwards/)).toBeTruthy();
    expect(screen.getByText("imbc-org-chart-sample.pdf", { exact: false })).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("отмечает тип обязательным и пишет журнал (ADM-09)", async () => {
    const { user, state } = renderCabinet("/proto/administrator/references", { role: "administrator" });
    await user.click(await screen.findByRole("switch", { name: "Mandatory: API" }));
    await waitFor(() =>
      expect(
        state()
          .referenceLists.find((l) => l.id === "certificate_types")!
          .items.find((i) => i.code === "API")!.mandatory,
      ).toBe(true),
    );
    expect(state().audit.at(-1)).toMatchObject({
      action: "reference.mandatory",
      summary: { en: "Made “API” mandatory in “Certificate types”" },
    });
  });

  it("выводит значение из оборота, а не удаляет (DATA-04), и добавляет новое", async () => {
    const { user, state } = renderCabinet("/proto/administrator/references?list=regions", { role: "administrator" });
    await user.click(await screen.findByRole("button", { name: "Retire: Алматы" }));
    const row = screen.getByText("Алматы").closest("tr")!;
    expect(within(row).getByText("Retired")).toBeTruthy();
    expect(
      state()
        .referenceLists.find((l) => l.id === "regions")!
        .items.find((i) => i.code === "KZ-ALA")!.retired,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Add value" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Code" }), "KZ-ULY");
    await user.type(within(dialog).getByRole("textbox", { name: "Value" }), "Улытауская область");
    await user.click(within(dialog).getByRole("button", { name: "Add value" }));
    expect(await screen.findByText("Улытауская область")).toBeTruthy();
    expect(state().audit.at(-1)).toMatchObject({ action: "reference.add" });
  });

  it("выбор справочника — в адресе, не в журнале", async () => {
    const { user, router, state } = renderCabinet("/proto/administrator/references", { role: "administrator" });
    const before = state().audit.length;
    await user.click(await screen.findByRole("combobox", { name: "Reference list" }));
    await user.click(await screen.findByRole("option", { name: "Document types" }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=document_types"));
    expect(await screen.findByText("Устав")).toBeTruthy();
    expect(state().audit).toHaveLength(before);
  });

  it("заменяет образец оргструктуры (ADM-11)", async () => {
    const { user, state } = renderCabinet("/proto/administrator/references", { role: "administrator" });
    await user.upload(
      await screen.findByLabelText("Sample file"),
      new File(["x"], "org-chart-2026.pdf", { type: "application/pdf" }),
    );
    await waitFor(() => expect(state().orgChartSample.name).toBe("org-chart-2026.pdf"));
    expect(state().audit.at(-1)).toMatchObject({ action: "reference.org_chart_sample" });
  });
});

describe("версии NDA (ADM-10, FC-03)", () => {
  it("на странице сказано, что делает публикация; текущая — 2.0", async () => {
    renderCabinet("/proto/administrator/nda", { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "NDA versions" })).toBeTruthy();
    expect(screen.getByText(/close for every manufacturer until it accepts the new version/)).toBeTruthy();
    const current = screen.getByText("NDA 2.0").closest("tr")!;
    expect(within(current).getByText("Current")).toBeTruthy();
    expect(within(screen.getByText("NDA 1.0").closest("tr")!).getByText("Earlier")).toBeTruthy();
  });

  it("публикует новую версию: прогноз закрывается до принятия (FC-03)", async () => {
    const { user, state } = renderCabinet("/proto/administrator/nda", { role: "administrator" });
    const p01 = () => state().profiles.find((p) => p.id === "p01")!;
    expect(forecastOpen(state(), p01())).toBe(true);

    await user.click(await screen.findByRole("button", { name: "Publish new version" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Version number" }), "2.0");
    expect(within(dialog).getByText("This version already exists.")).toBeTruthy();
    await user.clear(within(dialog).getByRole("textbox", { name: "Version number" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Version number" }), "3.0");
    await user.type(within(dialog).getByRole("textbox", { name: "What changed" }), "Демо: уточнён срок.");
    await user.click(within(dialog).getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(within(screen.getByText("NDA 3.0").closest("tr")!).getByText("Current")).toBeTruthy());
    expect(currentNda(state()).version).toBe("3.0");
    expect(forecastOpen(state(), p01())).toBe(false);
    expect(state().audit.at(-1)).toMatchObject({ action: "nda.publish", subject: { type: "nda", label: "NDA 3.0" } });
  });

  it("пустые справочники и версии NDA — пустое состояние, без ошибки", async () => {
    renderCabinet("/proto/administrator/references", {
      role: "administrator",
      prepare: (d) => {
        d.referenceLists = [];
      },
    });
    expect(await screen.findByText("No reference lists in the demo data.")).toBeTruthy();
  });

  it("нет версий NDA — пустое состояние", async () => {
    renderCabinet("/proto/administrator/nda", {
      role: "administrator",
      prepare: (d) => {
        d.ndaVersions = [];
      },
    });
    expect(await screen.findByText("No NDA version has been published yet.")).toBeTruthy();
  });
});

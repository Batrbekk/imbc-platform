// Назначение проверок администратором: очередь, назначение и переназначение SME (REV-01, REV-04).
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const URL = "/proto/administrator/assignments";

async function rowOf(text: string) {
  return (await screen.findByText(text)).closest("tr")!;
}

describe("назначение проверок (REV-01, REV-04)", () => {
  it("очередь: название, статус и SME; Draft и Returned не в очереди", async () => {
    const { api } = renderCabinet(URL, { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "Assign reviews" })).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(await rowOf("ТОО «Жаңа Демо Құрылыс»")).getByText("Not assigned")).toBeTruthy();
    expect(within(await rowOf("ТОО «Демо Электро Монтаж»")).getByText("Эксперт IMBC")).toBeTruthy();
    expect(within(await rowOf("ТОО «Каспий Демо Сервис»")).getByText("Pending changes")).toBeTruthy();
    expect(within(table).queryByText("ТОО «Демо Агро Өнім»")).toBeNull();
    expect(within(table).queryByText("ТОО «Демо Жоба»")).toBeNull();
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("назначает SME профилю без исполнителя; статус не меняется до открытия (REV-02)", async () => {
    const { user, state } = renderCabinet(URL, { role: "administrator" });
    await user.click(within(await rowOf("ТОО «Жаңа Демо Құрылыс»")).getByRole("button", { name: "Assign" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("radio", { name: "Мадина Ержанова" }));
    await user.click(within(dialog).getByRole("button", { name: "Assign" }));

    await waitFor(async () =>
      expect(within(await rowOf("ТОО «Жаңа Демо Құрылыс»")).getByText("Мадина Ержанова")).toBeTruthy(),
    );
    const profile = state().profiles.find((p) => p.id === "p09")!;
    expect(profile.assignedExpertId).toBe("acc-expert-2");
    expect(profile.status).toBe("submitted");
    expect(state().audit.at(-1)).toMatchObject({
      action: "profile.assign",
      subject: { type: "profile", id: "p09", label: "ТОО «Жаңа Демо Құрылыс»" },
      summary: { en: "Assigned the review to Мадина Ержанова" },
    });
  });

  it("переназначает проверку другому SME", async () => {
    const { user, state } = renderCabinet(URL, { role: "administrator" });
    await user.click(within(await rowOf("ТОО «Демо Электро Монтаж»")).getByRole("button", { name: "Reassign" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("radio", { name: "Эксперт IMBC" })).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: "Мадина Ержанова" }));
    await user.click(within(dialog).getByRole("button", { name: "Reassign" }));
    await waitFor(() => expect(state().profiles.find((p) => p.id === "p11")!.assignedExpertId).toBe("acc-expert-2"));
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.reassign" });
  });

  it("фильтр «не назначенные» — в адресе, без записи в журнал", async () => {
    const { user, router, state } = renderCabinet(URL, { role: "administrator" });
    const before = state().audit.length;
    await user.click(await screen.findByRole("tab", { name: "Not assigned" }));
    await waitFor(() => expect(router.state.location.search).toBe("?show=unassigned"));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
    expect(state().audit).toHaveLength(before);
  });

  it("пустая очередь отличается от пустого фильтра", async () => {
    renderCabinet(URL, {
      role: "administrator",
      prepare: (d) => {
        d.profiles = d.profiles.filter((p) => p.status === "draft");
      },
    });
    expect(await screen.findByText("No profiles are waiting for review.")).toBeTruthy();
  });
});

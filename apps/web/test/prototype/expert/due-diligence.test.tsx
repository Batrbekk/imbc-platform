// Кабинет SME: due diligence — отчёт, имитация запуска, итог SME и видимость, enhanced (IMBC-08, IMBC-11, IMBC-13).
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { visibleProfiles } from "@/prototype/rules";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

const RED = "/proto/expert/profiles/p11?tab=due-diligence";

describe("кабинет SME: due diligence", () => {
  it("отчёт открывается итогом, критическими строками и закрытыми группами; запуск — имитация (IMBC-13)", async () => {
    const { user, api } = renderCabinet(RED, { role: "expert" });
    expect(await screen.findByText(/Simulated run: Adata is not called/)).toBeTruthy();
    const critical = screen.getByRole("heading", { name: "Critical" }).parentElement!;
    expect(within(critical).getByText("Tax and customs arrears")).toBeTruthy();
    expect(within(critical).getByText("Temporary ban on leaving Kazakhstan")).toBeTruthy();
    // Группа закрыта, пока SME её не откроет.
    const group = screen.getByRole("button", { name: /Company\. Enterprise · 10/ });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    await user.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("SME ставит amber с комментарием — профиль возвращается к операторам (IMBC-08, IMBC-11)", async () => {
    const { user, state } = renderCabinet(RED, {
      role: "expert",
      prepare: (d) => {
        d.profiles.find((p) => p.id === "p11")!.status = "verified";
      },
    });
    await screen.findByText(/Simulated run/);
    expect(visibleProfiles(state()).some((p) => p.id === "p11")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Amber" }));
    const save = screen.getByRole("button", { name: "Save result" });
    expect(save.hasAttribute("disabled")).toBe(true);
    await user.type(
      screen.getByRole("textbox", { name: "Comment on the result" }),
      "Справка об отсутствии задолженности получена",
    );
    await user.click(save);

    const record = state().dueDiligence.find((d) => d.profileId === "p11")!;
    expect(record).toMatchObject({ result: "amber", autoResult: "red", resultSetBy: "acc-expert" });
    expect(state().audit.at(-1)).toMatchObject({
      action: "due_diligence.set_result",
      summary: { en: "Set the due-diligence result: Amber" },
    });
    expect(visibleProfiles(state()).some((p) => p.id === "p11")).toBe(true);
    expect(await screen.findAllByText("Operators and observers see this profile.")).toBeTruthy();
  });

  it("повторный запуск пересобирает строки из демо-данных и снимает итог SME (EXT-03)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p06?tab=due-diligence", { role: "expert" });
    await screen.findByText(/Simulated run/);
    const before = state().dueDiligence.find((d) => d.profileId === "p06")!;
    expect(before.result).toBe("green");
    await user.click(screen.getByRole("button", { name: "Run the check again (simulated)" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Run the check again (simulated)" }));

    const after = state().dueDiligence.find((d) => d.profileId === "p06")!;
    expect(after.result).toBe("amber");
    expect(after.resultSetBy).toBeNull();
    expect(after.checkedAt > before.checkedAt).toBe(true);
    expect(after.checks).toHaveLength(before.checks.length);
    expect(state().externalChecks.at(-1)).toMatchObject({
      profileId: "p06",
      connector: "adata",
      result: "amber",
      testData: true,
    });
    expect(state().audit.at(-1)).toMatchObject({ action: "due_diligence.run" });
  });

  it("enhanced due diligence: сделана, комментарий, отчёт (IMBC-08)", async () => {
    const { user, state } = renderCabinet("/proto/expert/profiles/p01?tab=due-diligence", { role: "expert" });
    await screen.findByText(/Simulated run/);
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.type(screen.getByRole("textbox", { name: /Comment, for example/ }), "Аффилированности нет");
    await user.click(screen.getByRole("button", { name: "Save enhanced due diligence" }));
    expect(state().dueDiligence.find((d) => d.profileId === "p01")!.enhanced).toMatchObject({
      done: true,
      comment: "Аффилированности нет",
      by: "acc-expert",
    });
  });

  it("пометка SME к строке хранится в своих данных кабинета и видна в строке", async () => {
    const { user, state } = renderCabinet(RED, { role: "expert" });
    await screen.findByText(/Simulated run/);
    await user.click(screen.getByRole("button", { name: /Director · / }));
    await user.click(
      screen.getByRole("button", { name: "Note on Temporary ban on leaving Kazakhstan — Олжас Байжанов" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Note" }), "Запрет снят 10.11, ждём выписку");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(JSON.stringify(state().ext.expert)).toContain("Запрет снят 10.11");
    await waitFor(() => expect(screen.getByText(/SME note: Запрет снят 10\.11/)).toBeTruthy());
  });
});

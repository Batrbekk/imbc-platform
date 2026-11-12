// Перенесённые производители, pull API и журнал событий аккаунтов (ADM-04, ADM-07, AUD-03).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

async function rowOf(text: string) {
  const cells = await screen.findAllByText(text);
  return cells.map((cell) => cell.closest("tr")).find((row) => row !== null)!;
}

describe("приглашение перенесённых (ADM-04, NOT-25)", () => {
  it("список, отчёт о профилях без пригодной почты", async () => {
    const { api } = renderCabinet("/proto/administrator/migration", { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "Migrated manufacturers" })).toBeTruthy();
    expect(within(await rowOf("ТОО «Степь Пластик»")).getByText("Not invited")).toBeTruthy();
    expect(within(await rowOf("ТОО «Тест Химия»")).getByText(/Invited/)).toBeTruthy();
    const report = screen.getByText("Report: profiles with no usable email").closest<HTMLElement>("[data-slot=card]")!;
    expect(within(report).getByText(/АО «Пример Кабель» — Invalid email/)).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("«Пригласить всех» создаёт аккаунт производителя; без почты — только в отчёте", async () => {
    const { user, state } = renderCabinet("/proto/administrator/migration", { role: "administrator" });
    await user.click(await screen.findByRole("button", { name: "Invite all migrated manufacturers" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/within five working days/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Send invitations" }));

    await waitFor(async () => expect(within(await rowOf("ТОО «Степь Пластик»")).getByText(/Invited/)).toBeTruthy());
    expect(state().accounts.find((a) => a.organizationId === "org-m07")).toMatchObject({
      role: "manufacturer",
      state: "invited",
      email: "account@company7.demo.local",
    });
    expect(state().accounts.find((a) => a.organizationId === "org-m03")).toBeUndefined();
    expect(state().audit.at(-1)).toMatchObject({
      action: "account.invite_migrated",
      subject: { type: "account" },
      summary: { en: "Invited 1 migrated manufacturers; 1 without a usable email" },
    });
    expect(
      (screen.getByRole("button", { name: "Invite all migrated manufacturers" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("исправленная почта приглашается при следующем запуске", async () => {
    const { user, state } = renderCabinet("/proto/administrator/migration", { role: "administrator" });
    await user.click(await screen.findByRole("button", { name: "Correct email" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Company email" }), "info@company3.demo.local");
    await user.click(within(dialog).getByRole("button", { name: "Correct email" }));
    expect(await screen.findByText("Every migrated manufacturer has a usable email.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Invite all migrated manufacturers" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Send invitations" }));
    await waitFor(() => expect(state().accounts.find((a) => a.organizationId === "org-m03")?.state).toBe("invited"));
  });
});

describe("pull API (ADM-07, OPR-38)", () => {
  it("выдаёт доступ: ключ показан один раз и выглядит ненастоящим", async () => {
    const { user, state } = renderCabinet("/proto/administrator/api", { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "Pull API" })).toBeTruthy();
    // Секрет в таблице не показывается.
    expect(screen.queryByText("DEMO-NOT-A-SECRET-0001")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Issue credentials" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("radio", { name: "Наблюдатель (демо)" })).toBeNull();
    await user.click(within(dialog).getByRole("radio", { name: "Оператор В (демо)" }));
    await user.click(within(dialog).getByRole("button", { name: "Issue" }));

    const credential = state().apiCredentials.at(-1)!;
    expect(credential).toMatchObject({ operatorOrgId: "org-operator-c", revokedAt: null });
    expect(credential.secretSample).toMatch(/^DEMO-NOT-A-SECRET-[0-9A-F]{4}$/);
    expect(await screen.findByText(credential.secretSample)).toBeTruthy();
    expect(screen.getByText(/Shown once/)).toBeTruthy();
    expect(state().audit.at(-1)).toMatchObject({ action: "api_credential.issue", subject: { type: "api_credential" } });

    await user.click(screen.getByRole("button", { name: "I have copied the key" }));
    expect(screen.queryByText(credential.secretSample)).toBeNull();
    cleanup();
    renderCabinet("/proto/administrator/api", { role: "administrator", keepState: true });
    await screen.findByText(credential.clientId);
    expect(screen.queryByText(credential.secretSample)).toBeNull();
  });

  it("отзывает доступ", async () => {
    const { user, state } = renderCabinet("/proto/administrator/api", { role: "administrator" });
    await user.click(within(await rowOf("demo-client-operator-0001")).getByRole("button", { name: "Revoke" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(state().apiCredentials.find((c) => c.id === "api-01")?.revokedAt).not.toBeNull());
    expect(within(await rowOf("demo-client-operator-0001")).getByText(/Revoked/)).toBeTruthy();
    expect(state().audit.at(-1)).toMatchObject({ action: "api_credential.revoke" });
  });
});

describe("журнал аудита администратора (AUD-03)", () => {
  it("только события аккаунтов: другие не показаны и не посчитаны", async () => {
    renderCabinet("/proto/administrator/audit", { role: "administrator" });
    expect(await screen.findByRole("heading", { level: 1, name: "Audit log" })).toBeTruthy();
    expect(screen.getByText("Events: 4")).toBeTruthy();
    expect(screen.getByText("Blocked an account")).toBeTruthy();
    expect(screen.getByText("Issued pull-API access to the operator organisation")).toBeTruthy();
    expect(screen.queryByText("Published NDA version 1.0")).toBeNull();
    expect(screen.queryByText("Took the profile for review")).toBeNull();
    expect(screen.queryByText("Exported search results (XLSX)")).toBeNull();
  });

  it("действие на другом экране появляется в журнале; фильтр — в адресе", async () => {
    const { user, router } = renderCabinet("/proto/administrator/organizations", { role: "administrator" });
    await user.click(
      within(await rowOf("zhanar.imanova@operator-b.demo.local")).getByRole("button", { name: "Block" }),
    );
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Block" }));
    await user.click(screen.getByRole("link", { name: "Audit log" }));

    expect(await screen.findByText("Events: 5")).toBeTruthy();
    expect(within(await rowOf("zhanar.imanova@operator-b.demo.local")).getByText("Администратор IMBC")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Pull API" }));
    await waitFor(() => expect(router.state.location.search).toBe("?object=api_credential"));
    expect(screen.getByText("Events: 1")).toBeTruthy();
  });

  it("пустой журнал — своё сообщение", async () => {
    renderCabinet("/proto/administrator/audit", {
      role: "administrator",
      prepare: (d) => {
        d.audit = [];
      },
    });
    expect(await screen.findByText("No account events yet.")).toBeTruthy();
  });
});

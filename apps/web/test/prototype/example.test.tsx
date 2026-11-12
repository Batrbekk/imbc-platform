// Каркас прототипа на примере модуля: меню, страница, действие с журналом, общее состояние ролей (GEN-08, GEN-12).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { STORAGE_KEY } from "@/prototype/store";

import en from "../../messages/en.json";
import { apiV1Calls, renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
// Модуль оператора подменён примером из README.
vi.mock("@/prototype/operator", () => import("./example-cabinet"));

afterEach(() => {
  vi.clearAllMocks();
});

const TITLE = "Notes on ТОО «Демо Металл Конструкция»";

describe("модуль роли в каркасе прототипа", () => {
  it("группа «Прототип» под готовыми пунктами, страница с бейджем и одним PageTitle", async () => {
    const { api } = renderCabinet("/proto/operator/notes", { role: "operator" });

    expect(await screen.findByRole("heading", { name: TITLE })).toBeTruthy();
    expect(document.title).toBe(`${TITLE} · ${en.common.appName}`);
    expect(screen.getByText("Prototype", { selector: "[data-slot=badge]" })).toBeTruthy();
    expect(screen.getByText("Fictional data. Changes are kept only in this browser.")).toBeTruthy();

    const links = screen.getAllByRole("link").map((a) => a.textContent);
    expect(links.indexOf("Notes (example)")).toBeGreaterThan(links.indexOf(en.nav.account));
    expect(screen.getByRole("link", { name: "Notes (example)" }).hasAttribute("data-active")).toBe(true);
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("оператор видит заметки только своей организации (GEN-12)", async () => {
    renderCabinet("/proto/operator/notes", { role: "operator" });
    expect(await screen.findByText(/Поставляли модульные конструкции/)).toBeTruthy();
    expect(screen.getByText(/Готовы к аудиту поставщика/)).toBeTruthy();
    expect(screen.queryByText(/организации Б/)).toBeNull();
  });

  it("действие пишет журнал, сохраняется в браузере и видно после повторного входа", async () => {
    const { user, state } = renderCabinet("/proto/operator/notes", { role: "operator" });
    await user.type(await screen.findByRole("textbox", { name: "Add note" }), "Новая заметка");
    await user.click(screen.getByRole("button", { name: "Add note" }));

    expect(await screen.findByText(/Новая заметка — Специалист оператора/)).toBeTruthy();
    expect(state().audit.at(-1)).toMatchObject({
      action: "operator_note.create",
      actor: { email: "operator@operator.local", role: "operator", organizationId: "org-operator-demo" },
      summary: { en: "Added an operator note" },
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain("Новая заметка");
    cleanup();

    // Другой пользователь той же организации в том же браузере видит заметку.
    renderCabinet("/proto/operator/notes", {
      role: "operator",
      email: "arman.bekov@operator.demo.local",
      keepState: true,
    });
    expect(await screen.findByText(/Новая заметка/)).toBeTruthy();
  });

  it("сеанс не демо-аккаунта: в браузере не остаётся ни почты, ни имени (NFR-11)", async () => {
    const { user } = renderCabinet("/proto/operator/notes", {
      role: "operator",
      email: "real.person@company.example",
      fullName: "Реальный Человек",
    });
    await user.type(await screen.findByRole("textbox", { name: "Add note" }), "Заметка со стенда");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    // Автор — демо-персона роли оператора.
    expect(await screen.findByText(/Заметка со стенда — Специалист оператора/)).toBeTruthy();
    const stored = window.localStorage.getItem(STORAGE_KEY)!;
    expect(stored).toContain("Заметка со стенда");
    for (const leak of ["real.person", "company.example", "Реальный Человек"]) expect(stored).not.toContain(leak);
  });

  it("экраны модуля сравниваются с учётом регистра", async () => {
    renderCabinet("/proto/operator/NOTES", { role: "operator" });
    expect(await screen.findByRole("heading", { name: en.notFound.title })).toBeTruthy();
  });

  it("«Сбросить демо-данные» возвращает исходное состояние", async () => {
    const { user } = renderCabinet("/proto/operator/notes", {
      role: "operator",
      prepare: (draft) => {
        draft.operatorNotes = [];
      },
    });
    await screen.findByRole("heading", { name: TITLE });
    expect(screen.queryByText(/Поставляли модульные конструкции/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Reset demo data" }));
    await waitFor(() => expect(screen.getByText(/Поставляли модульные конструкции/)).toBeTruthy());
  });

  it("другая роль не открывает модуль оператора", async () => {
    const { router } = renderCabinet("/proto/operator/notes", {
      role: "observer",
      api: { "GET /api/v1/dashboard": { status: 500 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByText("Notes (example)")).toBeNull();
  });
});

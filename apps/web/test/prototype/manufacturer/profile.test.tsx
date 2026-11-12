// Кабинет производителя: профиль, секции, отправка на проверку, блокировка, возврат, pending changes.
// MAN-13, MAN-22, MAN-36, MAN-40, MAN-41, MAN-42, MAN-43, MAN-44, MAN-45, MAN-46, GEN-08.
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProtoState } from "@/prototype/data";
import { resetViewAs } from "@/prototype/manufacturer/view-as";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  resetViewAs();
});

const p = (state: () => ProtoState, id: string) => state().profiles.find((x) => x.id === id)!;

/** Draft p12 почти заполнен: не хватает только третьего контакта. */
function nearlyComplete(draft: ProtoState) {
  const d = draft.profiles.find((x) => x.id === "p12")!;
  const src = draft.profiles.find((x) => x.id === "p01")!;
  d.sections.personnel = structuredClone(src.sections.personnel);
  d.sections.certificates = structuredClone(src.sections.certificates);
  d.sections.documents = structuredClone(src.sections.documents);
}

describe("кабинет производителя: профиль", () => {
  it("свой профиль: статус, полнота, секции, документы; без запросов к /api/v1", async () => {
    const { api } = renderCabinet("/proto/manufacturer", { role: "manufacturer" });
    expect(await screen.findByRole("heading", { level: 1, name: "Company profile" })).toBeTruthy();
    expect(screen.getByText("ТОО «Демо Металл Конструкция»")).toBeTruthy();
    expect(screen.getByText("240100001001")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Profile completeness" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Contacts" })).toBeTruthy();
    expect(screen.getByText("Documents and certificates")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Demand forecast" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Presenter: view as" })).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("другая роль не открывает кабинет производителя (GEN-08)", async () => {
    const { router } = renderCabinet("/proto/manufacturer/profile", {
      role: "operator",
      api: { "GET /api/v1/dashboard": { status: 500 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByText("Company profile")).toBeNull();
  });

  it("переключатель ведущего меняет профиль, но не пишет журнал", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/profile", { role: "manufacturer" });
    const audit = state().audit.length;
    await user.click(await screen.findByRole("combobox", { name: "Presenter: view as" }));
    await user.click(await screen.findByRole("option", { name: /^Draft — / }));
    expect(await screen.findByText("ТОО «Демо Жоба»")).toBeTruthy();
    expect(screen.getByText("What is missing before sending for review")).toBeTruthy();
    expect(screen.getByText("At least three complete contacts (2 of 3)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send for review" }).hasAttribute("disabled")).toBe(true);
    expect(state().audit.length).toBe(audit);
  });

  it("Draft: секция сохраняется отдельно, на 100 % профиль отправляется с подтверждением (MAN-40…MAN-42)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/profile/contacts?as=p12", {
      role: "manufacturer",
      prepare: nearlyComplete,
    });
    await user.click(await screen.findByRole("button", { name: "Add contact" }));
    const card = screen.getByRole("group", { name: "Contact 3" });
    await user.type(within(card).getByRole("textbox", { name: "Full name" }), "Инженер по качеству");
    await user.type(within(card).getByRole("textbox", { name: "Position" }), "Инженер");
    await user.type(within(card).getByRole("textbox", { name: "Email" }), "quality@company12.demo.local");
    await user.type(within(card).getByRole("textbox", { name: "Phone" }), "+7 705 000 00 12");
    await user.click(screen.getByRole("button", { name: "Save section" }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Section saved.");
    expect(p(state, "p12").sections.contacts).toHaveLength(3);
    expect(state().audit.at(-1)).toMatchObject({
      action: "section.save",
      summary: { en: "Saved section «Contacts» of the profile" },
    });

    await user.click(screen.getByRole("link", { name: "Back to profile" }));
    const send = await screen.findByRole("button", { name: "Send for review" });
    expect(send.hasAttribute("disabled")).toBe(false);
    await user.click(send);
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Send for review" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await user.click(within(dialog).getByRole("checkbox", { name: /data in the profile is accurate/ }));
    await user.click(confirm);

    await waitFor(() => expect(p(state, "p12").status).toBe("submitted"));
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.submit" });
    expect(await screen.findByRole("button", { name: "Unlock to edit" })).toBeTruthy();
  });

  it("контакт с повтором почты не сохраняется (MAN-13)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/profile/contacts?as=p12", { role: "manufacturer" });
    await user.click(await screen.findByRole("button", { name: "Add contact" }));
    const card = screen.getByRole("group", { name: "Contact 3" });
    await user.type(within(card).getByRole("textbox", { name: "Email" }), "focal@company12.demo.local");
    const before = state().audit.length;
    await user.click(screen.getByRole("button", { name: "Save section" }));
    expect(await screen.findByText(/Contact 3: this email is already on another contact/)).toBeTruthy();
    expect(state().audit.length).toBe(before);
    expect(p(state, "p12").sections.contacts).toHaveLength(2);
  });

  it("сумма долей не 100 % — предупреждение, которое не мешает (MAN-22)", async () => {
    renderCabinet("/proto/manufacturer/profile/shareholders?as=p12", { role: "manufacturer" });
    expect(await screen.findByText("Total of shares: 90 %")).toBeTruthy();
    expect(screen.getByText(/The shares total 90 %, not 100 %/)).toBeTruthy();
  });

  it("Submitted заблокирован; разблокировка возвращает Draft (MAN-43)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/profile/main?as=p09", { role: "manufacturer" });
    expect(await screen.findByText(/The profile is locked while it is with IMBC/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save section" })).toBeNull();
    expect((screen.getByRole("textbox", { name: "City" }) as HTMLInputElement).disabled).toBe(true);

    await user.click(screen.getByRole("link", { name: "Back to profile" }));
    await user.click(await screen.findByRole("button", { name: "Unlock to edit" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Unlock to edit" }));
    await waitFor(() => expect(p(state, "p09").status).toBe("draft"));
    expect(state().audit.at(-1)).toMatchObject({ action: "profile.unlock" });
  });

  it("Returned: комментарии SME, замена сертификата с историей, повторная отправка (MAN-36, MAN-44)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/profile?as=p10", { role: "manufacturer" });
    expect(await screen.findByText("Телефон focal point не отвечает. Укажите действующий номер.")).toBeTruthy();
    expect(screen.getAllByText("Rejected").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("link", { name: "Certificates" }));
    expect(await screen.findByText(/Срок ISO 45001 истёк в октябре/)).toBeTruthy();
    const input = screen.getAllByLabelText("Certificate file")[2] as HTMLInputElement;
    await user.upload(input, new File(["x"], "iso-45001-2026.pdf", { type: "application/pdf" }));
    const card = screen.getByRole("group", { name: /Certificate 3: ISO 45001/ });
    const expiry = within(card).getByLabelText("Expiry date");
    await user.clear(expiry);
    await user.type(expiry, "2029-10-15");
    await user.click(screen.getByRole("button", { name: "Save section" }));

    const cert = await waitFor(() => {
      const c = p(state, "p10").sections.certificates.find((x) => x.type === "ISO 45001")!;
      expect(c.file?.name).toBe("iso-45001-2026.pdf");
      return c;
    });
    expect(cert.status).toBe("uploaded");
    expect(p(state, "p10").review.certificates.changed).toBe(true);
    expect(await screen.findByText("Earlier versions")).toBeTruthy();
    expect(screen.getByText(/p10-iso-45001\.pdf/)).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Back to profile" }));
    await user.click(await screen.findByRole("button", { name: "Send for review" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Send for review" }));
    await waitFor(() => expect(p(state, "p10").status).toBe("submitted"));
    // Верифицированная и не изменённая секция остаётся верифицированной, отклонённые ждут решения.
    expect(p(state, "p10").review.main.decision).toBe("verified");
    expect(p(state, "p10").review.contacts.decision).toBeNull();
    expect(p(state, "p10").assignedExpertId).toBe("acc-expert-2");
  });

  it("Verified: правка становится pending change, операторы видят прежнее; отправка изменений (MAN-45)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/profile/personnel", { role: "manufacturer" });
    const field = await screen.findByRole("spinbutton", { name: "Managers" });
    await user.clear(field);
    await user.type(field, "30");
    await user.click(screen.getByRole("button", { name: "Save section" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Saved as a pending change/);
    expect(p(state, "p01").sections.personnel.managers).toBe(24);
    expect(p(state, "p01").pending.personnel?.managers).toBe(30);
    expect(p(state, "p01").status).toBe("verified");

    await user.click(screen.getByRole("link", { name: "Back to profile" }));
    expect(await screen.findByText("Pending changes: Personnel")).toBeTruthy();
    expect(screen.getByText("Pending change, not sent")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Send changes for review" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Send changes for review" }));
    await waitFor(() => expect(p(state, "p01").pendingChanges).toBe(true));
    expect(p(state, "p01").status).toBe("verified");
    expect(await screen.findByText("Pending change with the SME")).toBeTruthy();
  });

  it.each([
    ["main", "Company legal name"],
    ["contacts", "Contact 1"],
    ["personnel", "Organisation chart"],
    ["shareholders", "Shareholder 1"],
    ["products", "From e-Ondiris"],
    ["production", "Main processes"],
    ["certificates", "Certificate 1: ISO 9001"],
    ["documents", "No licence required for our activity"],
  ])("секция %s открывается своим адресом с формой (MAN-40)", async (section, text) => {
    const { api } = renderCabinet(`/proto/manufacturer/profile/${section}`, { role: "manufacturer" });
    expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Save section" })).toBeTruthy();
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("e-Ondiris: строку реестра нельзя изменить, второй такой же продукт не сохраняется (MAN-25)", async () => {
    const { user, state } = renderCabinet("/proto/manufacturer/profile/products", { role: "manufacturer" });
    expect(await screen.findByText(/cannot be edited or deleted/)).toBeTruthy();
    expect(screen.getByText("9 of 11 stages in KZ")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Add product line" }));
    const card = screen.getByRole("group", { name: "Product line 2" });
    await user.type(within(card).getByRole("textbox", { name: "Name in Russian" }), "Металлоконструкции модульные");
    await user.click(within(card).getByRole("combobox", { name: "TN VED code" }));
    await user.click(await screen.findByRole("option", { name: /^7308909809/ }));
    const before = state().audit.length;
    await user.click(screen.getByRole("button", { name: "Save section" }));
    expect(await screen.findByText(/Product line 2: this product already comes from e-Ondiris/)).toBeTruthy();
    expect(state().audit.length).toBe(before);
  });

  it("неизвестная секция — «не найдено» со ссылкой назад", async () => {
    renderCabinet("/proto/manufacturer/profile/unknown", { role: "manufacturer" });
    expect(await screen.findByText("The profile has no such section.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to profile" })).toBeTruthy();
  });
});

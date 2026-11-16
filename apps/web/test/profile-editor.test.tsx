// Real routes and BFF requests: partial saves, readonly source values and contact editing.
import {
  type ContactsRead,
  type MainInformationRead,
  type SectionRead,
} from "@imbc/contracts";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { problem, stubApi, type ApiReply } from "./support/api";
import {
  contact,
  contactsSection,
  mainSection,
  MANUFACTURER,
  overview,
  ownProfile,
  REGION_ID,
  regionChoices,
  ROLE_ID,
  roleChoices,
  SECOND_SITE_ID,
  SITE_ID,
} from "./support/profile-fixtures";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
afterEach(() => vi.clearAllMocks());

const t = en.profileEditor;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

/** A small stateful BFF stub: saves and later GETs return the same stored section. */
function sectionApi<Data extends MainInformationRead | ContactsRead>(
  kind: "main_information" | "contacts",
  initial: SectionRead<Data>,
  options: { get?: ApiReply; put?: ApiReply; choices?: ApiReply } = {},
) {
  let current = initial;
  const path = `/api/v1/profiles/own/sections/${kind}`;
  const writes: { editVersion: number; data: unknown }[] = [];
  const requests = stubApi({
    "GET /api/auth/me": { body: MANUFACTURER },
    "GET /api/v1/profiles/own": { body: ownProfile() },
    "GET /api/v1/profiles/own/sections": { body: overview() },
    [`GET ${path}`]: options.get ?? (() => Response.json(current)),
    "GET /api/v1/dictionaries/region/choices": { body: regionChoices },
    "GET /api/v1/dictionaries/contact_role/choices": options.choices ?? { body: roleChoices },
    [`PUT ${path}`]: (url, init) => {
      const write = JSON.parse(String(init?.body)) as { editVersion: number; data: unknown };
      writes.push(write);
      if (options.put) return typeof options.put === "function"
        ? options.put(url, init)
        : Response.json(options.put.body, { status: options.put.status ?? 200 });
      const savedData = kind === "main_information"
        ? {
            ...current.data,
            editable: {
              ...(write.data as MainInformationRead["editable"]),
              sites: (write.data as MainInformationRead["editable"]).sites.map((site, index) => ({
                ...site,
                identityId: site.identityId ?? (index === 0 ? SITE_ID : SECOND_SITE_ID),
              })),
            },
          }
        : write.data;
      current = {
        ...current,
        data: savedData as Data,
        editVersion: current.editVersion + 1,
        savedAt: "2026-11-16T06:00:00Z",
        revisionState: "working",
        hasWorkingChanges: current.profileStatus === "verified",
      };
      return Response.json(current);
    },
  });
  return { requests, writes, path, setState: (next: SectionRead<Data>) => { current = next; } };
}

const contactGroups = () => screen.getAllByRole("group", { name: /^Contact \d+$/ });
const valueOf = (input: HTMLElement) => (input as HTMLInputElement).value;
const disabled = (input: HTMLElement) => (input as HTMLInputElement | HTMLButtonElement).disabled;

describe("main information editor (MAN-06–12, MAN-40, MAN-45)", () => {
  it("saves a partial Draft through the underscore API URL with only editable fields", async () => {
    const api = sectionApi("main_information", mainSection());
    const { user } = renderRoute("/profile/main-information", { locale: "en" });
    const phone = await screen.findByRole("textbox", { name: t.companyPhone });
    expect(disabled(screen.getByRole("button", { name: t.save }))).toBe(true);
    await user.type(phone, "+44 20 7946 0958");
    await user.click(screen.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.saved)).toBeTruthy();
    expect(api.writes).toEqual([{ editVersion: 3, data: { website: null, companyPhone: "+442079460958", contactEmail: null, sites: [] } }]);
    const puts = api.requests.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(String(puts[0][0])).toBe("/api/v1/profiles/own/sections/main_information");
    expect(Object.keys(api.writes[0])).toEqual(["editVersion", "data"]);
    expect(Object.keys(api.writes[0].data as object).sort()).toEqual(["companyPhone", "contactEmail", "sites", "website"]);
    expect(valueOf(screen.getByRole("textbox", { name: t.companyPhone }))).toBe("+442079460958");
  });

  it("creates a second site and preserves both server-owned identities and values after leaving and reopening", async () => {
    const initial = mainSection();
    initial.data.editable = { website: null, companyPhone: "+442079460958", contactEmail: null, sites: [
      { identityId: SITE_ID, address: "Existing address", city: "Алматы", regionId: REGION_ID },
    ] };
    const api = sectionApi("main_information", initial);
    const { user, router } = renderRoute("/profile/main-information", { locale: "en" });
    await screen.findByRole("textbox", { name: t.productionAddress });
    await user.click(screen.getByRole("button", { name: t.addSite }));
    const addresses = screen.getAllByRole("textbox", { name: t.productionAddress });
    await user.type(addresses[1], "Second address");
    await user.type(screen.getAllByRole("textbox", { name: t.city })[1], "Алматы");
    await waitFor(() => expect(disabled(screen.getAllByRole("combobox", { name: t.region })[1])).toBe(false));
    await user.click(screen.getAllByRole("combobox", { name: t.region })[1]);
    await user.click(await screen.findByRole("option", { name: "Алматы" }));
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    const firstWrite = api.writes[0].data as MainInformationRead["editable"];
    expect(firstWrite.sites.map((site) => site.identityId)).toEqual([SITE_ID, null]);
    await act(async () => { await router.navigate("/profile"); });
    await screen.findByText(ownProfile().organizationName);
    await user.click(screen.getAllByRole("link", { name: t.openSection })[0]);
    await screen.findByRole("textbox", { name: t.companyPhone });
    expect(screen.getAllByRole("textbox", { name: t.productionAddress }).map(valueOf)).toEqual(["Existing address", "Second address"]);
    const secondAddress = screen.getAllByRole("textbox", { name: t.productionAddress })[1];
    await user.clear(secondAddress);
    await user.type(secondAddress, "Corrected second address");
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    const lastWrite = api.writes.at(-1)!.data as MainInformationRead["editable"];
    expect(lastWrite.sites.map((site) => site.identityId)).toEqual([SITE_ID, SECOND_SITE_ID]);
    expect(lastWrite.sites.map((site) => site.address)).toEqual(["Existing address", "Corrected second address"]);
  });

  it.each([["en", en], ["ru", ru], ["kk", kk]] as const)("shows readonly full source values in %s without an Adata widget request", async (locale, messages) => {
    const initial = mainSection();
    const api = sectionApi("main_information", initial);
    renderRoute("/profile/main-information", { locale });
    const legal = await screen.findByRole("region", { name: messages.profileEditor.legalTitle });
    for (const value of [initial.data.bin, initial.data.loginEmail, initial.data.legalInformation.legalName, initial.data.legalInformation.alternativeName, initial.data.legalInformation.directorFullName, ...initial.data.legalInformation.founders]) {
      expect(within(legal).getByText(value!)).toBeTruthy();
    }
    expect(within(legal).getByText("01120")).toBeTruthy();
    expect(within(legal).getByText("01120").parentElement?.textContent).toBe("01120 — Выращивание риса");
    expect(within(legal).getByText("28220")).toBeTruthy();
    expect(within(legal).getByText(messages.profileEditor.legalReadOnly)).toBeTruthy();
    expect(within(legal).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(legal).queryAllByRole("checkbox")).toHaveLength(0);
    expect(api.requests.mock.calls.some(([url]) => String(url).includes("/adata"))).toBe(false);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await waitFor(() => expect(document.title).toBe(`${messages.profileEditor.sections.main_information} · ${messages.common.appName}`));
    expect(document.querySelectorAll("title")).toHaveLength(1);
  });

  it("Verified opens read-only with wrapped complete values, requires Edit and returns to viewing after a successful save", async () => {
    const initial = mainSection({ profileStatus: "verified", revisionState: "verified" });
    initial.data.editable = { website: null, companyPhone: "+442079460958", contactEmail: null, sites: [
      { identityId: SITE_ID, address: "Тестовая производственная площадка, 1", city: "Алматы", regionId: REGION_ID },
    ] };
    initial.completeness = { percent: 100, missing: [] };
    const api = sectionApi("main_information", initial);
    const { user } = renderRoute("/profile/main-information", { locale: "en" });
    await screen.findByRole("textbox", { name: t.companyPhone });
    expect(screen.getAllByRole("textbox").every((field) => (field as HTMLTextAreaElement).readOnly)).toBe(true);
    const address = screen.getByRole("textbox", { name: t.productionAddress }) as HTMLTextAreaElement;
    expect(address.tagName).toBe("TEXTAREA");
    expect(address.value).toBe("Тестовая производственная площадка, 1");
    expect(address.classList.contains("field-sizing-content")).toBe(true);
    expect(address.disabled).toBe(false);
    expect(screen.queryByRole("button", { name: t.save })).toBeNull();
    await user.click(screen.getByRole("button", { name: t.edit }));
    const phone = screen.getByRole("textbox", { name: t.companyPhone });
    expect(disabled(phone)).toBe(false);
    await user.clear(phone);
    await user.type(phone, "+49 30 12345678");
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    expect(await screen.findByRole("button", { name: t.edit })).toBeTruthy();
    const savedPhone = screen.getByRole("textbox", { name: t.companyPhone }) as HTMLTextAreaElement;
    expect(savedPhone.readOnly).toBe(true);
    expect(savedPhone.value).toBe("+493012345678");
    expect(api.writes).toHaveLength(1);
  });

  it("source unavailability is explicit and still allows editable partial data to be saved", async () => {
    const initial = mainSection();
    initial.data.source = { state: "unavailable", readAt: null, provenance: null };
    initial.data.legalInformation = { legalName: null, alternativeName: null, legalForm: null, directorFullName: null, stateRegisteredOn: null, legalAddress: null, founders: [], oked: [] };
    const api = sectionApi("main_information", initial);
    const { user } = renderRoute("/profile/main-information", { locale: "en" });
    expect(await screen.findByText(t.sourceUnavailable)).toBeTruthy();
    const legal = screen.getByRole("region", { name: t.legalTitle });
    expect(within(legal).getByText(t.legalName).nextElementSibling?.textContent).toBe("—");
    await user.type(screen.getByRole("textbox", { name: t.companyPhone }), "+442079460958");
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    expect(api.writes).toHaveLength(1);
    expect(screen.getByText(t.sourceUnavailable)).toBeTruthy();
  });

  it("shows the specific used-site error and retains the rest of the draft after a failed removal", async () => {
    const initial = mainSection();
    initial.data.editable.sites = [{ identityId: SITE_ID, address: "Used site", city: "Алматы", regionId: REGION_ID }];
    const api = sectionApi("main_information", initial, { put: () => Response.json({
      type: "about:blank", title: "validation", status: 400, code: "validation",
      errors: [{ path: "sites", code: "site_in_use" }],
    }, { status: 400, headers: { "content-type": "application/problem+json" } }) });
    const { user } = renderRoute("/profile/main-information", { locale: "en" });
    const phone = await screen.findByRole("textbox", { name: t.companyPhone });
    await user.type(phone, "+442079460958");
    await user.click(screen.getByRole("button", { name: t.remove }));
    await user.click(screen.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.errors.site_in_use)).toBeTruthy();
    expect(valueOf(phone)).toBe("+442079460958");
    expect(screen.queryByRole("textbox", { name: t.productionAddress })).toBeNull();
    expect((api.writes[0].data as MainInformationRead["editable"]).sites).toEqual([]);
    expect(disabled(screen.getByRole("button", { name: t.save }))).toBe(false);
  });

  it("links the missing sites group and phone to existing editable elements", async () => {
    sectionApi("main_information", mainSection({ completeness: { percent: 0, missing: [
      { path: "sites", code: "required" }, { path: "companyPhone", code: "required" },
    ] } }));
    const { user } = renderRoute("/profile/main-information", { locale: "en" });
    await screen.findByRole("textbox", { name: t.companyPhone });
    await user.click(screen.getByText(t.missingTitle));
    for (const label of [t.sitesTitle, t.companyPhone]) {
      const link = screen.getByRole("link", { name: label });
      const target = link.getAttribute("href")!.slice(1);
      expect(document.getElementById(target)).toBeTruthy();
    }
  });
});

describe("contacts editor (MAN-13–15, MAN-40)", () => {
  it("adds, reorders and removes rows without losing partially entered values", async () => {
    const initial = contactsSection({ contacts: [contact(1, { fullName: "Existing", position: null, email: null, phone: null, roleId: null, isFocalPoint: false })] }, { completeness: { percent: 0, missing: [] } });
    const api = sectionApi("contacts", initial);
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findByRole("textbox", { name: t.fullName });
    await user.type(screen.getByRole("textbox", { name: t.position }), "Инженер");
    await user.click(screen.getByRole("button", { name: t.addContact }));
    await user.type(screen.getAllByRole("textbox", { name: t.fullName })[1], "Second");
    await user.type(screen.getAllByRole("textbox", { name: t.email })[1], "second@demo.local");
    await user.click(within(contactGroups()[0]).getByRole("button", { name: t.moveDown }));
    expect(screen.getAllByRole("textbox", { name: t.fullName }).map(valueOf)).toEqual(["Second", "Existing"]);
    expect(screen.getAllByRole("textbox", { name: t.position }).map(valueOf)).toEqual(["", "Инженер"]);
    await user.click(within(contactGroups()[0]).getByRole("button", { name: t.remove }));
    expect(valueOf(screen.getByRole("textbox", { name: t.fullName }))).toBe("Existing");
    expect(valueOf(screen.getByRole("textbox", { name: t.position }))).toBe("Инженер");
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    const saved = api.writes[0].data as ContactsRead;
    expect(saved.contacts).toEqual([{ fullName: "Existing", position: "Инженер", email: null, phone: null, roleId: null, isFocalPoint: false }]);
    expect(screen.getByText(t.contactsHint)).toBeTruthy();
  });

  it.each([
    ["email", " PERSON1@DEMO.LOCAL ", "duplicate_email"],
    ["phone", "+44 20 7946 0001", "duplicate_phone"],
  ] as const)("rejects normalized duplicate %s before issuing PUT and keeps the input", async (field, duplicate, error) => {
    const api = sectionApi("contacts", contactsSection());
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findAllByRole("textbox", { name: t.fullName });
    const input = screen.getAllByRole("textbox", { name: t[field] })[1];
    await user.clear(input);
    await user.type(input, duplicate);
    const entered = valueOf(input);
    await user.click(screen.getByRole("button", { name: t.save }));
    const message = await screen.findByText(t.errors[error]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(message.id);
    expect(valueOf(input)).toBe(entered);
    expect(api.writes).toHaveLength(0);
  });

  it.each([
    ["email", "bad-address", "email_format"],
    ["phone", "12345", "phone_format"],
  ] as const)("keeps an invalid %s draft and explains its format before PUT", async (field, invalid, error) => {
    const api = sectionApi("contacts", contactsSection());
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findAllByRole("textbox", { name: t.fullName });
    const input = screen.getAllByRole("textbox", { name: t[field] })[1];
    await user.clear(input);
    await user.type(input, invalid);
    await user.click(screen.getByRole("button", { name: t.save }));
    expect(await screen.findByText(t.errors[error])).toBeTruthy();
    expect(valueOf(input)).toBe(invalid);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(api.writes).toHaveLength(0);
  });

  it("refuses a second focal point immediately, retains the first and lets the manufacturer switch explicitly", async () => {
    const api = sectionApi("contacts", contactsSection());
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findAllByRole("textbox", { name: t.fullName });
    const [first, second] = screen.getAllByRole("checkbox", { name: t.focalPoint });
    expect(first.getAttribute("aria-checked")).toBe("true");
    await user.click(second);
    const message = await screen.findByText(t.errors.multiple_focal_points);
    expect(first.getAttribute("aria-checked")).toBe("true");
    expect(second.getAttribute("aria-checked")).toBe("false");
    expect(second.getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
    expect(api.writes).toHaveLength(0);
    await user.click(first);
    await user.click(second);
    expect(first.getAttribute("aria-checked")).toBe("false");
    expect(second.getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    expect((api.writes[0].data as ContactsRead).contacts.map((row) => row.isFocalPoint)).toEqual([false, true, false]);
  });

  it("supports more than fifty contacts and permits another incomplete row", async () => {
    const api = sectionApi("contacts", contactsSection({ contacts: Array.from({ length: 51 }, (_, index) => contact(index + 1)) }));
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findAllByRole("textbox", { name: t.fullName });
    expect(contactGroups()).toHaveLength(51);
    await user.click(screen.getByRole("button", { name: t.addContact }));
    await user.type(screen.getAllByRole("textbox", { name: t.fullName })[51], "New contact");
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    const saved = api.writes[0].data as ContactsRead;
    expect(saved.contacts).toHaveLength(52);
    expect(saved.contacts[51]).toMatchObject({ fullName: "New contact", email: null, roleId: null });
  }, 20_000);

  it("loads role labels asynchronously, never displays the UUID and saves a dictionary choice", async () => {
    const pending = deferred<Response>();
    const initial = contactsSection({ contacts: [contact(1, { roleId: null })] });
    const api = sectionApi("contacts", initial, { choices: () => pending.promise.then((response) => response.clone()) });
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    const select = await screen.findByRole("combobox", { name: t.role });
    expect(disabled(select)).toBe(true);
    expect(screen.queryByText(ROLE_ID)).toBeNull();
    await act(async () => { pending.resolve(Response.json(roleChoices)); });
    await waitFor(() => expect(disabled(select)).toBe(false));
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Technical" }));
    expect(select.textContent).toContain("Technical");
    expect(select.textContent).not.toContain(ROLE_ID);
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    expect((api.writes[0].data as ContactsRead).contacts[0].roleId).toBe(ROLE_ID);
  });

  it("retries failed role choices without losing entered contact data", async () => {
    let unavailable = true;
    const initial = contactsSection({ contacts: [contact(1, { roleId: null })] });
    const api = sectionApi("contacts", initial, { choices: () => unavailable
      ? Response.json({ status: 503, code: "unavailable" }, { status: 503 })
      : Response.json(roleChoices) });
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    const input = await screen.findByRole("textbox", { name: t.fullName });
    await screen.findByText(t.referenceLoadError);
    await user.clear(input);
    await user.type(input, "Keep while retrying");
    const select = screen.getByRole("combobox", { name: t.role });
    expect(disabled(select)).toBe(true);
    unavailable = false;
    await user.click(screen.getByRole("button", { name: t.retry }));
    await waitFor(() => expect(disabled(select)).toBe(false));
    expect(valueOf(input)).toBe("Keep while retrying");
    expect(screen.queryByText(t.referenceLoadError)).toBeNull();
    await user.click(select);
    await user.click(await screen.findByRole("option", { name: "Technical" }));
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.saved);
    expect((api.writes[0].data as ContactsRead).contacts[0]).toMatchObject({ fullName: "Keep while retrying", roleId: ROLE_ID });
  });

  it("links the missing contacts group to its existing form container", async () => {
    sectionApi("contacts", contactsSection({ contacts: [] }, { completeness: { percent: 0, missing: [
      { path: "contacts", code: "required" },
    ] } }));
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findByRole("button", { name: t.addContact });
    await user.click(screen.getByText(t.missingTitle));
    const link = screen.getByRole("link", { name: t.contactsTitle });
    expect(document.getElementById(link.getAttribute("href")!.slice(1))).toBeTruthy();
  });

  it("keeps draft input after a failed save and enables retry", async () => {
    const api = sectionApi("contacts", contactsSection(), { put: problem(500, "internal") });
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findAllByRole("textbox", { name: t.fullName });
    const input = screen.getAllByRole("textbox", { name: t.fullName })[0];
    await user.clear(input);
    await user.type(input, "Unsaved person");
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.errors.internal);
    expect(valueOf(input)).toBe("Unsaved person");
    expect(disabled(screen.getByRole("button", { name: t.save }))).toBe(false);
    expect(api.writes).toHaveLength(1);
  });

  it("409 preserves the draft until an explicit reload replaces it with the newer server values", async () => {
    const api = sectionApi("contacts", contactsSection(), { put: problem(409, "section_changed") });
    const { user } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findAllByRole("textbox", { name: t.fullName });
    const input = screen.getAllByRole("textbox", { name: t.fullName })[0];
    await user.clear(input);
    await user.type(input, "My local edit");
    api.setState(contactsSection({ contacts: [contact(1, { fullName: "Newer server edit" }), contact(2), contact(3)] }, { editVersion: 4 }));
    await user.click(screen.getByRole("button", { name: t.save }));
    await screen.findByText(t.errors.section_changed);
    expect(valueOf(input)).toBe("My local edit");
    expect(api.requests.mock.calls.filter(([url]) => String(url) === api.path && !String(url).includes("?"))).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: t.reloadReplace }));
    await waitFor(() => expect(valueOf(screen.getAllByRole("textbox", { name: t.fullName })[0])).toBe("Newer server edit"));
    expect(screen.queryByText(t.errors.section_changed)).toBeNull();
    expect(disabled(screen.getByRole("button", { name: t.save }))).toBe(true);
  });

  it("unsaved navigation offers Stay without losing input and Discard before leaving", async () => {
    const api = sectionApi("contacts", contactsSection());
    const { user, router } = renderRoute("/profile/contacts", { locale: "en" });
    await screen.findAllByRole("textbox", { name: t.fullName });
    const input = screen.getAllByRole("textbox", { name: t.fullName })[0];
    await user.clear(input);
    await user.type(input, "Keep this person");
    await user.click(screen.getByRole("link", { name: t.backToProfile }));
    let dialog = await screen.findByRole("alertdialog", { name: t.unsavedTitle });
    await user.click(within(dialog).getByRole("button", { name: t.stay }));
    expect(router.state.location.pathname).toBe("/profile/contacts");
    expect(valueOf(input)).toBe("Keep this person");
    await user.click(screen.getByRole("link", { name: t.backToProfile }));
    dialog = await screen.findByRole("alertdialog", { name: t.unsavedTitle });
    await user.click(within(dialog).getByRole("button", { name: t.discard }));
    await screen.findByText(ownProfile().organizationName);
    expect(router.state.location.pathname).toBe("/profile");
    expect(api.writes).toHaveLength(0);
  });
});

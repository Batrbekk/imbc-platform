import { type SectionKind, type SectionRead, type ProductsRead, type ProfileProductWrite } from "@imbc/contracts";
import { screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { ProfileReferencePicker } from "@/features/profile/reference-picker";
import en from "../messages/en.json";
import { stubApi, type ApiReply } from "./support/api";
import { MANUFACTURER, mainSection, overview, ownProfile, uuid } from "./support/profile-fixtures";
import { renderRoute } from "./support/render";

const id = uuid(501); const second = uuid(502);
function sectionApi(kind: SectionKind, data: unknown, replies: Record<string, ApiReply> = {}, overrides: Partial<SectionRead<unknown>> = {}) {
  let current: SectionRead<unknown> = { ...mainSection(), kind, data, ...overrides };
  const writes: { editVersion: number; data: Record<string, unknown> }[] = [];
  const path = `/api/v1/profiles/own/sections/${kind}`;
  const requests = stubApi({
    "GET /api/auth/me": { body: MANUFACTURER }, "GET /api/v1/profiles/own": { body: ownProfile() },
    "GET /api/v1/profiles/own/sections": { body: overview() }, [`GET ${path}`]: () => Response.json(current),
    [`PUT ${path}`]: (_url, init) => {
      const body = JSON.parse(String(init?.body)); writes.push(body);
      current = { ...current, editVersion: current.editVersion + 1, data: { ...(current.data as object), editable: body.data } };
      return Response.json(current);
    }, ...replies,
  });
  return { writes, requests };
}
const emptyPersonnel = { editable: { managersCount: null, engineersCount: null, productionWorkersCount: null, nonresidentCount: null, organisationChartIds: [], cvFileIds: [] },
  totalHeadcount: null, organisationCharts: [], cvs: [] };
const emptyProducts: ProductsRead = { editable: { products: [], unifiedRegisterExtractId: null }, lines: [], extract: null,
  selectedReferences: { commodityTypes: [], tnVed: [], kpved: [], units: [] }, relatedChoices: { sites: [], productCertificates: [] } };
const choices = { items: [], total: 0, page: 1, pageSize: 100 };
const productReplies = {
  "GET /api/v1/profiles/own/sections/products/choices": { body: emptyProducts.relatedChoices },
  ...Object.fromEntries(["commodity_type", "tn_ved", "kpved", "unit"].map((kind) => [`GET /api/v1/dictionaries/${kind}/choices`, { body: choices }])),
};

describe("additional profile editors", () => {
  it("frozen registry facts show available classification names, commodity group and exact capacity unit without current lookups", async () => {
    const names = (en: string) => ({ en, ru: null, kk: null });
    const type = { id: uuid(510), code: "valve", names: names("Valves"), retired: false,
      group: { id: uuid(511), code: "A", names: names("Group A"), retired: false } };
    const tnVed = { id: uuid(512), code: "0000000001", names: names("Classified valve"), retired: false };
    const kpved = { id: uuid(513), code: "25.11", names: names("Metal structures"), retired: false };
    const unit = { id: uuid(514), code: "pieces", names: names("Pieces"), retired: false };
    const row: ProfileProductWrite = { kind: "registry", identityId: id, productionSiteIdentityId: null, note: null, certificateIdentityIds: [] };
    const line: ProductsRead["lines"][number] = { identityId: id, source: "e_ondiris", nameEn: "Registry valve", nameRu: null,
      commodityTypeId: type.id, tnVedCode: tnVed.code, tnVedEntryId: tnVed.id, kpved: [{ code: kpved.code, sourceName: null, entryId: kpved.id }],
      capacityQuantity: "9007199254740993.25", capacityUnitId: unit.id, capacityText: null, inCountryValueShare: "12.5",
      enstruCode: null, enstruName: null, unifiedRegisterRegistrationNumber: "R-1", unifiedRegisterActive: true,
      unifiedRegisterIncludedOn: "2026-01-01", productionSiteIdentityId: null, note: null, certificateIdentityIds: [] };
    const api = sectionApi("products", { ...emptyProducts, editable: { products: [row], unifiedRegisterExtractId: null }, lines: [line], relatedChoices: null,
      selectedReferences: { commodityTypes: [type], tnVed: [tnVed], kpved: [kpved], units: [unit] } }, {}, { profileStatus: "verified", revisionState: "verified" });
    renderRoute("/profile/products", { locale: "en" });
    expect(await screen.findByText("0000000001 — Classified valve")).toBeTruthy();
    expect(screen.getByText("25.11 — Metal structures")).toBeTruthy();
    expect(screen.getByText("valve — Valves · A — Group A")).toBeTruthy();
    expect(screen.getByText("pieces — Pieces")).toBeTruthy();
    expect(screen.getByText("9,007,199,254,740,993.25")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: en.profileProducts.nameEn })).toBeNull();
    expect(api.requests.mock.calls.some(([url]) => String(url).includes("/choices") || String(url).includes("/adata"))).toBe(false);
  });

  it("personnel computes the total and saves a partial draft with optional CVs empty", async () => {
    const api = sectionApi("personnel", emptyPersonnel);
    const { user } = renderRoute("/profile/personnel", { locale: "en" });
    await user.type(await screen.findByRole("spinbutton", { name: en.profilePersonnel.managersCount }), "4");
    await user.type(screen.getByRole("spinbutton", { name: en.profilePersonnel.engineersCount }), "5");
    await user.type(screen.getByRole("spinbutton", { name: en.profilePersonnel.productionWorkersCount }), "6");
    expect((screen.getByRole("textbox", { name: en.profilePersonnel.totalHeadcount }) as HTMLTextAreaElement).value).toBe("15");
    await user.click(screen.getByRole("button", { name: en.profileEditor.save })); await screen.findByText(en.profileEditor.saved);
    expect(api.writes[0].data).toEqual({ ...emptyPersonnel.editable, managersCount: 4, engineersCount: 5, productionWorkersCount: 6 });
    expect(api.writes[0].data).not.toHaveProperty("totalHeadcount");
  });

  it("documents honor the dictionary custom-name flag and save only editable fields", async () => {
    const api = sectionApi("documents", { editable: { documents: [] }, documents: [], requiredTypes: [], requirementSource: "current" }, {
      "GET /api/v1/dictionaries/document_type/choices": { body: { ...choices, total: 1, items: [{ id, code: "named", name: "Named document", parentCode: null, customNameAllowed: true }] } },
    });
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.profileDocuments.add }));
    await waitFor(() => expect((screen.getByRole("combobox", { name: en.profileDocuments.type }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("combobox", { name: en.profileDocuments.type })); await user.click(await screen.findByRole("option", { name: "Named document" }));
    await user.type(await screen.findByRole("textbox", { name: en.profileDocuments.name }), "Additional evidence");
    await user.click(screen.getByRole("button", { name: en.profileEditor.save })); await screen.findByText(en.profileEditor.saved);
    const row = (api.writes[0].data.documents as Record<string, unknown>[])[0];
    expect(row).toMatchObject({ documentTypeId: id, customName: "Additional evidence", fileId: null });
    expect(Object.keys(row).sort()).toEqual(["identityId", "documentTypeId", "customName", "fileId"].sort());
  });

  it("ISO absence clears held fields and stays an explicit declaration in the write DTO", async () => {
    const iso = { id, code: "ISO 9001", names: { en: "ISO 9001", ru: null, kk: null }, customNameAllowed: false };
    const row = { identityId: second, group: "company", certificateTypeId: id, customTypeName: null, notHeld: false, number: "N-1", issuingBody: "Body", issuedOn: "2026-01-01", expiresOn: null, fileId: null };
    const api = sectionApi("certificates", { editable: { certificates: [row] }, certificates: [{ ...row, certificateType: iso, status: "uploaded", file: null }], requiredTypes: [iso], requirementSource: "current" }, {
      "GET /api/v1/dictionaries/certificate_type/choices": { body: { ...choices, total: 1, items: [{ id, code: "ISO 9001", name: "ISO 9001", parentCode: null }] } },
    });
    const { user } = renderRoute("/profile/certificates", { locale: "en" });
    await user.click(await screen.findByRole("checkbox", { name: en.profileCertificates.notHeld }));
    expect(screen.queryByRole("textbox", { name: en.profileCertificates.number })).toBeNull();
    await user.click(screen.getByRole("button", { name: en.profileEditor.save })); await screen.findByText(en.profileEditor.saved);
    expect((api.writes[0].data.certificates as unknown[])[0]).toEqual({ ...row, notHeld: true, number: null, issuingBody: null, issuedOn: null });
  });

  it("manual products keep exact capacity above JS safe integers and source DVC remains readonly", async () => {
    const row: ProfileProductWrite = { kind: "manual", identityId: id, nameEn: "Valve", nameRu: null, commodityTypeId: null,
      tnVedEntryId: null, kpvedEntryIds: [], capacityQuantity: null, capacityUnitId: null, productionSiteIdentityId: null, note: null, certificateIdentityIds: [] };
    const api = sectionApi("products", { ...emptyProducts, editable: { products: [row], unifiedRegisterExtractId: null } }, productReplies);
    const { user } = renderRoute("/profile/products", { locale: "en" });
    await user.type(await screen.findByRole("textbox", { name: en.profileProducts.capacity }), "9007199254740993.123456789");
    expect(screen.getByText(en.profileProducts.dvc).nextElementSibling?.textContent).toBe("0");
    expect(screen.queryByRole("textbox", { name: en.profileProducts.dvc })).toBeNull();
    await user.click(screen.getByRole("button", { name: en.profileEditor.save })); await screen.findByText(en.profileEditor.saved);
    expect((api.writes[0].data.products as ProfileProductWrite[])[0]).toMatchObject({ capacityQuantity: "9007199254740993.123456789", kind: "manual" });
    expect((api.writes[0].data.products as Record<string, unknown>[])[0]).not.toHaveProperty("inCountryValueShare");
  });

  it("optional production saves incomplete equipment and rejects percentage precision before sending", async () => {
    const api = sectionApi("production", { editable: { areaSqm: null, workshopCount: null, utilisationPercent: null, processEntryIds: [], photoIds: [], equipment: [] },
      photos: [], equipmentPhotos: [], selectedReferences: { processes: [], equipmentTypes: [] }, productChoices: [] }, {
      "GET /api/v1/profiles/own/sections/production/choices": { body: [] },
      "GET /api/v1/dictionaries/process/choices": { body: choices }, "GET /api/v1/dictionaries/equipment_type/choices": { body: choices },
    }, { completeness: { percent: 100, missing: [] } });
    const { user } = renderRoute("/profile/production", { locale: "en" });
    await user.click(await screen.findByRole("button", { name: en.profileProduction.add }));
    const utilisation = screen.getByRole("textbox", { name: en.profileProduction.utilisationPercent });
    await user.type(utilisation, "99.999"); await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    expect(await screen.findByText(en.profileEditor.errors.decimal_precision)).toBeTruthy(); expect(api.writes).toHaveLength(0);
    await user.clear(utilisation); await user.type(utilisation, "99.99");
    await user.click(screen.getByRole("button", { name: en.profileEditor.save })); await screen.findByText(en.profileEditor.saved);
    expect(api.writes[0].data).toMatchObject({ utilisationPercent: "99.99", equipment: [{ name: null, typeId: null, quantity: null, photoId: null, productIdentityIds: [] }] });
  });
});

function Picker() {
  const [value, setValue] = useState<string | null>(null);
  return <ProfileReferencePicker kind="tn_ved" path="tnVed" label="TN VED" value={value} selected={[]} disabled={false} errors={{}} onChange={setValue} />;
}
it("TN VED pages retain a selected leading-zero code after another search, without downloading the whole catalogue", async () => {
  const requests = stubApi({ "GET /api/v1/dictionaries/tn_ved/choices": (url) => Response.json({ ...choices,
    total: url.searchParams.get("q") ? 0 : 12000, page: Number(url.searchParams.get("page")),
    items: url.searchParams.get("q") ? [] : [{ id, code: "0000000001", name: "First classification", parentCode: null }],
  }) });
  const { user } = renderRoute("/", { locale: "en", routes: [{ path: "/", element: <Picker /> }] });
  await waitFor(() => expect((screen.getByRole("combobox", { name: "TN VED" }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole("button", { name: en.profileRecords.next }));
  await waitFor(() => expect(requests.mock.calls.some(([url]) => String(url).includes("page=2"))).toBe(true));
  await waitFor(() => expect((screen.getByRole("combobox", { name: "TN VED" }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole("combobox", { name: "TN VED" })); await user.click(await screen.findByRole("option", { name: "0000000001 — First classification" }));
  await user.type(screen.getByRole("textbox", { name: "Search: TN VED" }), "not found");
  await waitFor(() => expect(requests.mock.calls.some(([url]) => String(url).includes("q=not+found"))).toBe(true));
  expect(screen.getByRole("combobox", { name: "TN VED" }).textContent).toContain("0000000001");
  expect(requests.mock.calls.length).toBeLessThan(10);
});

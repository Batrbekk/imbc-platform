// Real section routes and BFF requests: candidate uploads, scan transitions and captured versions.
import {
  ownDocumentsSchema,
  ownPersonnelSchema,
  ownProductionSchema,
  profileFileSchema,
  type DocumentsRead,
  type DocumentsWrite,
  type PersonnelRead,
  type PersonnelWrite,
  type ProfileFile,
  type ProductionRead,
  type ProductionWrite,
  type SectionRead,
} from "@imbc/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { problem, stubApi, type ApiReply } from "./support/api";
import { mainSection, MANUFACTURER, overview, ownProfile, uuid } from "./support/profile-fixtures";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

const OLD_FILE = uuid(200);
const NEW_FILE = uuid(201);
const SECOND_FILE = uuid(202);
const DOCUMENT_TYPE = {
  id: uuid(400),
  code: "additional_document",
  customNameAllowed: true,
  names: { en: "Additional document", ru: "Дополнительный документ", kk: "Қосымша құжат" },
};
const documentChoices = {
  items: [
    {
      id: DOCUMENT_TYPE.id,
      code: DOCUMENT_TYPE.code,
      name: DOCUMENT_TYPE.names.en,
      parentCode: null,
      customNameAllowed: true,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 100,
};
const personnelEmpty: PersonnelWrite = {
  managersCount: null,
  engineersCount: null,
  productionWorkersCount: null,
  nonresidentCount: null,
  organisationChartIds: [],
  cvFileIds: [],
};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const pdf = (name: string) => new File(["%PDF-1.7\nfixture\n%%EOF"], name, { type: "application/pdf" });
const chooseLabel = (label: string, template = en.profileAttachments.choose) => template.replace("{label}", label);
const downloadLabel = (version: number, template = en.profileAttachments.download) =>
  template.replace("{version}", String(version));

function file(fileId: string, overrides: Partial<ProfileFile> = {}): ProfileFile {
  return profileFileSchema.parse({
    fileId,
    versionId: uuid(fileId === OLD_FILE ? 500 : 501),
    versionNumber: 1,
    originalName: "Organisation chart.pdf",
    byteSize: 2048,
    mediaType: "application/pdf",
    scanState: "passed",
    rejectionReason: null,
    uploadedAt: "2026-11-16T06:00:00.000Z",
    canDownload: true,
    ...overrides,
  });
}
const pendingFile = (fileId = NEW_FILE, name = "New chart.pdf") =>
  file(fileId, {
    originalName: name,
    scanState: "pending",
    canDownload: false,
  });
function personnelSection(
  data: Partial<PersonnelRead> = {},
  overrides: Partial<SectionRead<PersonnelRead>> = {},
): SectionRead<PersonnelRead> {
  return ownPersonnelSchema.parse({
    ...mainSection(),
    kind: "personnel",
    data: { editable: personnelEmpty, totalHeadcount: null, organisationCharts: [], cvs: [], ...data },
    ...overrides,
  });
}
function documentRow(
  identityId: string,
  customName: string,
  fileId: string | null = null,
): DocumentsWrite["documents"][number] {
  return { identityId, documentTypeId: DOCUMENT_TYPE.id, customName, fileId };
}
function documentsSection(rows: DocumentsWrite["documents"], files: ProfileFile[] = []): SectionRead<DocumentsRead> {
  return ownDocumentsSchema.parse({
    ...mainSection(),
    kind: "documents",
    data: {
      editable: { documents: rows },
      requiredTypes: [],
      requirementSource: "current",
      documents: rows.map((row) => ({
        identityId: row.identityId,
        documentType: DOCUMENT_TYPE,
        status: "uploaded",
        file: files.find((file) => file.fileId === row.fileId) ?? null,
      })),
    },
  });
}
function productionSection(data: Partial<ProductionRead> = {}): SectionRead<ProductionRead> {
  return ownProductionSchema.parse({
    ...mainSection(),
    kind: "production",
    completeness: { percent: 100, missing: [] },
    data: {
      editable: {
        areaSqm: null,
        workshopCount: null,
        utilisationPercent: null,
        processEntryIds: [],
        photoIds: [],
        equipment: [],
      },
      photos: [],
      equipmentPhotos: [],
      selectedReferences: { processes: [], equipmentTypes: [] },
      productChoices: [],
      ...data,
    },
  });
}

/** A stateful BFF: PUT saves the draft; later GET returns the same stored section. */
function sectionApi<
  Read extends PersonnelRead | DocumentsRead | ProductionRead,
  Write extends PersonnelWrite | DocumentsWrite | ProductionWrite,
>(
  kind: "personnel" | "documents" | "production",
  initial: SectionRead<Read>,
  extras: Record<string, ApiReply> = {},
  saveData?: (write: Write, current: Read) => Read,
) {
  const path = `/api/v1/profiles/own/sections/${kind}`;
  let current = initial;
  const writes: { editVersion: number; data: Write }[] = [];
  const requests = stubApi({
    "GET /api/auth/me": { body: MANUFACTURER },
    "GET /api/v1/profiles/own": { body: ownProfile({ status: initial.profileStatus }) },
    "GET /api/v1/profiles/own/sections": { body: overview() },
    "GET /api/v1/dictionaries/document_type/choices": { body: documentChoices },
    [`GET ${path}`]: () => Response.json(current),
    [`PUT ${path}`]: (_url, init) => {
      const write = JSON.parse(String(init?.body)) as { editVersion: number; data: Write };
      writes.push(write);
      current = {
        ...current,
        editVersion: current.editVersion + 1,
        savedAt: "2026-11-16T06:10:00Z",
        data: saveData ? saveData(write.data, current.data) : ({ ...current.data, editable: write.data } as Read),
      };
      return Response.json(current);
    },
    ...extras,
  });
  return {
    requests,
    writes,
    path,
    setState: (next: SectionRead<Read>) => {
      current = next;
    },
  };
}
const chartRegion = () => screen.getByRole("region", { name: en.profilePersonnel.organisationCharts });
const documentCard = (index: number) => {
  const card = document.getElementById(`profile-documents-${index}`);
  if (!card) throw new Error(`Document ${index} not rendered`);
  return card;
};
const equipmentCard = (index: number) => {
  const card = document.getElementById(`profile-equipment-${index}`);
  if (!card) throw new Error(`Equipment ${index} not rendered`);
  return card;
};
const requestCount = (requests: ReturnType<typeof stubApi>, method: string, path: string) =>
  requests.mock.calls.filter(([url, init]) => (init?.method ?? "GET") === method && String(url).startsWith(path))
    .length;

describe("manufacturer attachments in real section forms (MAN-19, MAN-36, DATA-07)", () => {
  it.each(["passed", "rejected"] as const)(
    "a dirty draft observes a saved file becoming %s without replacing input or its editVersion",
    async (scanState) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const savedFile = pendingFile(OLD_FILE, "Saved chart.pdf");
      const initial = personnelSection({
        editable: { ...personnelEmpty, managersCount: 1, organisationChartIds: [OLD_FILE] },
        organisationCharts: [savedFile],
      });
      const attempts: { editVersion: number; data: PersonnelWrite }[] = [];
      const api = sectionApi<PersonnelRead, PersonnelWrite>("personnel", initial, {
        "PUT /api/v1/profiles/own/sections/personnel": (_url, init) => {
          attempts.push(JSON.parse(String(init?.body)) as { editVersion: number; data: PersonnelWrite });
          return Response.json(
            { status: 409, code: "section_changed" },
            {
              status: 409,
              headers: { "content-type": "application/problem+json" },
            },
          );
        },
      });
      const { user } = renderRoute("/profile/personnel", { locale: "en" });
      const managers = await screen.findByRole("spinbutton", { name: en.profilePersonnel.managersCount });
      await user.clear(managers);
      await user.type(managers, "7");
      expect(within(chartRegion()).getByText(en.profileAttachments.state.pending)).toBeTruthy();
      const terminal = file(OLD_FILE, {
        originalName: savedFile.originalName,
        versionId: savedFile.versionId,
        scanState,
        rejectionReason: scanState === "rejected" ? "malware" : null,
        canDownload: scanState === "passed",
      });
      // Another editor changed content meanwhile; only matching file-version observations may refresh this draft.
      api.setState(
        personnelSection(
          { editable: { ...initial.data.editable, managersCount: 99 }, organisationCharts: [terminal] },
          { editVersion: 4 },
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
      expect(await within(chartRegion()).findByText(en.profileAttachments.state[scanState])).toBeTruthy();
      expect(within(chartRegion()).queryByText(en.profileAttachments.state.pending)).toBeNull();
      expect((managers as HTMLInputElement).value).toBe("7");
      if (scanState === "passed")
        expect(
          within(chartRegion())
            .getByRole("link", { name: downloadLabel(1) })
            .getAttribute("href"),
        ).toBe(`/api/v1/files/${OLD_FILE}/content?version=1`);
      else {
        expect(within(chartRegion()).getByText(en.profileAttachments.reason.malware)).toBeTruthy();
        expect(within(chartRegion()).queryAllByRole("link")).toHaveLength(0);
      }
      expect(
        requestCount(api.requests, "GET", "/api/v1/profiles/own/sections/personnel/files/organisation_chart/"),
      ).toBe(0);
      await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
      await screen.findByText(en.profileEditor.errors.section_changed);
      expect(attempts).toEqual([
        { editVersion: 3, data: { ...personnelEmpty, managersCount: 7, organisationChartIds: [OLD_FILE] } },
      ]);
      expect((managers as HTMLInputElement).value).toBe("7");
    },
  );

  it.each(["chart-first", "cv-first"] as const)(
    "sibling uploads resolved in the same React batch preserve both IDs and prior counts (%s)",
    async (order) => {
      const chartUpload = deferred<Response>();
      const cvUpload = deferred<Response>();
      const chartTarget = "/api/v1/profiles/own/sections/personnel/files/organisation_chart";
      const cvTarget = "/api/v1/profiles/own/sections/personnel/files/cv";
      const original = {
        ...personnelEmpty,
        managersCount: 5,
        engineersCount: 2,
        productionWorkersCount: 3,
        nonresidentCount: 1,
      };
      const api = sectionApi<PersonnelRead, PersonnelWrite>(
        "personnel",
        personnelSection({ editable: original, totalHeadcount: 10 }),
        {
          [`POST ${chartTarget}`]: () => chartUpload.promise,
          [`POST ${cvTarget}`]: () => cvUpload.promise,
          [`GET ${chartTarget}/${NEW_FILE}`]: {
            body: { upload: file(NEW_FILE, { originalName: "Sibling chart.pdf" }) },
          },
          [`GET ${cvTarget}/${SECOND_FILE}`]: {
            body: { upload: file(SECOND_FILE, { originalName: "Sibling CV.pdf" }) },
          },
        },
      );
      const { user } = renderRoute("/profile/personnel", { locale: "en" });
      const managers = await screen.findByRole("spinbutton", { name: en.profilePersonnel.managersCount });
      await user.clear(managers);
      await user.type(managers, "7");
      await user.upload(
        screen.getByLabelText(chooseLabel(en.profilePersonnel.organisationCharts)),
        pdf("Sibling chart.pdf"),
      );
      await user.upload(screen.getByLabelText(chooseLabel(en.profilePersonnel.cvs)), pdf("Sibling CV.pdf"));
      expect(requestCount(api.requests, "POST", chartTarget)).toBe(1);
      expect(requestCount(api.requests, "POST", cvTarget)).toBe(1);
      await act(async () => {
        const chartResult = Response.json({ upload: pendingFile(NEW_FILE, "Sibling chart.pdf") }, { status: 202 });
        const cvResult = Response.json({ upload: pendingFile(SECOND_FILE, "Sibling CV.pdf") }, { status: 202 });
        if (order === "chart-first") {
          chartUpload.resolve(chartResult);
          cvUpload.resolve(cvResult);
        } else {
          cvUpload.resolve(cvResult);
          chartUpload.resolve(chartResult);
        }
      });
      await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
      await screen.findByText(en.profileEditor.saved);
      expect(api.writes).toEqual([
        {
          editVersion: 3,
          data: { ...original, managersCount: 7, organisationChartIds: [NEW_FILE], cvFileIds: [SECOND_FILE] },
        },
      ]);
    },
  );

  it("an equivalent Production poll keeps an in-flight equipment upload mounted and a batched name edit keeps its late photo", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const upload = deferred<Response>();
    const existing = { name: "Existing press", typeId: null, quantity: 1, photoId: OLD_FILE, productIdentityIds: [] };
    const waiting = { name: "Lathe", typeId: null, quantity: 2, photoId: null, productIdentityIds: [] };
    const editable: ProductionWrite = {
      areaSqm: "1000",
      workshopCount: 1,
      utilisationPercent: "50",
      processEntryIds: [],
      photoIds: [],
      equipment: [existing, waiting],
    };
    const initial = productionSection({
      editable,
      equipmentPhotos: [pendingFile(OLD_FILE, "Existing press.pdf"), null],
    });
    const target = "/api/v1/profiles/own/sections/production/files/production_photo";
    const choices = { items: [], total: 0, page: 1, pageSize: 100 };
    const api = sectionApi<ProductionRead, ProductionWrite>("production", initial, {
      "GET /api/v1/profiles/own/sections/production/choices": { body: [] },
      "GET /api/v1/dictionaries/process/choices": { body: choices },
      "GET /api/v1/dictionaries/equipment_type/choices": { body: choices },
      [`POST ${target}`]: () => upload.promise,
      [`GET ${target}/${NEW_FILE}`]: {
        body: { upload: file(NEW_FILE, { originalName: "Lathe.png", mediaType: "image/png" }) },
      },
    });
    const { user } = renderRoute("/profile/production", { locale: "en" });
    await screen.findAllByRole("textbox", { name: en.profileProduction.name });
    await user.upload(
      within(equipmentCard(1)).getByLabelText(chooseLabel(en.profileProduction.equipmentPhoto)),
      new File(["image fixture"], "Lathe.png", { type: "image/png" }),
    );
    const uploadButton = within(equipmentCard(1)).getByRole("button", { name: en.profileAttachments.uploading });
    expect(uploadButton).toBeTruthy();
    // Fresh JSON objects with equivalent editable values must not replace the WeakMap-keyed local rows.
    api.setState(
      productionSection({
        editable: structuredClone(editable),
        equipmentPhotos: [file(OLD_FILE, { originalName: "Existing press.pdf" }), null],
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(within(equipmentCard(0)).getByText(en.profileAttachments.state.passed)).toBeTruthy();
    expect(within(equipmentCard(1)).getByRole("button", { name: en.profileAttachments.uploading })).toBe(uploadButton);
    const name = within(equipmentCard(1)).getByRole("textbox", { name: en.profileProduction.name });
    await act(async () => {
      fireEvent.change(name, { target: { value: "Lathe with revised name" } });
      upload.resolve(
        Response.json({ upload: { ...pendingFile(NEW_FILE, "Lathe.png"), mediaType: "image/png" } }, { status: 202 }),
      );
    });
    expect(await within(equipmentCard(1)).findByText("Lathe.png")).toBeTruthy();
    expect(
      (within(equipmentCard(1)).getByRole("textbox", { name: en.profileProduction.name }) as HTMLInputElement).value,
    ).toBe("Lathe with revised name");
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(api.writes).toEqual([
      {
        editVersion: 3,
        data: {
          ...editable,
          equipment: [existing, { ...waiting, name: "Lathe with revised name", photoId: NEW_FILE }],
        },
      },
    ]);
  });

  it("POST creates a pending candidate, GET enables exact-version download, and a concurrent count edit survives until explicit Save", async () => {
    const upload = deferred<Response>();
    const scan = deferred<Response>();
    const uploaded = pendingFile();
    const post = "/api/v1/profiles/own/sections/personnel/files/organisation_chart";
    const api = sectionApi<PersonnelRead, PersonnelWrite>("personnel", personnelSection(), {
      [`POST ${post}`]: () => upload.promise,
      [`GET ${post}/${NEW_FILE}`]: () => scan.promise,
    });
    const { user } = renderRoute("/profile/personnel", { locale: "en" });
    const input = await screen.findByLabelText(chooseLabel(en.profilePersonnel.organisationCharts));
    await user.upload(input, pdf("New chart.pdf"));
    expect(within(chartRegion()).getByRole("button", { name: en.profileAttachments.uploading })).toBeTruthy();
    await user.type(screen.getByRole("spinbutton", { name: en.profilePersonnel.managersCount }), "7");
    await act(async () => {
      upload.resolve(Response.json({ upload: uploaded }, { status: 202 }));
    });
    expect(await within(chartRegion()).findByText(en.profileAttachments.state.pending)).toBeTruthy();
    expect(within(chartRegion()).queryAllByRole("link")).toHaveLength(0);
    expect(api.writes).toEqual([]);
    expect(
      (screen.getByRole("spinbutton", { name: en.profilePersonnel.managersCount }) as HTMLInputElement).value,
    ).toBe("7");
    await act(async () => {
      scan.resolve(Response.json({ upload: file(NEW_FILE, { originalName: uploaded.originalName }) }));
    });
    const download = await within(chartRegion()).findByRole("link", { name: downloadLabel(1) });
    expect(download.getAttribute("href")).toBe(`/api/v1/files/${NEW_FILE}/content?version=1`);
    const postCall = api.requests.mock.calls.find(([url, init]) => String(url) === post && init?.method === "POST")!;
    expect(postCall[1]!.body).toBeInstanceOf(FormData);
    expect((postCall[1]!.body as FormData).get("file")).toBeInstanceOf(File);
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(api.writes).toEqual([
      { editVersion: 3, data: { ...personnelEmpty, managersCount: 7, organisationChartIds: [NEW_FILE] } },
    ]);
    expect(api.requests.mock.calls.some(([url]) => String(url).includes("/versions"))).toBe(false);
  });

  it("a rejected scan shows its localized reason and never exposes a download", async () => {
    const uploaded = pendingFile();
    const target = "/api/v1/profiles/own/sections/personnel/files/organisation_chart";
    const api = sectionApi<PersonnelRead, PersonnelWrite>("personnel", personnelSection(), {
      [`POST ${target}`]: { status: 202, body: { upload: uploaded } },
      [`GET ${target}/${NEW_FILE}`]: {
        body: {
          upload: file(NEW_FILE, {
            originalName: uploaded.originalName,
            scanState: "rejected",
            rejectionReason: "encrypted",
            canDownload: false,
          }),
        },
      },
    });
    const { user } = renderRoute("/profile/personnel", { locale: "kk" });
    await user.upload(
      await screen.findByLabelText(chooseLabel(kk.profilePersonnel.organisationCharts, kk.profileAttachments.choose)),
      pdf("New chart.pdf"),
    );
    const region = screen.getByRole("region", { name: kk.profilePersonnel.organisationCharts });
    expect(await within(region).findByText(kk.profileAttachments.reason.encrypted)).toBeTruthy();
    expect(within(region).getByText(kk.profileAttachments.state.rejected)).toBeTruthy();
    expect(within(region).queryAllByRole("link")).toHaveLength(0);
    expect(api.writes).toEqual([]);
  });

  it.each([
    ["en", en],
    ["ru", ru],
    ["kk", kk],
  ] as const)(
    "a frozen section in %s downloads captured version 3 and makes no latest-upload request",
    async (locale, messages) => {
      const captured = file(OLD_FILE, { versionId: uuid(503), versionNumber: 3, originalName: "Captured chart.pdf" });
      const api = sectionApi<PersonnelRead, PersonnelWrite>(
        "personnel",
        personnelSection(
          {
            editable: { ...personnelEmpty, organisationChartIds: [OLD_FILE] },
            organisationCharts: [captured],
          },
          { profileStatus: "verified", revisionState: "verified", readOnly: false },
        ),
      );
      renderRoute("/profile/personnel", { locale });
      const region = await screen.findByRole("region", { name: messages.profilePersonnel.organisationCharts });
      expect(
        within(region)
          .getByRole("link", { name: downloadLabel(3, messages.profileAttachments.download) })
          .getAttribute("href"),
      ).toBe(`/api/v1/files/${OLD_FILE}/content?version=3`);
      expect(within(region).queryByRole("button", { name: messages.profileAttachments.upload })).toBeNull();
      expect(
        (
          within(region).getByLabelText(
            chooseLabel(messages.profilePersonnel.organisationCharts, messages.profileAttachments.choose),
          ) as HTMLInputElement
        ).disabled,
      ).toBe(true);
      expect(
        requestCount(api.requests, "GET", "/api/v1/profiles/own/sections/personnel/files/organisation_chart/"),
      ).toBe(0);
      expect(api.writes).toEqual([]);
    },
  );

  it("replacing a document creates a new file object at version 1 and only Save replaces its binding", async () => {
    const row = documentRow(uuid(300), "Working instructions", OLD_FILE);
    const target = "/api/v1/profiles/own/sections/documents/files/document_file";
    const uploaded = pendingFile(NEW_FILE, "Replacement.pdf");
    const api = sectionApi<DocumentsRead, DocumentsWrite>(
      "documents",
      documentsSection([row], [file(OLD_FILE, { versionNumber: 4 })]),
      {
        [`POST ${target}`]: { status: 202, body: { upload: uploaded } },
        [`GET ${target}/${NEW_FILE}`]: { body: { upload: file(NEW_FILE, { originalName: uploaded.originalName }) } },
      },
    );
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    await screen.findByRole("textbox", { name: en.profileDocuments.name });
    expect(
      within(documentCard(0))
        .getByRole("link", { name: downloadLabel(4) })
        .getAttribute("href"),
    ).toBe(`/api/v1/files/${OLD_FILE}/content?version=4`);
    await user.upload(
      within(documentCard(0)).getByLabelText(chooseLabel(en.profileDocuments.file)),
      pdf("Replacement.pdf"),
    );
    expect(await within(documentCard(0)).findByRole("link", { name: downloadLabel(1) })).toBeTruthy();
    expect(within(documentCard(0)).queryByRole("link", { name: downloadLabel(4) })).toBeNull();
    expect(api.writes).toEqual([]);
    expect(requestCount(api.requests, "POST", target)).toBe(1);
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(api.writes).toEqual([{ editVersion: 3, data: { documents: [{ ...row, fileId: NEW_FILE }] } }]);
    expect(api.requests.mock.calls.some(([url]) => String(url).includes(`/files/${OLD_FILE}/versions`))).toBe(false);
  });

  it("removing a document during a deferred upload never attaches the late result to the next row", async () => {
    const upload = deferred<Response>();
    const first = documentRow(uuid(300), "First document");
    const second = documentRow(uuid(301), "Second document");
    const target = "/api/v1/profiles/own/sections/documents/files/document_file";
    const api = sectionApi<DocumentsRead, DocumentsWrite>("documents", documentsSection([first, second]), {
      [`POST ${target}`]: () => upload.promise,
    });
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    await screen.findAllByRole("textbox", { name: en.profileDocuments.name });
    await user.upload(
      within(documentCard(0)).getByLabelText(chooseLabel(en.profileDocuments.file)),
      pdf("Removed-row.pdf"),
    );
    await user.click(within(documentCard(0)).getByRole("button", { name: en.profileEditor.remove }));
    expect(
      (within(documentCard(0)).getByRole("textbox", { name: en.profileDocuments.name }) as HTMLInputElement).value,
    ).toBe("Second document");
    await act(async () => {
      upload.resolve(Response.json({ upload: pendingFile(NEW_FILE, "Removed-row.pdf") }, { status: 202 }));
    });
    expect(screen.queryByText("Removed-row.pdf")).toBeNull();
    expect(requestCount(api.requests, "GET", `${target}/${NEW_FILE}`)).toBe(0);
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(api.writes).toEqual([{ editVersion: 3, data: { documents: [second] } }]);
  });

  it("reordering a document during its upload follows its stable identity and preserves its current name", async () => {
    const upload = deferred<Response>();
    const first = documentRow(uuid(300), "First document");
    const second = documentRow(uuid(301), "Second document");
    const target = "/api/v1/profiles/own/sections/documents/files/document_file";
    const api = sectionApi<DocumentsRead, DocumentsWrite>("documents", documentsSection([first, second]), {
      [`POST ${target}`]: () => upload.promise,
      [`GET ${target}/${NEW_FILE}`]: { body: { upload: file(NEW_FILE, { originalName: "Reordered.pdf" }) } },
    });
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    await screen.findAllByRole("textbox", { name: en.profileDocuments.name });
    await user.upload(
      within(documentCard(0)).getByLabelText(chooseLabel(en.profileDocuments.file)),
      pdf("Reordered.pdf"),
    );
    await user.click(within(documentCard(0)).getByRole("button", { name: en.profileEditor.moveDown }));
    await user.type(within(documentCard(1)).getByRole("textbox", { name: en.profileDocuments.name }), " updated");
    await act(async () => {
      upload.resolve(Response.json({ upload: pendingFile(NEW_FILE, "Reordered.pdf") }, { status: 202 }));
    });
    expect(await within(documentCard(1)).findByText("Reordered.pdf")).toBeTruthy();
    expect(within(documentCard(0)).queryByText("Reordered.pdf")).toBeNull();
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(api.writes[0].data).toEqual({
      documents: [second, { ...first, customName: "First document updated", fileId: NEW_FILE }],
    });
  });

  it("a saved passed server file replaces local pending metadata and stops candidate polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const uploaded = pendingFile();
    const target = "/api/v1/profiles/own/sections/personnel/files/organisation_chart";
    const api = sectionApi<PersonnelRead, PersonnelWrite>(
      "personnel",
      personnelSection(),
      {
        [`POST ${target}`]: { status: 202, body: { upload: uploaded } },
        [`GET ${target}/${NEW_FILE}`]: { body: { upload: uploaded } },
      },
      (editable) => ({
        editable,
        totalHeadcount: null,
        organisationCharts: [file(NEW_FILE, { originalName: uploaded.originalName })],
        cvs: [],
      }),
    );
    const { user } = renderRoute("/profile/personnel", { locale: "en" });
    await user.upload(
      await screen.findByLabelText(chooseLabel(en.profilePersonnel.organisationCharts)),
      pdf("New chart.pdf"),
    );
    await within(chartRegion()).findByText(en.profileAttachments.state.pending);
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(within(chartRegion()).getByText(en.profileAttachments.state.passed)).toBeTruthy();
    expect(within(chartRegion()).queryByText(en.profileAttachments.state.pending)).toBeNull();
    expect(within(chartRegion()).getByRole("link", { name: downloadLabel(1) })).toBeTruthy();
    const before = requestCount(api.requests, "GET", `${target}/${NEW_FILE}`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(requestCount(api.requests, "GET", `${target}/${NEW_FILE}`)).toBe(before);
  });

  it("an unsaved candidate polls while pending, enables download when passed and stops polling", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let scanState: "pending" | "passed" = "pending";
    const target = "/api/v1/profiles/own/sections/personnel/files/organisation_chart";
    const api = sectionApi<PersonnelRead, PersonnelWrite>("personnel", personnelSection(), {
      [`POST ${target}`]: { status: 202, body: { upload: pendingFile() } },
      [`GET ${target}/${NEW_FILE}`]: () =>
        Response.json({
          upload: scanState === "pending" ? pendingFile() : file(NEW_FILE, { originalName: "New chart.pdf" }),
        }),
    });
    const { user } = renderRoute("/profile/personnel", { locale: "en" });
    await user.upload(
      await screen.findByLabelText(chooseLabel(en.profilePersonnel.organisationCharts)),
      pdf("New chart.pdf"),
    );
    await within(chartRegion()).findByText(en.profileAttachments.state.pending);
    await waitFor(() => expect(requestCount(api.requests, "GET", `${target}/${NEW_FILE}`)).toBe(1));
    scanState = "passed";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(await within(chartRegion()).findByRole("link", { name: downloadLabel(1) })).toBeTruthy();
    const afterScan = requestCount(api.requests, "GET", `${target}/${NEW_FILE}`);
    expect(afterScan).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(requestCount(api.requests, "GET", `${target}/${NEW_FILE}`)).toBe(afterScan);
    expect(api.writes).toEqual([]);
  });

  it("scan-status failure keeps the candidate in the draft and explicit Retry can enable download", async () => {
    let failed = true;
    const target = "/api/v1/profiles/own/sections/personnel/files/organisation_chart";
    const api = sectionApi<PersonnelRead, PersonnelWrite>("personnel", personnelSection(), {
      [`POST ${target}`]: { status: 202, body: { upload: pendingFile() } },
      [`GET ${target}/${NEW_FILE}`]: () =>
        failed
          ? Response.json(
              { status: 503, code: "storage_unavailable" },
              { status: 503, headers: { "content-type": "application/problem+json" } },
            )
          : Response.json({ upload: file(NEW_FILE, { originalName: "New chart.pdf" }) }),
    });
    const { user } = renderRoute("/profile/personnel", { locale: "en" });
    await user.upload(
      await screen.findByLabelText(chooseLabel(en.profilePersonnel.organisationCharts)),
      pdf("New chart.pdf"),
    );
    expect(await within(chartRegion()).findByText(en.profileAttachments.statusError)).toBeTruthy();
    expect(within(chartRegion()).getByText("New chart.pdf")).toBeTruthy();
    expect(within(chartRegion()).queryAllByRole("link")).toHaveLength(0);
    failed = false;
    await user.click(within(chartRegion()).getByRole("button", { name: en.profileAttachments.retry }));
    expect(await within(chartRegion()).findByRole("link", { name: downloadLabel(1) })).toBeTruthy();
    expect(within(chartRegion()).queryByText(en.profileAttachments.statusError)).toBeNull();
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(api.writes[0].data.organisationChartIds).toEqual([NEW_FILE]);
  });

  it("a failed replacement upload leaves the old document binding and edited name intact", async () => {
    const row = documentRow(uuid(300), "Old document", OLD_FILE);
    const target = "/api/v1/profiles/own/sections/documents/files/document_file";
    const api = sectionApi<DocumentsRead, DocumentsWrite>("documents", documentsSection([row], [file(OLD_FILE)]), {
      [`POST ${target}`]: problem(422, "file_encrypted"),
    });
    const { user } = renderRoute("/profile/documents", { locale: "en" });
    const name = await screen.findByRole("textbox", { name: en.profileDocuments.name });
    await user.type(name, " updated");
    await user.upload(
      within(documentCard(0)).getByLabelText(chooseLabel(en.profileDocuments.file)),
      pdf("Protected.pdf"),
    );
    expect(await within(documentCard(0)).findByText(en.profileAttachments.error.file_encrypted)).toBeTruthy();
    expect(
      within(documentCard(0))
        .getByRole("link", { name: downloadLabel(1) })
        .getAttribute("href"),
    ).toBe(`/api/v1/files/${OLD_FILE}/content?version=1`);
    await user.click(screen.getByRole("button", { name: en.profileEditor.save }));
    await screen.findByText(en.profileEditor.saved);
    expect(api.writes[0].data).toEqual({ documents: [{ ...row, customName: "Old document updated" }] });
  });

  it("history loads on expansion, keeps recorded old-version downloads and paginates independently of the current file", async () => {
    const current = file(OLD_FILE, { versionNumber: 3, versionId: uuid(503), originalName: "Current v3.pdf" });
    const historyPath = "/api/v1/profiles/own/sections/personnel/files/history";
    const api = sectionApi<PersonnelRead, PersonnelWrite>(
      "personnel",
      personnelSection({
        editable: { ...personnelEmpty, organisationChartIds: [OLD_FILE] },
        organisationCharts: [current],
      }),
      {
        [`GET ${historyPath}?offset=0&limit=50`]: {
          body: {
            total: 51,
            offset: 0,
            limit: 50,
            items: [
              {
                id: uuid(700),
                revisionId: uuid(20),
                editVersion: 1,
                recordedAt: "2026-11-14T06:00:00.000Z",
                file: file(OLD_FILE, { originalName: "Old v1.pdf" }),
              },
              {
                id: uuid(701),
                revisionId: uuid(20),
                editVersion: 2,
                recordedAt: "2026-11-15T06:00:00.000Z",
                file: file(OLD_FILE, {
                  versionNumber: 2,
                  versionId: uuid(502),
                  originalName: "Rejected v2.pdf",
                  scanState: "rejected",
                  rejectionReason: "malware",
                  canDownload: false,
                }),
              },
            ],
          },
        },
        [`GET ${historyPath}?offset=50&limit=50`]: {
          body: {
            total: 51,
            offset: 50,
            limit: 50,
            items: [
              {
                id: uuid(702),
                revisionId: uuid(20),
                editVersion: 0,
                recordedAt: "2026-11-13T06:00:00.000Z",
                file: file(SECOND_FILE, { originalName: "Another old file.pdf" }),
              },
            ],
          },
        },
      },
    );
    const { user } = renderRoute("/profile/personnel", { locale: "en" });
    await screen.findByText("Current v3.pdf");
    expect(requestCount(api.requests, "GET", historyPath)).toBe(0);
    await user.click(screen.getByText(en.profileAttachments.history));
    await screen.findByText("Old v1.pdf");
    const history = screen.getByText(en.profileAttachments.history).closest("details")!;
    expect(
      within(history)
        .getByRole("link", { name: downloadLabel(1) })
        .getAttribute("href"),
    ).toBe(`/api/v1/files/${OLD_FILE}/content?version=1`);
    expect(within(history).queryByRole("link", { name: downloadLabel(2) })).toBeNull();
    expect(within(history).getByText(en.profileAttachments.reason.malware)).toBeTruthy();
    expect(
      within(chartRegion())
        .getByRole("link", { name: downloadLabel(3) })
        .getAttribute("href"),
    ).toBe(`/api/v1/files/${OLD_FILE}/content?version=3`);
    await user.click(within(history).getByRole("button", { name: en.profileRecords.next }));
    await within(history).findByText("Another old file.pdf");
    expect(
      within(history)
        .getByRole("link", { name: downloadLabel(1) })
        .getAttribute("href"),
    ).toBe(`/api/v1/files/${SECOND_FILE}/content?version=1`);
    expect(requestCount(api.requests, "GET", `${historyPath}?offset=50&limit=50`)).toBe(1);
    expect(within(chartRegion()).getByText("Current v3.pdf")).toBeTruthy();
  });

  it("a temporary history failure offers Retry without replacing the current attachment", async () => {
    let failed = true;
    const current = file(OLD_FILE, { versionNumber: 3, versionId: uuid(503), originalName: "Current v3.pdf" });
    const historyPath = "/api/v1/profiles/own/sections/personnel/files/history";
    const api = sectionApi<PersonnelRead, PersonnelWrite>(
      "personnel",
      personnelSection({
        editable: { ...personnelEmpty, organisationChartIds: [OLD_FILE] },
        organisationCharts: [current],
      }),
      {
        [`GET ${historyPath}`]: () =>
          failed
            ? Response.json(
                { status: 503, code: "busy" },
                { status: 503, headers: { "content-type": "application/problem+json" } },
              )
            : Response.json({
                total: 1,
                offset: 0,
                limit: 50,
                items: [
                  {
                    id: uuid(700),
                    revisionId: uuid(20),
                    editVersion: 1,
                    recordedAt: "2026-11-14T06:00:00.000Z",
                    file: file(OLD_FILE, { originalName: "Old v1.pdf" }),
                  },
                ],
              }),
      },
    );
    const { user } = renderRoute("/profile/personnel", { locale: "en" });
    await screen.findByText("Current v3.pdf");
    await user.click(screen.getByText(en.profileAttachments.history));
    const history = screen.getByText(en.profileAttachments.history).closest("details")!;
    await within(history).findByText(en.profileAttachments.historyError);
    expect(within(chartRegion()).getByRole("link", { name: downloadLabel(3) })).toBeTruthy();
    failed = false;
    await user.click(within(history).getByRole("button", { name: en.profileAttachments.retry }));
    expect(await within(history).findByRole("link", { name: downloadLabel(1) })).toBeTruthy();
    expect(within(history).queryByText(en.profileAttachments.historyError)).toBeNull();
    expect(requestCount(api.requests, "GET", historyPath)).toBe(2);
    expect(api.writes).toEqual([]);
  });
});

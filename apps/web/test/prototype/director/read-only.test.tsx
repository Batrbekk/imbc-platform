// GEN-04: генеральный директор IMBC читает всё и ничего не меняет. Тест обходит каждый экран кабинета, нажимает
// каждую кнопку, вкладку и выпадающий фильтр (всё, что не ссылка) и проверяет, что хранилище не изменилось ни
// на байт — чтение не пишет даже события «просмотрено». Части экранов SME и администратора с `readOnly`
// не рисуют ни одного элемента, меняющего данные.
import { cleanup, screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ForecastVersionsView,
  OrgChartSampleView,
  ReferenceListView,
  TechFilesView,
} from "@/prototype/administrator/shared";
import { createInitialState } from "@/prototype/data";
import { DossierSections, DueDiligenceView, SiteSurveyList, TierRecordsList } from "@/prototype/expert/dossier";
import { setProtoState, STORAGE_KEY } from "@/prototype/store";

import { renderRoute } from "../../support/render";
import { renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

beforeEach(() => {
  // Выгрузка CSV собирает файл в браузере: ссылка на Blob и щелчок по ней — без перехода в jsdom.
  URL.createObjectURL = vi.fn(() => "blob:director-test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const SCREENS = [
  "profiles",
  "profiles?dd=red",
  ...["sections", "due-diligence", "site-survey", "tiers", "checks", "notes", "operators"].map(
    (tab) => `profiles/p01?tab=${tab}`,
  ),
  "profiles/p02",
  "profiles/p03?tab=site-survey",
  "profiles/p11?tab=due-diligence",
  "audit",
  "operators",
  "operators?tab=visits",
  "operators?tab=notes",
  "requests",
  "requests?tab=operator",
  "references",
  "forecast",
  "tech-files",
];

/** Всё, что можно нажать и что не ссылка: кнопки (вкладки, аккордеоны, фильтры) — и пункт в каждом открытом списке. */
async function pressEverything(user: UserEvent) {
  const main = () => screen.getByRole("main");
  const pressable = () =>
    [
      ...within(main()).queryAllByRole("button"),
      ...within(main()).queryAllByRole("tab"),
      ...within(main()).queryAllByRole("combobox"),
    ].filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true");
  let pressed = 0;
  for (let i = 0; i < 80; i += 1) {
    const target = pressable()[i];
    if (!target) break;
    await user.click(target);
    pressed += 1;
    const options = screen.queryAllByRole("option");
    if (options.length > 0) await user.click(options.at(-1)!);
    await user.keyboard("{Escape}");
  }
  return pressed;
}

describe("GEN-04: кабинет директора ничего не меняет", () => {
  it.each(SCREENS)("%s: каждое нажатие оставляет хранилище прежним", async (path) => {
    const { user, state } = renderCabinet(`/proto/director/${path}`, { role: "director" });
    await screen.findByRole("heading", { level: 1 });
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const before = JSON.stringify(state());
    expect(stored).not.toBeNull();

    const pressed = await pressEverything(user);
    expect(pressed).toBeGreaterThan(0);
    expect(JSON.stringify(state())).toBe(before);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(stored);
    // Выгрузка CSV на списке профилей тоже нажата: файл собран, хранилище то же.
    if (path === "profiles") expect(URL.createObjectURL).toHaveBeenCalled();

    // Ни полей ввода данных, ни переключателей, ни выбора файла — только фильтры.
    const main = screen.getByRole("main");
    expect(main.querySelectorAll("textarea, input[type=file], [role=switch], [role=checkbox]")).toHaveLength(0);
  });

  it("модуль не импортирует средств записи хранилища", () => {
    const sources = import.meta.glob<string>("/src/prototype/director/**/*.{ts,tsx}", {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(5);
    for (const [file, source] of files) {
      for (const forbidden of ["useProtoUpdate", "setProtoState", "resetProto", "commit(", "extOf", "useMe"])
        expect(source, `${file}: ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe("части экранов SME и администратора с readOnly", () => {
  it("не рисуют действий, даже если экран их передал", async () => {
    const state = createInitialState();
    setProtoState(state);
    const action = () => <button type="button">ACTION</button>;
    const spy = vi.fn();
    const p02 = state.profiles.find((p) => p.id === "p02")!;
    const p01 = state.profiles.find((p) => p.id === "p01")!;
    const certificates = state.referenceLists.find((l) => l.id === "certificate_types")!;
    renderRoute("/", {
      locale: "en",
      routes: [
        {
          path: "/",
          element: (
            <main>
              <DossierSections profile={p02} readOnly sectionActions={action} itemActions={action} />
              <DueDiligenceView
                record={state.dueDiligence.find((d) => d.profileId === "p11")!}
                readOnly
                lineAction={action}
              />
              <SiteSurveyList surveys={state.siteSurveys} readOnly recordAction={action} />
              <TierRecordsList
                profile={p01}
                records={state.tierRecords.filter((r) => r.profileId === "p01")}
                readOnly
                productAction={action}
              />
              <ReferenceListView list={certificates} readOnly onMandatoryChange={spy} onRetiredChange={spy} />
              <OrgChartSampleView file={state.orgChartSample} readOnly onReplace={spy} />
              <TechFilesView files={state.techFiles} readOnly onUpload={spy} removeAction={action} />
              <ForecastVersionsView
                versions={state.forecastVersions}
                publishedId={null}
                readOnly
                accountName={() => "—"}
                publishAction={action}
              />
            </main>
          ),
        },
      ],
    });
    const main = await screen.findByRole("main");
    expect(await within(main).findByText("Organisation-chart sample")).toBeTruthy();
    expect(within(main).queryByText("ACTION")).toBeNull();
    expect(within(main).queryAllByRole("switch")).toHaveLength(0);
    expect(main.querySelectorAll("input, textarea")).toHaveLength(0);
    // Остаются только кнопки показа: группы due diligence (аккордеон).
    for (const button of within(main).queryAllByRole("button"))
      expect(button.getAttribute("data-slot") ?? button.closest("[data-slot]")?.getAttribute("data-slot")).toMatch(
        /accordion/,
      );
    expect(spy).not.toHaveBeenCalled();
    cleanup();
  });
});

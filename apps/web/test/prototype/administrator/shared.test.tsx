// Общие части экранов администратора в режиме только чтения: их показывает кабинет директора (GEN-04).
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  ForecastLinesView,
  ForecastProblemsView,
  ForecastVersionsView,
  NdaVersionsView,
  OrgChartSampleView,
  ReferenceListView,
  TechFilesView,
} from "@/prototype/administrator/shared";
import { createInitialState } from "@/prototype/data";

import { renderRoute } from "../../support/render";

const data = createInitialState();

function show(element: ReactNode) {
  renderRoute("/", { locale: "en", routes: [{ path: "/", element }] });
}

/** Ничего, чем можно что-то изменить: переключателей, выбора файла, кнопок публикации и удаления. */
function expectNothingToChange() {
  expect(screen.queryAllByRole("switch")).toEqual([]);
  expect(document.querySelectorAll("input[type=file]")).toHaveLength(0);
  const buttons = screen.queryAllByRole("button").map((b) => b.textContent ?? "");
  expect(buttons.filter((name) => !name.startsWith("View lines"))).toEqual([]);
}

describe("общие части экранов администратора, readOnly", () => {
  it("справочник с обязательными типами", async () => {
    show(<ReferenceListView list={data.referenceLists.find((l) => l.id === "certificate_types")!} readOnly />);
    expect((await screen.findAllByText("ISO 9001")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Yes").length).toBeGreaterThan(0);
    expectNothingToChange();
  });

  it("образец оргструктуры", async () => {
    show(<OrgChartSampleView file={data.orgChartSample} readOnly />);
    expect(await screen.findByText(/imbc-org-chart-sample.pdf/)).toBeTruthy();
    expectNothingToChange();
  });

  it("версии NDA", async () => {
    show(<NdaVersionsView versions={data.ndaVersions} currentId="nda-2" accountName={() => "Администратор IMBC"} />);
    expect(await screen.findByText("NDA 2.0")).toBeTruthy();
    expectNothingToChange();
  });

  it("версии прогноза, отчёт и строки: остаётся только «View lines»", async () => {
    const version = data.forecastVersions.find((v) => v.id === "fc-2026-11b")!;
    show(
      <>
        <ForecastVersionsView
          versions={data.forecastVersions}
          publishedId="fc-2026-11"
          readOnly
          accountName={() => "Администратор IMBC"}
          onView={() => {}}
          publishAction={() => <button type="button">Publish</button>}
        />
        <ForecastProblemsView version={version} />
        <ForecastLinesView
          version={data.forecastVersions[1]!}
          lines={data.forecastLines.filter((l) => l.versionId === "fc-2026-11")}
        />
      </>,
    );
    expect(await screen.findByText("forecast-2026-11-update.xlsx")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /View lines/ }).length).toBe(3);
    expectNothingToChange();
  });

  it("файлы STR и KTRE", async () => {
    show(
      <TechFilesView
        files={data.techFiles}
        readOnly
        onUpload={() => {}}
        removeAction={() => <button type="button">Remove</button>}
      />,
    );
    expect(await screen.findByText(/str-8481805190.pdf/)).toBeTruthy();
    expectNothingToChange();
  });
});

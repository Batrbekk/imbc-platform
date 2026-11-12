// Кабинет генерального директора IMBC: экраны открываются, показывают свои данные без /api/v1, другая роль
// уходит на свою стартовую страницу (GEN-04, AUD-03, раздел 4).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

const SCREENS: { path: string; heading: string; content: string | RegExp }[] = [
  { path: "profiles", heading: "All profiles", content: "Profiles: 12 of 12" },
  { path: "profiles/p11", heading: "ТОО «Демо Электро Монтаж»", content: "No: not verified" },
  { path: "audit", heading: "Audit log", content: "Published NDA version 2.0" },
  { path: "operators", heading: "Operators and manufacturers", content: "Who works with whom" },
  { path: "requests", heading: "Requests", content: "Сертификаты ISO у производителя арматуры" },
  { path: "references", heading: "Reference lists and NDA", content: "Organisation-chart sample" },
  { path: "forecast", heading: "Demand forecast", content: "Shown to manufacturers: forecast-2026-11.xlsx" },
  { path: "tech-files", heading: "STR and KTRE", content: "Group A" },
];

describe("кабинет директора: экраны", () => {
  it.each(SCREENS)(
    "$path: открывается директором, без кнопки сброса и без /api/v1",
    async ({ path, heading, content }) => {
      const { api } = renderCabinet(`/proto/director/${path}`, { role: "director" });
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeTruthy();
      expect(screen.getAllByText(content).length).toBeGreaterThan(0);
      expect(screen.getByText("Prototype", { selector: "[data-slot=badge]" })).toBeTruthy();
      // Сброс демо-данных — пульт ведущего; страницы директора его не несут (GEN-04).
      expect(screen.queryByRole("button", { name: "Reset demo data" })).toBeNull();
      expect(apiV1Calls(api)).toEqual([]);
    },
  );

  it("меню: группа прототипа с семью разделами, прогноз и STR — Release 2", async () => {
    renderCabinet("/proto/director", { role: "director" });
    expect(await screen.findByRole("heading", { level: 1, name: "All profiles" })).toBeTruthy();
    for (const name of [
      "All profiles",
      "Audit log",
      "Operators and manufacturers",
      "Requests",
      "Reference lists and NDA",
      "Demand forecast",
      "STR and KTRE",
    ])
      expect(screen.getByRole("link", { name })).toBeTruthy();
    expect(screen.getAllByText("Release 2").length).toBeGreaterThanOrEqual(2);
  });

  it("прогноз и STR — с бейджем Release 2 на странице", async () => {
    renderCabinet("/proto/director/tech-files", { role: "director" });
    const heading = await screen.findByRole("heading", { level: 1, name: "STR and KTRE" });
    expect(within(heading.parentElement!).getByText("Release 2")).toBeTruthy();
  });

  it("казахский и русский: меню и заголовки своего языка", async () => {
    renderCabinet("/proto/director/audit", { role: "director", locale: "kk" });
    expect(await screen.findByRole("heading", { level: 1, name: "Аудит журналы" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Барлық профильдер" })).toBeTruthy();
    cleanup();
    renderCabinet("/proto/director/operators", { role: "director", locale: "ru" });
    expect(await screen.findByRole("heading", { level: 1, name: "Операторы и производители" })).toBeTruthy();
    expect(screen.getByText("Кто с кем работает")).toBeTruthy();
  });

  it("досье несуществующего профиля — «не найдено» со ссылкой назад", async () => {
    renderCabinet("/proto/director/profiles/p99", { role: "director" });
    expect(await screen.findByRole("heading", { level: 1, name: "Profile not found" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Back to all profiles" }).length).toBeGreaterThan(0);
  });

  it("другая роль не открывает кабинет директора", async () => {
    const { router } = renderCabinet("/proto/director/audit", {
      role: "operator",
      api: { "GET /api/v1/dashboard": { status: 500 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByRole("link", { name: "Audit log" })).toBeNull();
  });

  it("сеанс не демо-аккаунта директора: имя и почта сеанса нигде не показываются (NFR-11)", async () => {
    renderCabinet("/proto/director/audit", {
      role: "director",
      email: "real.person@company.example",
      fullName: "Реальный Человек",
    });
    await screen.findByRole("heading", { level: 1, name: "Audit log" });
    // Оболочка готовых страниц показывает пользователя сеанса в меню; экран прототипа — нет.
    expect(within(screen.getByRole("main")).queryByText(/Реальный Человек|real\.person/)).toBeNull();
  });
});

describe("кабинет директора: что видно (раздел 4)", () => {
  it("все профили, включая не видимые операторам: Draft и due diligence red", async () => {
    renderCabinet("/proto/director/profiles", { role: "director" });
    const draft = (await screen.findByRole("link", { name: "ТОО «Демо Жоба»" })).closest("tr")!;
    expect(within(draft).getByText("No: not verified")).toBeTruthy();
    const red = screen.getByRole("link", { name: "ТОО «Демо Электро Монтаж»" }).closest("tr")!;
    expect(within(red).getByText("Red")).toBeTruthy();
  });

  it("досье: due diligence, заметки IMBC, внешние проверки и операторы", async () => {
    renderCabinet("/proto/director/profiles/p11?tab=due-diligence", { role: "director" });
    expect(await screen.findByRole("heading", { name: "Critical" })).toBeTruthy();
    expect(screen.getAllByText("Red").length).toBeGreaterThan(0);
    cleanup();
    renderCabinet("/proto/director/profiles/p01?tab=notes", { role: "director" });
    expect(await screen.findByText(/Созвонились с focal point/)).toBeTruthy();
    cleanup();
    renderCabinet("/proto/director/profiles/p01?tab=checks", { role: "director" });
    expect((await screen.findAllByRole("columnheader", { name: "Connector" })).length).toBeGreaterThan(0);
    cleanup();
    // Заметки обеих организаций операторов: GEN-12 ограничивает операторов, не директора.
    renderCabinet("/proto/director/profiles/p01?tab=operators", { role: "director" });
    expect(await screen.findByText("Поставляли модульные конструкции для склада, сроки соблюдены.")).toBeTruthy();
    expect(screen.getByText("Своя заметка организации Б: интерес к сварным конструкциям.")).toBeTruthy();
  });

  it("операторы и производители: отметки обеих организаций и заметки всех операторов", async () => {
    renderCabinet("/proto/director/operators?tab=notes", { role: "director" });
    expect(await screen.findByText("Насосы прошли входной контроль организации Б.")).toBeTruthy();
    expect(screen.getByText("Запросить сроки изготовления арматуры DN150.")).toBeTruthy();
    cleanup();
    renderCabinet("/proto/director/operators?org=org-operator-b", { role: "director" });
    const table = await screen.findByRole("columnheader", { name: "IMBC decision" });
    const rows = within(table.closest("table")!).getAllByRole("row").slice(1);
    // Отметки организации Б: ww-03…ww-06.
    expect(rows).toHaveLength(4);
    expect(screen.getAllByText("Removal waiting").length).toBeGreaterThan(0);
  });

  it("запросы: переписка IMBC request и ответ на operator request, без поля ответа", async () => {
    renderCabinet("/proto/director/requests", { role: "director" });
    expect(await screen.findByText("Да, визит 15 октября. Отчёт появится на странице компании.")).toBeTruthy();
    cleanup();
    renderCabinet("/proto/director/requests?tab=operator&status=closed", { role: "director" });
    expect(await screen.findByText("Сертификат обновлён в профиле, действует до 2028 года.")).toBeTruthy();
    expect(screen.queryByText("Уточните загрузку цехов на первый квартал.")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

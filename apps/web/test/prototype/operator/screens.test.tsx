// Экраны кабинета оператора: открываются ролью, показывают своё, не ходят в /api/v1; чужая роль
// уходит на свою стартовую; оператор не видит данных другого оператора (GEN-12, OPR-12).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiV1Calls, renderCabinet } from "../support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const SCREENS: [path: string, heading: string, content: RegExp][] = [
  ["/proto/operator/manufacturers", "My manufacturers", /ТОО «Атырау Демо Арматура»/],
  ["/proto/operator/manufacturers/p01", "ТОО «Демо Металл Конструкция»", /Поставляли модульные конструкции/],
  ["/proto/operator/requests", "Requests", /Сертификаты ISO у производителя арматуры/],
  ["/proto/operator/requests?tab=operator", "Requests", /Пришлите, пожалуйста, актуальный ISO 14001/],
  ["/proto/operator/export", "Export", /Found: 8 manufacturers/],
  ["/proto/operator/subscriptions", "Export subscriptions", /Арматура, еженедельно/],
  ["/proto/operator/api", "Pull API", /demo-client-operator-0001/],
];

describe("экраны кабинета оператора", () => {
  it.each(SCREENS)("%s открывается и не обращается к /api/v1", async (path, heading, content) => {
    const { api } = renderCabinet(path, { role: "operator" });
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(screen.getAllByText(content).length).toBeGreaterThan(0);
    expect(apiV1Calls(api)).toEqual([]);
  });

  it("меню кабинета: пять пунктов, подписки помечены Release 2", async () => {
    renderCabinet("/proto/operator/manufacturers", { role: "operator" });
    await screen.findByRole("heading", { level: 1, name: "My manufacturers" });
    for (const name of ["My manufacturers", "Requests", "Export", "Pull API"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    const item = screen.getByRole("link", { name: "Export subscriptions" }).closest("li")!;
    expect(within(item as HTMLElement).getByText("Release 2")).toBeTruthy();
  });

  it("адрес кабинета без экрана ведёт на «Мои производители»", async () => {
    const { router } = renderCabinet("/proto/operator", { role: "operator" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/proto/operator/manufacturers"));
  });

  it("другая роль не открывает кабинет оператора", async () => {
    const { router } = renderCabinet("/proto/operator/export", {
      role: "observer",
      api: { "GET /api/v1/dashboard": { status: 500 } },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByText("My manufacturers")).toBeNull();
  });

  it("список: только видимые Verified, unresponsive в конце (OPR-01, UPD-04)", async () => {
    renderCabinet("/proto/operator/manufacturers", { role: "operator" });
    await screen.findByRole("heading", { level: 1, name: "My manufacturers" });
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    expect(screen.queryByText("ТОО «Демо Жоба»")).toBeNull(); // Draft
    expect(screen.queryByText("ТОО «Жаңа Демо Құрылыс»")).toBeNull(); // Submitted
    expect(within(rows.at(-1)!).getByText("Unresponsive")).toBeTruthy();
  });

  it("карточка: тир и продукты tier 3, без due diligence и AGAR (OPR-12, IMBC-22)", async () => {
    renderCabinet("/proto/operator/manufacturers/p01", { role: "operator" });
    await screen.findByRole("heading", { level: 1, name: "ТОО «Демо Металл Конструкция»" });
    expect(screen.getByText("Tier 2")).toBeTruthy();
    expect(screen.getByText("Tier 3")).toBeTruthy();
    // Отметки Б и демо-оператора подтверждены: 2 из 3, имени Б нет.
    expect(screen.getByText("2 of 3")).toBeTruthy();
    for (const hidden of [/Green|Amber/, /Report issued/, /AGAR report/i, /agar-report/]) {
      expect(screen.queryByText(hidden)).toBeNull();
    }
  });

  it("карточка недоступного или исчезнувшего профиля — «не найдено» со ссылкой назад", async () => {
    renderCabinet("/proto/operator/manufacturers/p12", { role: "operator" });
    expect(await screen.findByText(/This company is not available/)).toBeTruthy();
    cleanup();
    renderCabinet("/proto/operator/manufacturers/p99", { role: "operator" });
    expect(await screen.findByText(/This company is not available/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "My manufacturers" }).length).toBeGreaterThan(0);
  });
});

/** Все экраны, где могли бы появиться записи организаций операторов. */
const WALK = [
  "/proto/operator/manufacturers",
  ...["p01", "p02", "p03", "p06", "p08"].map((id) => `/proto/operator/manufacturers/${id}`),
  "/proto/operator/requests?tab=imbc",
  "/proto/operator/requests?tab=operator",
  "/proto/operator/export",
  "/proto/operator/subscriptions",
  "/proto/operator/api",
];

/** Следы записей каждой организации в общих данных (заметки, запросы, выгрузки, подписки, ключи, люди). */
const DEMO_ORG = [
  "Специалист оператора",
  "Арман Беков",
  "Поставляли модульные конструкции",
  "Запросить сроки изготовления",
  "Сертификаты ISO у производителя арматуры",
  "Планирует ли IMBC визит",
  "Пришлите, пожалуйста, актуальный ISO 14001",
  "Какой максимальный пролёт",
  "Арматура, еженедельно",
  "demo-client-operator-0001",
  "operator-visit-p01.pdf",
];
const ORG_B = [
  "Жанар Иманова",
  "Оператор Б (демо)",
  "организации Б",
  "Новые производители группы E",
  "Уточните загрузку цехов",
  "Есть ли арматура для кислых сред",
  "Все производители, ежемесячно",
  "demo-client-operator-b",
];

async function walk(email?: string) {
  const seen = new Set<string>();
  for (const path of WALK) {
    cleanup();
    renderCabinet(path, { role: "operator", email });
    await screen.findByRole("heading", { level: 1 });
    const text = document.body.textContent ?? "";
    for (const marker of [...DEMO_ORG, ...ORG_B]) if (text.includes(marker)) seen.add(marker);
  }
  return seen;
}

describe("GEN-12: оператор не видит данных другого оператора", () => {
  it("«Оператор (демо)» видит свои записи и ни одной записи организации Б", async () => {
    const seen = await walk();
    expect(ORG_B.filter((m) => seen.has(m))).toEqual([]);
    expect(DEMO_ORG.filter((m) => !seen.has(m))).toEqual([]);
  });

  it("пользователь организации Б видит свои записи и ни одной записи «Оператора (демо)»", async () => {
    const seen = await walk("zhanar.imanova@operator-b.demo.local");
    expect(DEMO_ORG.filter((m) => seen.has(m))).toEqual([]);
    expect(ORG_B.filter((m) => !seen.has(m))).toEqual([]);
  });
});

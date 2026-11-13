// Очередь проверки SME, только для чтения (REV-01, REV-04).
import type { ReviewQueue } from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { problem, stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const EXPERT: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "expert@imbc.local",
    fullName: "Эксперт IMBC",
    role: "expert",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "imbc",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/reviews",
  otpDelivery: "email",
};

const QUEUE: ReviewQueue = {
  items: [
    {
      profileId: "00000000-0000-4000-8000-000000000010",
      organizationName: "ТОО «Жаңа Демо Құрылыс»",
      bin: "240100000901",
      status: "submitted",
      hasPendingChanges: false,
      assignedExpert: null,
      // 20:00 UTC — уже 2 ноября в Алматы.
      registeredAt: "2026-11-01T20:00:00Z",
    },
    {
      profileId: "00000000-0000-4000-8000-000000000011",
      organizationName: "ТОО «Демо Электро Монтаж»",
      bin: "240100001003",
      status: "under_review",
      hasPendingChanges: false,
      assignedExpert: "Эксперт IMBC",
      registeredAt: "2026-11-05T10:00:00Z",
    },
    {
      profileId: "00000000-0000-4000-8000-000000000012",
      organizationName: "ТОО «Демо Металл Конструкция»",
      bin: "240100000108",
      status: "verified",
      hasPendingChanges: true,
      assignedExpert: null,
      registeredAt: "2026-11-07T10:00:00Z",
    },
  ],
  total: 3,
};

function stubQueue(reply: Parameters<typeof stubApi>[0][string] = { body: QUEUE }) {
  return stubApi({ "GET /api/auth/me": { body: EXPERT }, "GET /api/v1/reviews/queue": reply });
}

/** Адреса запросов очереди к API в порядке вызова. */
const queueCalls = (api: Mock<typeof fetch>) =>
  api.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/v1/reviews/queue"));

/** Строка таблицы по названию производителя. */
const row = (name: string) => within(screen.getByText(name).closest("tr")!);

describe("очередь проверки SME (REV-04)", () => {
  it("SME видит четыре колонки, «Не назначен» у свободных", async () => {
    stubQueue();
    renderRoute("/reviews", { locale: "ru" });

    expect(await screen.findByRole("heading", { level: 1, name: ru.reviews.title })).toBeTruthy();
    expect(document.title).toBe(`${ru.reviews.title} · ${ru.common.appName}`);
    await screen.findByText(QUEUE.items[0]!.organizationName);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      ru.reviews.manufacturer,
      ru.reviews.status,
      ru.reviews.assignee,
      ru.reviews.registeredAt,
    ]);

    const submitted = row("ТОО «Жаңа Демо Құрылыс»");
    expect(submitted.getByText("240100000901")).toBeTruthy();
    expect(submitted.getByText(ru.profile.statusValue.submitted)).toBeTruthy();
    expect(submitted.getByText(ru.reviews.unassigned)).toBeTruthy();

    const review = row("ТОО «Демо Электро Монтаж»");
    expect(review.getByText(ru.profile.statusValue.under_review)).toBeTruthy();
    expect(review.getByText("Эксперт IMBC")).toBeTruthy();
    expect(review.queryByText(ru.reviews.unassigned)).toBeNull();

    // Verified с ожидающими изменениями — бейдж pending changes.
    const pending = row("ТОО «Демо Металл Конструкция»");
    expect(pending.getByText(ru.reviews.pendingChanges)).toBeTruthy();
    expect(pending.getByText(ru.reviews.unassigned)).toBeTruthy();

    // Строки без ссылок: открытие профиля — этап 5.
    expect(within(screen.getByRole("table")).queryAllByRole("link")).toEqual([]);
    expect(screen.getByText("3 профиля")).toBeTruthy();
  });

  it("фильтр статуса в адресе уходит в API", async () => {
    const api = stubQueue();
    const { router, user } = renderRoute("/reviews?status=submitted", { locale: "en" });

    await waitFor(() => expect(queueCalls(api)).toEqual(["/api/v1/reviews/queue?status=submitted"]));
    const select = await screen.findByRole("combobox", { name: en.reviews.statusFilter });
    expect(select.textContent).toContain(en.profile.statusValue.submitted);

    await user.click(select);
    await user.click(await screen.findByRole("option", { name: en.reviews.pendingChanges }));
    await waitFor(() => expect(router.state.location.search).toBe("?status=pending_changes"));
    await waitFor(() => expect(queueCalls(api).at(-1)).toBe("/api/v1/reviews/queue?status=pending_changes"));

    await user.click(screen.getByRole("combobox", { name: en.reviews.statusFilter }));
    await user.click(await screen.findByRole("option", { name: en.reviews.statusAll }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    await waitFor(() => expect(queueCalls(api).at(-1)).toBe("/api/v1/reviews/queue"));
    cleanup();

    // Неизвестное значение в адресе — «Все», в API не уходит.
    const unknown = stubQueue();
    renderRoute("/reviews?status=draft", { locale: "en" });
    await waitFor(() => expect(queueCalls(unknown)).toEqual(["/api/v1/reviews/queue"]));
    expect((await screen.findByRole("combobox", { name: en.reviews.statusFilter })).textContent).toContain(
      en.reviews.statusAll,
    );
  });

  it("пусто отличается от сбоя", async () => {
    stubQueue({ body: { items: [], total: 0 } });
    renderRoute("/reviews", { locale: "kk" });

    expect(await screen.findByText(kk.reviews.empty)).toBeTruthy();
    expect(screen.queryByText(kk.reviews.loadError)).toBeNull();
    cleanup();

    let fail = true;
    const unavailable = problem(503, "unavailable") as (url: URL) => Response;
    const api = stubQueue((url) => (fail ? unavailable(url) : Response.json(QUEUE)));
    const { user } = renderRoute("/reviews", { locale: "kk" });

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(kk.reviews.loadError)).toBeTruthy();
    // Кнопка «Повторить» — под текстом, а не в AlertAction: у того справа 4,5rem, на 390 px кнопка легла бы на текст.
    expect(alert.querySelector('[data-slot="alert-action"]')).toBeNull();
    expect(screen.queryByText(kk.reviews.empty)).toBeNull();
    fail = false;
    await user.click(within(alert).getByRole("button", { name: kk.common.retry }));
    expect(await screen.findByText("ТОО «Жаңа Демо Құрылыс»")).toBeTruthy();
    expect(screen.queryByText(kk.reviews.loadError)).toBeNull();
    expect(queueCalls(api)).toHaveLength(2);
  });

  it("дата через useFormat", async () => {
    stubQueue();
    renderRoute("/reviews", { locale: "kk" });

    // Казахский — dd.MM.yyyy в часовом поясе Алматы.
    expect(await screen.findByText("02.11.2026")).toBeTruthy();
    expect(row("ТОО «Жаңа Демо Құрылыс»").getByText("02.11.2026")).toBeTruthy();
    cleanup();

    stubQueue();
    renderRoute("/reviews", { locale: "en" });
    expect(await screen.findByText("Nov 2, 2026")).toBeTruthy();
  });
});

// Каталог: фильтры в адресе страницы уходят в API без преобразований (OPR-04, OPR-05).
import type { CatalogItem, CatalogPage } from "@imbc/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

// Оператор с пройденными шлюзами входа.
const OPERATOR: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "operator@operator.local",
    fullName: "Оператор",
    role: "operator",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "operator",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/catalog",
  otpDelivery: "email",
};

const ITEM: CatalogItem = {
  profileId: "00000000-0000-4000-8000-000000000010",
  bin: "980540000384",
  nameEn: "Steel LLP",
  nameRu: "ТОО Сталь",
  region: "KZ-ATY",
  commodityGroups: ["A", "B"],
  mainTnved: "7208",
  certificateTypes: ["ST-KZ"],
  siteSurveyed: true,
  verifiedAt: "2026-11-11T20:00:00Z",
  updateStatus: "active",
  pendingChanges: true,
  worksWithCount: 0,
};

const DASHBOARD = {
  total: 1,
  byRegion: [
    { region: "KZ-MAN", count: 1 },
    { region: "KZ-ATY", count: 3 },
  ],
  byCommodityGroup: [],
  siteSurveyed: 0,
  unifiedRegister: 0,
  updateStatus: { active: 0, outdated: 0, unresponsive: 0 },
  generatedAt: "2026-11-11T10:00:00Z",
};

function stubCatalog(page: CatalogPage = { items: [ITEM], total: 1, page: 1, pageSize: 25 }) {
  return stubApi({
    "GET /api/auth/me": { body: OPERATOR },
    "GET /api/v1/catalog/search": () => Response.json(page),
    "GET /api/v1/dashboard": { body: DASHBOARD },
  });
}

/** Адреса поисковых запросов к API в порядке вызова. */
const searches = (api: Mock<typeof fetch>) =>
  api.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith("/api/v1/catalog/search"));

describe("каталог (OPR-04, OPR-05)", () => {
  it("фильтры из адреса уходят в API без преобразований", async () => {
    const query = "?region=KZ-ATY,KZ-MAN&group=A,B&surveyed=true&sort=verified_at&page=2";
    const api = stubCatalog();
    renderRoute(`/catalog${query}`);

    expect(await screen.findByRole("heading", { name: kk.catalog.title })).toBeTruthy();
    await waitFor(() => expect(searches(api)).toEqual([`/api/v1/catalog/search${query}`]));
    expect(document.title).toBe(`${kk.catalog.title} · ${kk.common.appName}`);
  });

  it("закодированная запятая в ссылке даёт тот же запрос (Review Focus 1)", async () => {
    const api = stubCatalog();
    const { router } = renderRoute("/catalog?region=KZ-ATY%2CKZ-MAN");

    await waitFor(() => expect(searches(api)).toEqual(["/api/v1/catalog/search?region=KZ-ATY,KZ-MAN"]));
    // Оба региона выбраны: счётчик на кнопке фильтра.
    const region = screen.getByRole("button", { name: new RegExp(kk.catalog.region) });
    expect(within(region).getByText("2")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/catalog");
  });

  it("селект показывает подпись, а не значение из адреса (Review Focus 5)", async () => {
    stubCatalog();
    renderRoute("/catalog?surveyed=true", { locale: "ru" });

    const surveyed = (await screen.findByText(`${ru.catalog.surveyed}:`)).closest("button")!;
    expect(surveyed.textContent).toContain(ru.common.yes);
    expect(surveyed.textContent).not.toContain("true");
    const unified = screen.getByText(`${ru.catalog.unifiedRegister}:`).closest("button")!;
    expect(unified.textContent).toContain(ru.common.any);
    expect(unified.textContent).not.toContain("any");
    // Сортировка по умолчанию — подпись «По названию», а не значение name.
    const sort = screen.getAllByRole("combobox").at(-1)!;
    expect(sort.textContent).toContain(ru.catalog.sortName);
    expect(sort.textContent).not.toContain("name");
  });

  it("выбор в селекте меняет адрес и сбрасывает страницу", async () => {
    const api = stubCatalog();
    const { router, user } = renderRoute("/catalog?page=3", { locale: "en" });

    await user.click(await screen.findByText(`${en.catalog.unifiedRegister}:`));
    await user.click(await screen.findByRole("option", { name: en.common.no }));

    await waitFor(() => expect(router.state.location.search).toBe("?unifiedRegister=false"));
    await waitFor(() => expect(searches(api).at(-1)).toBe("/api/v1/catalog/search?unifiedRegister=false"));
    expect(screen.getByText(`${en.catalog.unifiedRegister}:`).closest("button")!.textContent).toContain(en.common.no);
  });

  it("сеанс истёк после смены фильтра — возврат на вход с новыми фильтрами (OPR-05)", async () => {
    let expired = false;
    const unauthorized = () =>
      Response.json({ status: 401, code: "unauthorized", title: "unauthorized" }, { status: 401 });
    stubApi({
      "GET /api/auth/me": () => (expired ? unauthorized() : Response.json(OPERATOR)),
      "GET /api/v1/catalog/search": (url) => {
        if (!url.searchParams.has("unifiedRegister")) return Response.json({ items: [], total: 0, page: 1, pageSize: 25 });
        expired = true;
        return unauthorized();
      },
      "GET /api/v1/dashboard": { body: DASHBOARD },
    });
    const { router, user } = renderRoute("/catalog", { locale: "en" });

    await user.click(await screen.findByText(`${en.catalog.unifiedRegister}:`));
    await user.click(await screen.findByRole("option", { name: en.common.no }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe(
      `?error=session_expired&returnTo=${encodeURIComponent("/catalog?unifiedRegister=false")}`,
    );
  });

  it("множественный выбор группы — OR внутри фильтра (OPR-04)", async () => {
    const api = stubCatalog();
    const { router, user } = renderRoute("/catalog?group=A", { locale: "en" });

    await user.click(await screen.findByRole("button", { name: new RegExp(en.catalog.group) }));
    await user.click(await screen.findByRole("option", { name: "Group C" }));

    await waitFor(() => expect(router.state.location.search).toBe("?group=A,C"));
    await waitFor(() => expect(searches(api).at(-1)).toBe("/api/v1/catalog/search?group=A,C"));
  });

  it("«Сбросить» очищает адрес и повторяет поиск без фильтров", async () => {
    const api = stubCatalog();
    const { router, user } = renderRoute("/catalog?region=KZ-ATY&surveyed=false&sort=region");

    await user.click(await screen.findByRole("button", { name: kk.common.reset }));

    await waitFor(() => expect(router.state.location.search).toBe(""));
    await waitFor(() => expect(searches(api).at(-1)).toBe("/api/v1/catalog/search"));
    expect(screen.queryByRole("button", { name: kk.common.reset })).toBeNull();
  });

  it("дата верификации — в формате языка (LANG-04)", async () => {
    stubCatalog();
    renderRoute("/catalog", { locale: "en" });

    const row = (await screen.findByText("ТОО Сталь")).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells[5]?.textContent).toBe("Nov 12, 2026");
    expect(within(row).getByText("Steel LLP")).toBeTruthy();
    expect(within(row).getByText("980540000384")).toBeTruthy();
    expect(within(row).getByText(en.catalog.status.active)).toBeTruthy();
    expect(within(row).getByText(en.catalog.pending)).toBeTruthy();
    expect(screen.getByText("1 company found")).toBeTruthy();
  });

  it("пустой результат отличается от ошибки; постраничный переход (OPR-08)", async () => {
    const api = stubApi({
      "GET /api/auth/me": { body: OPERATOR },
      "GET /api/v1/catalog/search": (url) =>
        Response.json(
          url.searchParams.get("q") === "none"
            ? { items: [], total: 0, page: 1, pageSize: 25 }
            : { items: [ITEM], total: 60, page: Number(url.searchParams.get("page") ?? 1), pageSize: 25 },
        ),
      "GET /api/v1/dashboard": { body: DASHBOARD },
    });
    const { router, user } = renderRoute("/catalog", { locale: "en" });

    expect(await screen.findByText("Page 1 of 3")).toBeTruthy();
    const prev = screen.getByRole("button", { name: en.catalog.prev });
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: en.catalog.next }));
    await waitFor(() => expect(router.state.location.search).toBe("?page=2"));
    expect(await screen.findByText("Page 2 of 3")).toBeTruthy();
    expect(searches(api).at(-1)).toBe("/api/v1/catalog/search?page=2");

    await router.navigate("/catalog?q=none");
    expect(await screen.findByText(en.catalog.empty)).toBeTruthy();
    expect(screen.queryByText(/Page \d of/)).toBeNull();
  });

  it("сбой поиска — сообщение и повтор (OPR-08)", async () => {
    let fail = true;
    const api = stubApi({
      "GET /api/auth/me": { body: OPERATOR },
      "GET /api/v1/catalog/search": () =>
        fail
          ? Response.json({ status: 503, code: "unavailable", title: "unavailable" }, { status: 503 })
          : Response.json({ items: [ITEM], total: 1, page: 1, pageSize: 25 }),
      "GET /api/v1/dashboard": { body: DASHBOARD },
    });
    const { user } = renderRoute("/catalog", { locale: "en" });

    expect(await screen.findByText(en.common.error)).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: en.common.retry }));
    expect(await screen.findByText("ТОО Сталь")).toBeTruthy();
    expect(searches(api)).toHaveLength(2);
  });

  it("регионы фильтра — из дашборда, по алфавиту до справочника регионов (ADM-08)", async () => {
    stubCatalog();
    const { user } = renderRoute("/catalog", { locale: "en" });

    await user.click(await screen.findByRole("button", { name: new RegExp(en.catalog.region) }));
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["KZ-ATY", "KZ-MAN"]);
  });
});

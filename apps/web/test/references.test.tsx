// Страница «Справочники» и образец оргструктуры: ADM-08, ADM-09, ADM-11, DATA-03, DATA-04, GEN-08, LANG-01.
import {
  CLOSED_DICTIONARIES,
  DICTIONARY_CODES,
  DICTIONARY_PARENT,
  type DictionaryCode,
  type DictionaryEntriesPage,
  type DictionaryEntry,
  type DictionarySummary,
  FILE_PROBLEM_CODES,
  MANDATORY_DICTIONARIES,
  type OrgChartSampleState,
  REFERENCE_PROBLEM_CODES,
} from "@imbc/contracts";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Me } from "@/lib/session";
import { REFERENCE_PROBLEM_MESSAGES } from "@/routes/app/references-actions";

import en from "../messages/en.json";
import kk from "../messages/kk.json";
import ru from "../messages/ru.json";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const meOf = (role: "administrator" | "director"): Me => ({
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: `${role}@imbc.local`,
    fullName: null,
    role,
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "imbc",
    locale: "kk",
  },
  gates: { mfa: true, responsibility: true },
  homePath: role === "administrator" ? "/admin/accounts" : "/dashboard",
  otpDelivery: "email",
});
const ADMIN = meOf("administrator");
const DIRECTOR = meOf("director");

// ---------------------------------------------------------------------------------------------
// Подменённый BFF: справочники в памяти, чтобы после действия список перечитывался настоящим.
// ---------------------------------------------------------------------------------------------

type Store = Record<DictionaryCode, DictionaryEntry[]>;
type Handler = (url: URL, init: RequestInit | undefined, match: RegExpMatchArray) => Response | Promise<Response>;

const ids = new Map<string, string>();
const idOf = (dictionary: string, code: string) => {
  const key = `${dictionary}:${code}`;
  if (!ids.has(key)) ids.set(key, `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`);
  return ids.get(key)!;
};

const isMandatoryDictionary = (code: string) => (MANDATORY_DICTIONARIES as readonly string[]).includes(code);

function entry(
  dictionary: DictionaryCode,
  code: string,
  o: Partial<DictionaryEntry> & { name?: string } = {},
): DictionaryEntry {
  const { name = `Значение ${code}`, ...rest } = o;
  return {
    id: idOf(dictionary, code),
    code,
    parentCode: null,
    names: { kk: `${name} (kk)`, ru: name, en: `${name} (en)` },
    mandatory: isMandatoryDictionary(dictionary) ? false : null,
    customNameAllowed: false,
    sortOrder: 0,
    retiredAt: null,
    ...rest,
  };
}

const ST_KZ = "ST-KZ";
const ISO = "ISO-9001";
const OLD = "OLD-CERT";

/** 120 кодов ТН ВЭД с ведущим нулём: 0101210000, 0101210001, … (DATA-03). */
const tnVed = (): DictionaryEntry[] =>
  Array.from({ length: 120 }, (_, i) =>
    entry("tn_ved", `010121${String(i).padStart(4, "0")}`, { name: `Товар ${i}`, sortOrder: i }),
  );

function freshStore(): Store {
  const store = Object.fromEntries(DICTIONARY_CODES.map((code) => [code, [] as DictionaryEntry[]])) as Store;
  store.certificate_type = [
    entry("certificate_type", ST_KZ, { name: "Сертификат соответствия СТ-КЗ", mandatory: true, sortOrder: 0 }),
    entry("certificate_type", ISO, { name: "Сертификат ISO 9001", sortOrder: 1 }),
    entry("certificate_type", OLD, { name: "Прежний сертификат", sortOrder: 2, retiredAt: "2026-10-01T05:00:00Z" }),
  ];
  store.document_type = [entry("document_type", "CHARTER", { name: "Устав", mandatory: true })];
  store.commodity_group = ["A", "B", "C"].map((code, i) =>
    entry("commodity_group", code, { name: `Группа ${code}`, sortOrder: i }),
  );
  store.commodity_type = [
    entry("commodity_type", "PUMP", { name: "Насосы", parentCode: "A" }),
    entry("commodity_type", "VALVE", { name: "Арматура", parentCode: "B" }),
  ];
  store.contact_role = [entry("contact_role", "HEAD", { name: "Руководитель" })];
  store.region = [entry("region", "KZ-ALA", { name: "Алматы" }), entry("region", "KZ-AST", { name: "Астана" })];
  store.oked = [entry("oked", "01120", { name: "Выращивание риса" })];
  store.tn_ved = tnVed();
  return store;
}

const problemResponse = (status: number, code: string) =>
  Response.json(
    { type: "about:blank", title: code, status, code },
    { status, headers: { "content-type": "application/problem+json" } },
  );

const summaryOf = (code: DictionaryCode, list: DictionaryEntry[]): DictionarySummary => ({
  code,
  closed: (CLOSED_DICTIONARIES as readonly string[]).includes(code),
  mandatoryApplicable: isMandatoryDictionary(code),
  parentDictionary: DICTIONARY_PARENT[code] ?? null,
  active: list.filter((e) => !e.retiredAt).length,
  retired: list.filter((e) => e.retiredAt).length,
});

/** Страница значений справочника так, как её отдаёт сервер: поиск, вкладка и страница из адреса. */
function listResponse(store: Store, code: DictionaryCode, url: URL): Response {
  const list = store[code];
  if (!list) return problemResponse(404, "not_found");
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const status = url.searchParams.get("status") ?? "active";
  const page = Number(url.searchParams.get("page") ?? "1");
  const matching = list
    .filter((e) => (status === "all" ? true : status === "retired" ? !!e.retiredAt : !e.retiredAt))
    .filter(
      (e) =>
        !q || e.code.toLowerCase().startsWith(q) || Object.values(e.names).some((n) => n?.toLowerCase().includes(q)),
    );
  const result: DictionaryEntriesPage = {
    dictionary: summaryOf(code, list),
    items: matching.slice((page - 1) * 50, page * 50),
    total: matching.length,
    page,
    pageSize: 50,
  };
  return Response.json(result);
}

/** Файл образца: у каждого имени свой id; проверяемый и прошедший проверку файл с одним именем — один и тот же файл. */
const sampleFile = (scanState: "passed" | "pending" | "rejected", name = "Образец оргструктуры.pdf") => ({
  fileId: idOf("sample", name),
  originalName: name,
  byteSize: 1_572_864,
  mediaType: "application/pdf",
  scanState,
  // 08:30 UTC — 13:30 в Алматы.
  uploadedAt: "2026-11-12T08:30:00.000Z",
});

interface Backend {
  fetch: Mock<typeof fetch>;
  store: Store;
  sample: { current: OrgChartSampleState["current"]; latest: OrgChartSampleState["latest"] };
}

/**
 * Подменяет fetch: /me, справочники (список, выбор, создание, правка, обязательность, вывод, возврат, удаление)
 * и образец оргструктуры. `overrides` — первыми: `[метод, регулярное выражение пути, ответ]`.
 */
function stubBackend(
  options: {
    me?: Me;
    store?: Store;
    sample?: Backend["sample"];
    overrides?: [string, RegExp, Handler][];
  } = {},
): Backend {
  const store = options.store ?? freshStore();
  const sample = options.sample ?? { current: null, latest: null };
  const body = (init?: RequestInit) => JSON.parse(String(init?.body ?? "null"));
  const find = (code: string, id: string) => store[code as DictionaryCode]?.find((e) => e.id === id);

  const routes: [string, RegExp, Handler][] = [
    ...(options.overrides ?? []),
    ["GET", /^\/api\/auth\/me$/, () => Response.json(options.me ?? ADMIN)],
    [
      "GET",
      /^\/api\/v1\/dictionaries\/(\w+)\/entries$/,
      (url, _init, m) => listResponse(store, m[1] as DictionaryCode, url),
    ],
    [
      "GET",
      /^\/api\/v1\/dictionaries\/(\w+)\/choices$/,
      (_url, _init, m) => {
        const items = (store[m[1] as DictionaryCode] ?? [])
          .filter((e) => !e.retiredAt)
          .map((e) => ({ id: e.id, code: e.code, name: e.names.ru ?? e.code, parentCode: e.parentCode }));
        return Response.json({ items, total: items.length, page: 1, pageSize: 50 });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/dictionaries\/(\w+)\/entries$/,
      (_url, init, m) => {
        const code = m[1] as DictionaryCode;
        const input = body(init);
        if (store[code].some((e) => e.code.toLowerCase() === String(input.code).toLowerCase()))
          return problemResponse(409, "entry_exists");
        const created = entry(code, input.code, {
          names: input.names,
          parentCode: input.parentCode ?? null,
          mandatory: isMandatoryDictionary(code) ? (input.mandatory ?? false) : null,
          sortOrder: store[code].length,
        });
        store[code].push(created);
        return Response.json({ entry: created }, { status: 201 });
      },
    ],
    [
      "PUT",
      /^\/api\/v1\/dictionaries\/(\w+)\/entries\/([\w-]+)\/mandatory$/,
      (_url, init, m) => {
        const target = find(m[1]!, m[2]!);
        if (!target) return problemResponse(404, "not_found");
        const { mandatory } = body(init);
        if (mandatory && target.retiredAt) return problemResponse(409, "entry_retired");
        target.mandatory = mandatory;
        return Response.json({ entry: target });
      },
    ],
    [
      "PUT",
      /^\/api\/v1\/dictionaries\/(\w+)\/entries\/([\w-]+)$/,
      (_url, init, m) => {
        const target = find(m[1]!, m[2]!);
        if (!target) return problemResponse(404, "not_found");
        const input = body(init);
        Object.assign(target, { names: input.names, sortOrder: input.sortOrder, parentCode: input.parentCode });
        return Response.json({ entry: target });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/dictionaries\/(\w+)\/entries\/([\w-]+)\/retire$/,
      (_url, _init, m) => {
        const target = find(m[1]!, m[2]!);
        if (!target) return problemResponse(404, "not_found");
        if (target.mandatory) return problemResponse(409, "entry_mandatory");
        target.retiredAt = "2026-11-13T05:00:00Z";
        return Response.json({ entry: target });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/dictionaries\/(\w+)\/entries\/([\w-]+)\/restore$/,
      (_url, _init, m) => {
        const target = find(m[1]!, m[2]!);
        if (!target) return problemResponse(404, "not_found");
        target.retiredAt = null;
        return Response.json({ entry: target });
      },
    ],
    [
      "DELETE",
      /^\/api\/v1\/dictionaries\/(\w+)\/entries\/([\w-]+)$/,
      (_url, _init, m) => {
        const list = store[m[1] as DictionaryCode];
        const index = list?.findIndex((e) => e.id === m[2]) ?? -1;
        if (index === -1) return problemResponse(404, "not_found");
        list.splice(index, 1);
        return new Response(null, { status: 204 });
      },
    ],
    ["GET", /^\/api\/v1\/org-chart-sample$/, () => Response.json({ current: sample.current, latest: sample.latest })],
    [
      "POST",
      /^\/api\/v1\/org-chart-sample$/,
      () => {
        sample.latest = sampleFile("pending", "Новый образец.pdf") as OrgChartSampleState["latest"];
        return Response.json({ upload: sample.latest }, { status: 202 });
      },
    ],
  ];

  const mock = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    for (const [routeMethod, pattern, handler] of routes) {
      if (routeMethod !== method) continue;
      const match = url.pathname.match(pattern);
      if (match) return handler(url, init, match);
    }
    return problemResponse(404, "not_found");
  });
  vi.stubGlobal("fetch", mock);
  return { fetch: mock, store, sample };
}

/** Запросы метода с путём по шаблону: `{ url, body }` в порядке отправки. */
function requests(api: Backend, method: string, pattern: RegExp) {
  return api.fetch.mock.calls
    .filter(([url, init]) => (init?.method ?? "GET").toUpperCase() === method && pattern.test(String(url)))
    .map(([url, init]) => ({ url: String(url), body: init?.body }));
}
const jsonBodies = (list: { body: unknown }[]) => list.map((r) => JSON.parse(String(r.body)));
const entryUrls = (api: Backend) => requests(api, "GET", /\/entries(\?|$)/).map((r) => r.url);

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");

type Messages = typeof en;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

/** Выбор варианта в Select по имени поля. */
async function choose(user: UserEvent, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

const menuButton = (m: Messages, code: string) =>
  screen.getByRole("button", { name: fill(m.references.actions, { code }) });

/** Открывает меню действий строки и возвращает подписи пунктов. */
async function openMenu(user: UserEvent, m: Messages, code: string) {
  await user.click(menuButton(m, code));
  const menu = await screen.findByRole("menu");
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name });

describe("справочники: выбор справочника, состояния (ADM-08)", () => {
  it("Select из двенадцати справочников с видимой подписью; выбор меняет адрес ?list= и запрос; название открытого — заголовок карточки", async () => {
    const api = stubBackend();
    const { router, user } = renderRoute("/references", { locale: "ru" });
    const t = ru.references;

    expect(await screen.findByRole("heading", { level: 1, name: t.title })).toBeTruthy();
    expect(document.title).toBe(`${t.title} · ${ru.common.appName}`);
    expect(screen.getByText(t.description)).toBeTruthy();
    // По умолчанию — типы сертификатов: название крупно в карточке, подпись «Справочник» видна над списком.
    expect(screen.getByRole("heading", { level: 2, name: t.list.certificate_type })).toBeTruthy();
    expect(screen.getByText(t.listLabel, { selector: "label" })).toBeTruthy();
    expect(screen.getByText(t.mandatoryHint)).toBeTruthy();
    await waitFor(() =>
      expect(entryUrls(api)).toEqual(["/api/v1/dictionaries/certificate_type/entries?status=active&page=1"]),
    );

    const select = screen.getByRole("combobox", { name: t.listLabel });
    expect(select.textContent).toContain(t.list.certificate_type);
    await user.click(select);
    const options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(DICTIONARY_CODES.map((code) => t.list[code]));
    // Список не уже своих вариантов и открывается под кнопкой (как фильтры каталога).
    const popup = screen.getByRole("listbox").closest<HTMLElement>("[data-slot=select-content]")!;
    expect(popup.dataset.alignTrigger).toBe("false");
    expect(popup.className.split(/\s+/)).toContain("w-auto");
    expect(popup.className.split(/\s+/)).not.toContain("w-(--anchor-width)");

    await user.click(screen.getByRole("option", { name: t.list.region }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=region"));
    expect(await screen.findByRole("heading", { level: 2, name: t.list.region })).toBeTruthy();
    await waitFor(() => expect(entryUrls(api)).toContain("/api/v1/dictionaries/region/entries?status=active&page=1"));
    expect(await screen.findByText("Алматы")).toBeTruthy();
    // У справочника без обязательности подсказки об обязательности нет.
    expect(screen.queryByText(t.mandatoryHint)).toBeNull();
  });

  it("загрузка — восемь строк скелета; ошибка — Alert с «Повторить»; пустой справочник — сообщение и «Добавить значение»", async () => {
    const wait = deferred<Response>();
    let fail = true;
    const store = freshStore();
    const api = stubBackend({
      store,
      overrides: [
        ["GET", /\/dictionaries\/region\/entries$/, () => wait.promise],
        [
          "GET",
          /\/dictionaries\/process\/entries$/,
          () =>
            fail
              ? problemResponse(500, "internal")
              : Response.json({
                  dictionary: summaryOf("process", []),
                  items: [],
                  total: 0,
                  page: 1,
                  pageSize: 50,
                }),
        ],
      ],
    });
    const { user } = renderRoute("/references?list=region", { locale: "ru" });
    const t = ru.references;

    await screen.findByRole("heading", { level: 1, name: t.title });
    const panel = await screen.findByRole("tabpanel");
    expect(panel.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(8);
    expect(within(panel).queryByRole("table")).toBeNull();
    wait.resolve(
      Response.json({
        dictionary: summaryOf("region", store.region),
        items: store.region,
        total: 2,
        page: 1,
        pageSize: 50,
      }),
    );
    expect(await screen.findByText("Алматы")).toBeTruthy();
    expect(screen.getByRole("tabpanel").querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);

    // Ошибка списка: сообщение и «Повторить» под текстом.
    await choose(user, t.listLabel, t.list.process);
    const alert = await screen.findByText(t.loadError);
    expect(
      within(alert.closest<HTMLElement>('[role="alert"]')!).getByRole("button", { name: ru.common.retry }),
    ).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole("button", { name: ru.common.retry }));
    // Пустой справочник: сообщение и кнопка добавления в самом сообщении (администратор).
    expect(await screen.findByText(t.empty)).toBeTruthy();
    const empty = document.querySelector<HTMLElement>('[data-slot="empty"]')!;
    expect(within(empty).getByRole("button", { name: t.add })).toBeTruthy();
    expect(screen.queryByText(t.loadError)).toBeNull();
    expect(entryUrls(api).filter((url) => url.includes("/process/"))).toHaveLength(2);
  });

  it("пустой поиск — «Ничего не найдено по запросу» и «Сбросить поиск»; вкладка без значений объясняет, почему пусто", async () => {
    const api = stubBackend();
    const { router, user } = renderRoute("/references?list=region&q=zzz", { locale: "ru" });
    const t = ru.references;

    expect(await screen.findByText(fill(t.noResults, { q: "zzz" }))).toBeTruthy();
    expect(screen.queryByText(t.empty)).toBeNull();
    expect((screen.getByRole("textbox", { name: t.search }) as HTMLInputElement).value).toBe("zzz");
    await user.click(screen.getByRole("button", { name: t.resetSearch }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=region"));
    expect(await screen.findByText("Алматы")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: t.search }) as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(entryUrls(api).at(-1)).toBe("/api/v1/dictionaries/region/entries?status=active&page=1"));

    // Типы сертификатов: выведенных нет — вкладка «Выведенные» пуста не из-за поиска.
    cleanup();
    const store = freshStore();
    store.certificate_type = store.certificate_type.filter((e) => !e.retiredAt);
    stubBackend({ store });
    renderRoute("/references?status=retired", { locale: "ru" });
    expect(await screen.findByText(t.emptyRetired)).toBeTruthy();
  });
});

describe("справочники: поиск, статус и страница в адресе (ADM-08, OPR-05)", () => {
  it("ввод — один запрос через 350 мс с q; смена статуса и «Далее» меняют адрес; page сбрасывается", async () => {
    const api = stubBackend();
    const { router, user } = renderRoute("/references?list=tn_ved", { locale: "ru" });
    const t = ru.references;
    await waitFor(() => expect(entryUrls(api)).toEqual(["/api/v1/dictionaries/tn_ved/entries?status=active&page=1"]));

    const search = await screen.findByRole("textbox", { name: t.search });
    await user.type(search, "0101");
    // Пока адрес не записан (задержка 350 мс), новых запросов нет, а поле уже показывает набранное.
    expect((search as HTMLInputElement).value).toBe("0101");
    expect(entryUrls(api)).toHaveLength(1);
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&q=0101"));
    await waitFor(() => expect(entryUrls(api)).toHaveLength(2));
    expect(entryUrls(api)[1]).toBe("/api/v1/dictionaries/tn_ved/entries?q=0101&status=active&page=1");
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(entryUrls(api)).toHaveLength(2);

    // «Далее» — вторая страница: 120 значений по 50.
    expect(await screen.findByText(fill(t.shown, { from: "1", to: "50", total: "120" }))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t.next }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&q=0101&page=2"));
    expect(await screen.findByText(fill(t.shown, { from: "51", to: "100", total: "120" }))).toBeTruthy();
    await waitFor(() =>
      expect(entryUrls(api).at(-1)).toBe("/api/v1/dictionaries/tn_ved/entries?q=0101&status=active&page=2"),
    );
    // Номер страницы — кнопка; текущая отмечена.
    expect(screen.getByRole("button", { name: fill(t.page, { page: "2" }) }).getAttribute("aria-current")).toBe("page");
    await user.click(screen.getByRole("button", { name: fill(t.page, { page: "3" }) }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&q=0101&page=3"));

    // Смена статуса — снова первая страница.
    await user.click(screen.getByRole("tab", { name: fill(t.status.all, {}) }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&q=0101&status=all"));
    await waitFor(() =>
      expect(entryUrls(api).at(-1)).toBe("/api/v1/dictionaries/tn_ved/entries?q=0101&status=all&page=1"),
    );
    // Новый поиск тоже начинает с первой страницы.
    await user.click(screen.getByRole("button", { name: t.next }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&q=0101&status=all&page=2"));
    await user.type(screen.getByRole("textbox", { name: t.search }), "2");
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&q=01012&status=all"));
  });

  it("адрес ?list=tn_ved&q=0101&page=2 воспроизводит запрос; значения вкладок — по счётчикам списка; смена справочника сбрасывает поиск, статус и страницу", async () => {
    const api = stubBackend();
    const { router, user } = renderRoute("/references?list=tn_ved&q=0101&page=2", { locale: "ru" });
    const t = ru.references;

    expect(await screen.findByText(fill(t.shown, { from: "51", to: "100", total: "120" }))).toBeTruthy();
    expect(entryUrls(api)).toEqual(["/api/v1/dictionaries/tn_ved/entries?q=0101&status=active&page=2"]);
    expect((screen.getByRole("textbox", { name: t.search }) as HTMLInputElement).value).toBe("0101");
    expect(
      screen.getByRole("tab", { name: fill(t.status.active, { count: "120" }) }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tab", { name: fill(t.status.retired, { count: "0" }) })).toBeTruthy();

    await choose(user, t.listLabel, t.list.region);
    await waitFor(() => expect(router.state.location.search).toBe("?list=region"));
    expect(await screen.findByText("Алматы")).toBeTruthy();
    await waitFor(() => expect(entryUrls(api).at(-1)).toBe("/api/v1/dictionaries/region/entries?status=active&page=1"));
    expect((screen.getByRole("textbox", { name: t.search }) as HTMLInputElement).value).toBe("");
  });

  it("страница за последней (после удаления) возвращается на последнюю; многоточие в номерах; «Очистить поиск»", async () => {
    stubBackend();
    const { router, user } = renderRoute("/references?list=tn_ved&page=9", { locale: "ru" });
    const t = ru.references;

    // Сервер отвечает пустой страницей с прежним total: экран переходит на третью (последнюю).
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&page=3"));
    expect(await screen.findByText(fill(t.shown, { from: "101", to: "120", total: "120" }))).toBeTruthy();
    // 120 значений — три страницы: номера без многоточия.
    expect(screen.getAllByRole("button", { name: /^Страница \d$/ })).toHaveLength(3);

    await user.type(screen.getByRole("textbox", { name: t.search }), "Товар 7");
    await user.click(screen.getByRole("button", { name: t.clearSearch }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved"));
    expect((screen.getByRole("textbox", { name: t.search }) as HTMLInputElement).value).toBe("");
    // Кнопки очистки нет, пока поле пусто.
    expect(screen.queryByRole("button", { name: t.clearSearch })).toBeNull();
  });
});

describe("справочники: коды — только текст (DATA-03)", () => {
  it("код с ведущими нулями: в таблице — как есть, из поля уходит строкой", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=tn_ved&q=0101210000", { locale: "ru" });
    const t = ru.references;

    const table = await screen.findByRole("table", { name: t.list.tn_ved });
    expect(within(table).getByRole("cell", { name: "0101210000" })).toBeTruthy();
    expect(within(table).getByRole("cell", { name: "0101210000" }).className).toContain("font-mono");

    await user.click(screen.getByRole("button", { name: t.add }));
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    const code = dialog.getByLabelText(t.code) as HTMLInputElement;
    // Текстовое поле: число не получится и ведущие нули не потеряются; цифровая клавиатура и подсказка формата.
    expect(code.type).toBe("text");
    expect(code.inputMode).toBe("numeric");
    expect(dialog.getByText(t.codeHint.tn_ved)).toBeTruthy();
    await user.type(code, "0102000000");
    await user.type(dialog.getByLabelText(t.nameKk), "Тірі мал");
    await user.type(dialog.getByLabelText(t.nameRu), "Живой скот");
    await user.type(dialog.getByLabelText(t.nameEn), "Live animals");
    await user.click(dialog.getByRole("button", { name: t.add }));

    expect(await screen.findByText(fill(t.added, { code: "0102000000" }))).toBeTruthy();
    const [sent] = jsonBodies(requests(api, "POST", /\/tn_ved\/entries$/));
    expect(sent).toEqual({
      code: "0102000000",
      parentCode: null,
      names: { kk: "Тірі мал", ru: "Живой скот", en: "Live animals" },
    });
    expect(typeof sent.code).toBe("string");
    // Подсказки формата у справочников без жёсткого формата и у ОКЭД.
    cleanup();
    stubBackend();
    const second = renderRoute("/references?list=oked", { locale: "ru" });
    await second.user.click(await screen.findByRole("button", { name: t.add }));
    const okedDialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    expect(okedDialog.getByText(t.codeHint.oked)).toBeTruthy();
    expect((okedDialog.getByLabelText(t.code) as HTMLInputElement).inputMode).toBe("numeric");
  });
});

describe("справочники: добавление значения (ADM-08, ADM-09)", () => {
  it("три названия обязательны; «Обязательный тип» — только у типов сертификатов и документов; «Группа» — только у типов товаров", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await user.click(await screen.findByRole("button", { name: t.add }));
    let dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    expect(dialog.getByText(t.addHint)).toBeTruthy();
    expect(dialog.getByRole("checkbox", { name: t.mandatoryType })).toBeTruthy();
    expect(dialog.queryByRole("combobox", { name: t.groupLabel })).toBeNull();

    // Пустая форма — ошибки у полей, запроса нет; фокус — на первом поле с ошибкой.
    await user.click(dialog.getByRole("button", { name: t.add }));
    expect(await dialog.findByText(t.fieldErrors.codeRequired)).toBeTruthy();
    expect(dialog.getAllByText(t.fieldErrors.name)).toHaveLength(3);
    expect(requests(api, "POST", /\/entries$/)).toEqual([]);
    await waitFor(() => expect(document.activeElement).toBe(dialog.getByLabelText(t.code)));

    // Только код и два названия: третье обязательно.
    await user.type(dialog.getByLabelText(t.code), "NEW-CERT");
    await user.type(dialog.getByLabelText(t.nameKk), "Жаңа");
    await user.type(dialog.getByLabelText(t.nameRu), "Новый");
    await user.click(dialog.getByRole("button", { name: t.add }));
    expect(await dialog.findByText(t.fieldErrors.name)).toBeTruthy();
    expect(dialog.getByLabelText(t.nameEn).getAttribute("aria-invalid")).toBe("true");
    expect(dialog.getByLabelText(t.nameRu).getAttribute("aria-invalid")).not.toBe("true");
    expect(requests(api, "POST", /\/entries$/)).toEqual([]);

    await user.type(dialog.getByLabelText(t.nameEn), "New");
    await user.click(dialog.getByRole("checkbox", { name: t.mandatoryType }));
    await user.click(dialog.getByRole("button", { name: t.add }));
    expect(await screen.findByText(fill(t.added, { code: "NEW-CERT" }))).toBeTruthy();
    expect(jsonBodies(requests(api, "POST", /\/certificate_type\/entries$/))).toEqual([
      { code: "NEW-CERT", parentCode: null, names: { kk: "Жаңа", ru: "Новый", en: "New" }, mandatory: true },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // Список перечитан: новое значение — в таблице, обязательное.
    expect(await screen.findByRole("switch", { name: `${t.mandatory}: NEW-CERT` })).toBeTruthy();
    expect(entryUrls(api).length).toBeGreaterThanOrEqual(2);
    cleanup();

    // Регионы: ни «Обязательный тип», ни «Группа».
    stubBackend();
    const regions = renderRoute("/references?list=region", { locale: "ru" });
    await regions.user.click(await screen.findByRole("button", { name: t.add }));
    dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    expect(dialog.queryByRole("checkbox")).toBeNull();
    expect(dialog.queryByRole("combobox")).toBeNull();
    expect(dialog.getByText(t.codeHint.other)).toBeTruthy();
    cleanup();

    // Типы товаров: «Группа» из действующих групп; первый пункт — «Без группы» (группа необязательна).
    const groups = stubBackend();
    const types = renderRoute("/references?list=commodity_type", { locale: "ru" });
    await types.user.click(await screen.findByRole("button", { name: t.add }));
    dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    expect(dialog.queryByRole("checkbox")).toBeNull();
    await types.user.type(dialog.getByLabelText(t.code), "TANK");
    await types.user.type(dialog.getByLabelText(t.nameKk), "Сыйымдылық");
    await types.user.type(dialog.getByLabelText(t.nameRu), "Ёмкости");
    await types.user.type(dialog.getByLabelText(t.nameEn), "Tanks");
    await choose(types.user, t.groupLabel, "B · Группа B");
    await types.user.click(dialog.getByRole("button", { name: t.add }));
    expect(await screen.findByText(fill(t.added, { code: "TANK" }))).toBeTruthy();
    expect(jsonBodies(requests(groups, "POST", /\/commodity_type\/entries$/))).toEqual([
      { code: "TANK", parentCode: "B", names: { kk: "Сыйымдылық", ru: "Ёмкости", en: "Tanks" } },
    ]);
  });

  it("«Обязательный тип»: флажок стоит у своей подписи, пояснение — под подписью (поле с флажком из реестра shadcn)", async () => {
    stubBackend();
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await user.click(await screen.findByRole("button", { name: t.add }));
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    const checkbox = dialog.getByRole("checkbox", { name: t.mandatoryType });
    // Field horizontal с FieldContent: именно он включает `items-start` (флажок у первой строки), у простого
    // div флажок центрировался по высоте блока и оказывался на уровне пояснения.
    const field = checkbox.closest<HTMLElement>('[data-slot="field"]')!;
    expect(field.dataset.orientation).toBe("horizontal");
    expect(checkbox.parentElement).toBe(field);
    const content = field.querySelector<HTMLElement>(':scope > [data-slot="field-content"]')!;
    expect(content).toBeTruthy();
    const label = within(content).getByText(t.mandatoryType);
    const hint = within(content).getByText(t.mandatoryHint);
    expect(label.tagName).toBe("LABEL");
    // Подпись выше пояснения; пояснение связано с флажком.
    expect(label.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checkbox.getAttribute("aria-describedby")).toBe(hint.id);
    // Подпись по-прежнему переключает флажок.
    await user.click(label);
    expect(checkbox.getAttribute("aria-checked")).toBe("true");
  });

  it("409 entry_exists и 400 code_format — у поля кода, диалог открыт, фокус на коде; прочие ошибки — Alert в диалоге", async () => {
    let reply: Response = problemResponse(409, "entry_exists");
    const api = stubBackend({ overrides: [["POST", /\/region\/entries$/, () => reply.clone()]] });
    const { user } = renderRoute("/references?list=region", { locale: "ru" });
    const t = ru.references;

    await user.click(await screen.findByRole("button", { name: t.add }));
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    const code = dialog.getByLabelText(t.code);
    await user.type(code, "KZ-ALA");
    await user.type(dialog.getByLabelText(t.nameKk), "Алматы");
    await user.type(dialog.getByLabelText(t.nameRu), "Алматы");
    await user.type(dialog.getByLabelText(t.nameEn), "Almaty");
    await user.click(dialog.getByRole("button", { name: t.add }));

    const error = await dialog.findByText(t.errors.entry_exists);
    expect(code.getAttribute("aria-invalid")).toBe("true");
    expect(code.getAttribute("aria-describedby")).toContain(error.id);
    await waitFor(() => expect(document.activeElement).toBe(code));
    // Общего Alert нет: ошибка только у поля.
    expect(document.querySelector('[data-slot="alert"]')).toBeNull();

    reply = problemResponse(400, "code_format");
    await user.type(code, "2");
    expect(dialog.queryByText(t.errors.entry_exists)).toBeNull();
    await user.click(dialog.getByRole("button", { name: t.add }));
    expect(await dialog.findByText(t.errors.code_format)).toBeTruthy();
    expect(code.getAttribute("aria-invalid")).toBe("true");

    // Прочее — общим Alert в диалоге, поле кода не помечено.
    reply = problemResponse(503, "busy");
    await user.click(dialog.getByRole("button", { name: t.add }));
    const busy = await dialog.findByText(t.errors.busy);
    expect(busy.closest('[data-slot="alert"]')).toBeTruthy();
    expect(dialog.getByLabelText(t.code).getAttribute("aria-invalid")).not.toBe("true");
    expect(requests(api, "POST", /\/region\/entries$/)).toHaveLength(3);
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Enter в поле отправляет форму; формат кода проверяется до запроса; Escape закрывает диалог и возвращает фокус на «Добавить значение»", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=oked", { locale: "ru" });
    const t = ru.references;

    const trigger = await screen.findByRole("button", { name: t.add });
    await user.click(trigger);
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    await user.type(dialog.getByLabelText(t.nameKk), "Ауыл шаруашылығы");
    await user.type(dialog.getByLabelText(t.nameRu), "Сельское хозяйство");
    await user.type(dialog.getByLabelText(t.nameEn), "Agriculture");
    // Код ОКЭД — пять цифр: четыре не принимаются без запроса.
    await user.type(dialog.getByLabelText(t.code), "0111{Enter}");
    expect(await dialog.findByText(t.errors.code_format)).toBeTruthy();
    expect(requests(api, "POST", /\/entries$/)).toEqual([]);
    await user.type(dialog.getByLabelText(t.code), "0{Enter}");
    expect(await screen.findByText(fill(t.added, { code: "01110" }))).toBeTruthy();
    expect(jsonBodies(requests(api, "POST", /\/oked\/entries$/))).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await user.click(trigger);
    await screen.findByRole("dialog", { name: t.addTitle });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("справочники: пустой справочник (ADM-08)", () => {
  it("кнопка добавления одна — в сообщении; после добавления фокус переходит на заголовок карточки, а не теряется", async () => {
    stubBackend();
    const { user } = renderRoute("/references?list=process", { locale: "ru" });
    const t = ru.references;

    expect(await screen.findByText(t.empty)).toBeTruthy();
    // Один «Добавить значение»: в сообщении, а не дважды (шапка и сообщение).
    expect(screen.getAllByRole("button", { name: t.add })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: t.add }));
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    await user.type(dialog.getByLabelText(t.code), "WELD");
    await user.type(dialog.getByLabelText(t.nameKk), "Дәнекерлеу");
    await user.type(dialog.getByLabelText(t.nameRu), "Сварка");
    await user.type(dialog.getByLabelText(t.nameEn), "Welding");
    await user.click(dialog.getByRole("button", { name: t.add }));

    expect(await screen.findByText(fill(t.added, { code: "WELD" }))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("table", { name: t.list.process })).toBeTruthy();
    // Кнопка в сообщении исчезла; кнопка шапки появилась. Фокус — на заголовке карточки.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: t.list.process })),
    );
    expect(screen.getAllByRole("button", { name: t.add })).toHaveLength(1);
  });
});

describe("справочники: закрытые справочники (MAN-13, MAN-23)", () => {
  it("нет «Добавить значение», в меню — только «Изменить названия», описание объясняет почему", async () => {
    stubBackend();
    const { user } = renderRoute("/references?list=commodity_group", { locale: "ru" });
    const t = ru.references;

    expect(await screen.findByText("Группа A")).toBeTruthy();
    expect(screen.getByText(t.closedHint)).toBeTruthy();
    expect(screen.queryByText(t.mandatoryHint)).toBeNull();
    expect(screen.queryByRole("button", { name: t.add })).toBeNull();
    expect(await openMenu(user, ru, "A")).toEqual([t.edit]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    cleanup();

    // Роли контактов — тоже закрыты; даже пустой закрытый справочник не предлагает добавления.
    const store = freshStore();
    store.contact_role = [];
    stubBackend({ store });
    renderRoute("/references?list=contact_role", { locale: "ru" });
    expect(await screen.findByText(t.empty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.add })).toBeNull();
  });

  it("правка названий закрытого справочника: тело запроса без смены кода; «Сохранить» недоступна, пока ничего не изменено", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=commodity_group", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Группа A");
    await openMenu(user, ru, "A");
    await user.click(menuItem(t.edit));
    const dialog = within(await screen.findByRole("dialog", { name: fill(t.editTitle, { code: "A" }) }));
    const save = dialog.getByRole("button", { name: t.save }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect((dialog.getByLabelText(t.nameRu) as HTMLInputElement).value).toBe("Группа A");
    // Кода в форме нет: он не меняется.
    expect(dialog.queryByLabelText(t.code)).toBeNull();
    expect(dialog.getByText(t.editHint)).toBeTruthy();

    await user.clear(dialog.getByLabelText(t.nameRu));
    await user.type(dialog.getByLabelText(t.nameRu), "Станки");
    expect(save.disabled).toBe(false);
    // Порядок — число; нечисловое значение — ошибка поля без запроса.
    await user.clear(dialog.getByLabelText(t.sortOrder));
    await user.type(dialog.getByLabelText(t.sortOrder), "abc");
    await user.click(save);
    expect(await dialog.findByText(fill(t.fieldErrors.sortOrder, { max: "100 000" }))).toBeTruthy();
    expect(requests(api, "PUT", /\/entries\/[\w-]+$/)).toEqual([]);
    await user.clear(dialog.getByLabelText(t.sortOrder));
    await user.type(dialog.getByLabelText(t.sortOrder), "7");
    await user.click(save);

    expect(await screen.findByText(fill(t.updated, { code: "A" }))).toBeTruthy();
    expect(jsonBodies(requests(api, "PUT", /\/commodity_group\/entries\/[\w-]+$/))).toEqual([
      { names: { kk: "Группа A (kk)", ru: "Станки", en: "Группа A (en)" }, sortOrder: 7, parentCode: null },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("Станки")).toBeTruthy();
  });
});

describe("справочники: обязательность типов (ADM-09)", () => {
  it("Switch шлёт PUT …/mandatory сразу, показывает ожидание и итог; у выведенного значения недоступен", async () => {
    const wait = deferred<Response>();
    const api = stubBackend({
      overrides: [["PUT", /\/certificate_type\/entries\/[\w-]+\/mandatory$/, () => wait.promise]],
    });
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    const iso = await screen.findByRole("switch", { name: `${t.mandatory}: ${ISO}` });
    expect(iso.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("switch", { name: `${t.mandatory}: ${ST_KZ}` }).getAttribute("aria-checked")).toBe("true");
    await user.click(iso);

    // Запрос в пути: переключатель уже в новом положении и отмечен занятым.
    await waitFor(() => expect(requests(api, "PUT", /\/mandatory$/)).toHaveLength(1));
    expect(jsonBodies(requests(api, "PUT", /\/mandatory$/))).toEqual([{ mandatory: true }]);
    expect(requests(api, "PUT", /\/mandatory$/)[0]!.url).toBe(
      `/api/v1/dictionaries/certificate_type/entries/${idOf("certificate_type", ISO)}/mandatory`,
    );
    expect(iso.getAttribute("aria-checked")).toBe("true");
    expect(iso.getAttribute("aria-busy")).toBe("true");
    // Второй щелчок, пока запрос в пути, второго запроса не шлёт.
    await user.click(iso);
    expect(requests(api, "PUT", /\/mandatory$/)).toHaveLength(1);

    const item = api.store.certificate_type.find((e) => e.code === ISO)!;
    item.mandatory = true;
    wait.resolve(Response.json({ entry: item }));
    expect(await screen.findByText(fill(t.madeMandatory, { code: ISO }))).toBeTruthy();
    await waitFor(() => expect(iso.getAttribute("aria-busy")).toBeNull());
    expect(iso.getAttribute("aria-checked")).toBe("true");

    // Выведенное значение: переключатель недоступен (обязательным его не сделать).
    await user.click(screen.getByRole("tab", { name: t.status.all }));
    const old = await screen.findByRole("switch", { name: `${t.mandatory}: ${OLD}` });
    expect(old.getAttribute("aria-disabled")).toBe("true");
  });

  it("сбой запроса возвращает переключатель в прежнее положение и объявляет причину в строке итога (409 entry_retired)", async () => {
    stubBackend({
      overrides: [["PUT", /\/mandatory$/, () => problemResponse(409, "entry_retired")]],
    });
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    const iso = await screen.findByRole("switch", { name: `${t.mandatory}: ${ISO}` });
    await user.click(iso);
    const status = (await screen.findByText(t.errors.entry_retired)).closest<HTMLElement>("[aria-live]")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(within(status).getByRole("button", { name: t.dismiss })).toBeTruthy();
    await waitFor(() => expect(iso.getAttribute("aria-checked")).toBe("false"));
    expect(iso.getAttribute("aria-busy")).toBeNull();
    // «Скрыть» убирает строку итога.
    await user.click(within(status).getByRole("button", { name: t.dismiss }));
    expect(screen.queryByText(t.errors.entry_retired)).toBeNull();
  });

  it("Switch доступен с клавиатуры: Tab, Пробел", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    const stKz = await screen.findByRole("switch", { name: `${t.mandatory}: ${ST_KZ}` });
    const iso = screen.getByRole("switch", { name: `${t.mandatory}: ${ISO}` });
    // Tab идёт по строке: переключатель, меню действий, переключатель следующей строки.
    stKz.focus();
    await user.tab();
    expect(document.activeElement).toBe(menuButton(ru, ST_KZ));
    await user.tab();
    expect(document.activeElement).toBe(iso);
    await user.keyboard(" ");
    await waitFor(() => expect(jsonBodies(requests(api, "PUT", /\/mandatory$/))).toEqual([{ mandatory: true }]));
    expect(await screen.findByText(fill(t.madeMandatory, { code: ISO }))).toBeTruthy();
  });
});

describe("справочники: вывод из оборота, возврат, удаление (DATA-04)", () => {
  it("меню строки: «Удалить» — отдельной группой и красным; вывод идёт сразу, итог — в строке состояния, значение уходит из действующих", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    expect(await openMenu(user, ru, ISO)).toEqual([t.edit, t.retire, t.delete]);
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("separator")).toHaveLength(1);
    expect(menuItem(t.delete).getAttribute("data-variant")).toBe("destructive");
    expect(menuItem(t.retire).getAttribute("data-variant")).toBe("default");
    // Над пунктами — код значения: видно, над чем действие.
    expect(within(menu).getByText(ISO)).toBeTruthy();

    await user.click(menuItem(t.retire));
    expect(await screen.findByText(fill(t.retiredDone, { code: ISO }))).toBeTruthy();
    expect(requests(api, "POST", /\/retire$/).map((r) => r.url)).toEqual([
      `/api/v1/dictionaries/certificate_type/entries/${idOf("certificate_type", ISO)}/retire`,
    ]);
    await waitFor(() => expect(screen.queryByText("Сертификат ISO 9001")).toBeNull());
    // Счётчики вкладок обновились: был 1 выведенный, стало 2; действующих 1.
    expect(await screen.findByRole("tab", { name: fill(t.status.retired, { count: "2" }) })).toBeTruthy();
    expect(screen.getByRole("tab", { name: fill(t.status.active, { count: "1" }) })).toBeTruthy();

    // Возврат: на вкладке «Выведенные», у выведенного — «Вернуть в оборот» вместо «Вывести».
    await user.click(screen.getByRole("tab", { name: fill(t.status.retired, { count: "2" }) }));
    await screen.findByText("Прежний сертификат");
    expect(await openMenu(user, ru, OLD)).toEqual([t.edit, t.restore, t.delete]);
    await user.click(menuItem(t.restore));
    expect(await screen.findByText(fill(t.restoredDone, { code: OLD }))).toBeTruthy();
    expect(requests(api, "POST", /\/restore$/)).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText("Прежний сертификат")).toBeNull());
    // Строка «Выведено из оборота» — бейдж с состоянием в таблице всех значений.
    await user.click(screen.getByRole("tab", { name: t.status.all }));
    await screen.findByText("Сертификат ISO 9001");
    const row = screen.getByRole("cell", { name: ISO }).closest("tr")!;
    expect(within(row).getByText(t.retired)).toBeTruthy();
    expect(within(screen.getByRole("cell", { name: OLD }).closest("tr")!).getByText(t.inUse)).toBeTruthy();
  });

  it("обязательный тип нельзя вывести из оборота: 409 entry_mandatory — сообщение в строке итога", async () => {
    stubBackend();
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат соответствия СТ-КЗ");
    await openMenu(user, ru, ST_KZ);
    await user.click(menuItem(t.retire));
    expect(await screen.findByText(t.errors.entry_mandatory)).toBeTruthy();
    expect(screen.queryByText(fill(t.retiredDone, { code: ST_KZ }))).toBeNull();
    // Значение осталось в списке.
    expect(screen.getByText("Сертификат соответствия СТ-КЗ")).toBeTruthy();
  });

  it("удаление через подтверждение: «Отмена» ничего не шлёт; 409 entry_in_use — «выведите из оборота» в диалоге; успех — строка итога", async () => {
    let inUse = true;
    const api: Backend = stubBackend({
      overrides: [
        [
          "DELETE",
          /\/entries\/[\w-]+$/,
          () => {
            if (inUse) return problemResponse(409, "entry_in_use");
            api.store.certificate_type = api.store.certificate_type.filter((e) => e.code !== ISO);
            return new Response(null, { status: 204 });
          },
        ],
      ],
    });
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    await openMenu(user, ru, ISO);
    await user.click(menuItem(t.delete));
    let dialog = within(await screen.findByRole("alertdialog", { name: fill(t.deleteTitle, { code: ISO }) }));
    expect(dialog.getByText(t.deleteText)).toBeTruthy();
    await user.click(dialog.getByRole("button", { name: t.cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(requests(api, "DELETE", /\/entries\//)).toEqual([]);
    // Фокус вернулся на кнопку меню строки.
    await waitFor(() => expect(document.activeElement).toBe(menuButton(ru, ISO)));

    await openMenu(user, ru, ISO);
    await user.click(menuItem(t.delete));
    dialog = within(await screen.findByRole("alertdialog", { name: fill(t.deleteTitle, { code: ISO }) }));
    await user.click(dialog.getByRole("button", { name: t.delete }));
    expect(await dialog.findByText(t.errors.entry_in_use)).toBeTruthy();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(requests(api, "DELETE", /\/entries\//)).toHaveLength(1);

    inUse = false;
    await user.click(dialog.getByRole("button", { name: t.delete }));
    expect(await screen.findByText(fill(t.deleted, { code: ISO }))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Сертификат ISO 9001")).toBeNull());
  });

  it("меню, диалог и возврат фокуса работают с клавиатуры: Enter открывает меню, Escape закрывает диалог и возвращает фокус на кнопку меню", async () => {
    stubBackend();
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    const trigger = menuButton(ru, ISO);
    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitem").length).toBe(3);
    // С клавиатуры меню открывается на первом пункте; стрелки ходят по пунктам, Enter выбирает.
    await waitFor(() => expect(document.activeElement?.textContent).toBe(t.edit));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe(t.retire);
    await user.keyboard("{ArrowUp}{Enter}");
    await screen.findByRole("dialog", { name: fill(t.editTitle, { code: ISO }) });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

describe("справочники: директор только читает (GEN-08)", () => {
  it("те же данные без кнопок, меню, переключателей и загрузки; обязательность — «Да/Нет»", async () => {
    const api = stubBackend({ me: DIRECTOR, sample: { current: sampleFile("passed") as never, latest: null } });
    renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    const table = await screen.findByRole("table", { name: t.list.certificate_type });
    expect(within(table).getByText("Сертификат ISO 9001")).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.add })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Действия:/ })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(within(table).queryByRole("columnheader", { name: t.actionsColumn })).toBeNull();
    const yes = within(screen.getByRole("cell", { name: ST_KZ }).closest("tr")!);
    expect(yes.getByText(t.yes)).toBeTruthy();
    expect(within(screen.getByRole("cell", { name: ISO }).closest("tr")!).getByText(t.no)).toBeTruthy();

    // Образец: ссылка «Скачать» есть, загрузки нет.
    expect(await screen.findByRole("link", { name: t.sample.download })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.sample.replace })).toBeNull();
    expect(screen.queryByRole("button", { name: t.sample.upload })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    // Директор не посылает ничего, кроме чтения.
    expect(api.fetch.mock.calls.filter(([, init]) => (init?.method ?? "GET") !== "GET")).toEqual([]);
  });
});

describe("образец оргструктуры (ADM-11)", () => {
  const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const sampleCard = () =>
    within(
      screen.getByRole("heading", { name: ru.references.sample.title }).closest<HTMLElement>('[data-slot="card"]')!,
    );

  it("образец не загружен: «Образец не загружен» и «Загрузить образец»; ссылки нет", async () => {
    stubBackend();
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    expect(await screen.findByText(t.none)).toBeTruthy();
    expect(screen.getByText(t.hint)).toBeTruthy();
    expect(sampleCard().getByRole("button", { name: t.upload })).toBeTruthy();
    expect(sampleCard().queryByRole("link")).toBeNull();
  });

  it("текущий образец: имя, размер, дата и ссылка на стабильный адрес /api/v1/org-chart-sample/current/content", async () => {
    stubBackend({ sample: { current: sampleFile("passed") as never, latest: null } });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    const link = await screen.findByRole("link", { name: t.download });
    // Обычная ссылка: браузер идёт на API, а не React Router. Адрес не зависит от файла, поэтому не устаревает.
    expect(link.getAttribute("href")).toBe("/api/v1/org-chart-sample/current/content");
    const card = sampleCard();
    expect(card.getByText("Образец оргструктуры.pdf")).toBeTruthy();
    expect(
      card.getByText(fill(t.fileMeta, { size: fill(t.mb, { size: "1,5" }), date: "12.11.2026, 13:30" })),
    ).toBeTruthy();
    expect(card.getByText(t.current)).toBeTruthy();
    expect(card.getByRole("button", { name: t.replace })).toBeTruthy();
    expect(card.queryByRole("button", { name: t.upload })).toBeNull();
  });

  it("загрузка: FormData с полем file, итог — в строке состояния, затем «Проверяется антивирусом»", async () => {
    const api = stubBackend({ sample: { current: sampleFile("passed") as never, latest: null } });
    const { user } = renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    await screen.findByRole("link", { name: t.download });
    const input = fileInput();
    // Принимаются те же пять типов, что и сервер (DATA-06).
    expect(input.accept.split(",")).toEqual(
      expect.arrayContaining(["application/pdf", "image/png", ".docx", ".xlsx", ".jpg"]),
    );
    expect(input.getAttribute("aria-hidden")).toBe("true");
    const file = new File(["%PDF-1.4"], "Новый образец.pdf", { type: "application/pdf" });
    await user.upload(input, file);

    expect(await screen.findByText(t.uploaded)).toBeTruthy();
    const [upload] = requests(api, "POST", /\/org-chart-sample$/);
    expect(upload!.body).toBeInstanceOf(FormData);
    expect((upload!.body as FormData).get("file")).toBeInstanceOf(File);
    expect(((upload!.body as FormData).get("file") as File).name).toBe("Новый образец.pdf");
    expect([...(upload!.body as FormData).keys()]).toEqual(["file"]);
    // Состояние перечитано: проверка идёт, а текущий образец остаётся доступным.
    expect(await sampleCard().findByText(t.pending)).toBeTruthy();
    expect(sampleCard().getByText(t.pendingHint)).toBeTruthy();
    expect(sampleCard().getByText(t.pendingDuration)).toBeTruthy();
    expect(sampleCard().getByRole("link", { name: t.download }).getAttribute("href")).toBe(
      "/api/v1/org-chart-sample/current/content",
    );
  });

  it("проверка идёт: опрос каждые 5 секунд до смены состояния, затем новый образец становится текущим и опрос прекращается", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sample: Backend["sample"] = {
      current: sampleFile("passed", "Прежний образец.pdf") as never,
      latest: sampleFile("pending", "Новый образец.pdf") as never,
    };
    const api = stubBackend({ sample });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;
    const polls = () => requests(api, "GET", /\/org-chart-sample$/).length;

    expect(await screen.findByText(t.pending)).toBeTruthy();
    expect(screen.getByText("Новый образец.pdf")).toBeTruthy();
    expect(screen.getByText("Прежний образец.pdf")).toBeTruthy();
    expect(polls()).toBe(1);
    await vi.advanceTimersByTimeAsync(4_500);
    expect(polls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await waitFor(() => expect(polls()).toBe(2));
    // Проверка прошла: сервер отдаёт новый образец как текущий.
    sample.current = sampleFile("passed", "Новый образец.pdf") as never;
    sample.latest = null;
    await vi.advanceTimersByTimeAsync(5_000);
    await waitFor(() => expect(screen.queryByText(t.pending)).toBeNull());
    expect(await screen.findByText("Новый образец.pdf")).toBeTruthy();
    expect(screen.queryByText("Прежний образец.pdf")).toBeNull();
    // Строка итога объявила результат проверки (U1): образец стал текущим.
    expect(screen.getByText(t.checkPassed).closest("[aria-live]")!.getAttribute("aria-live")).toBe("polite");
    const after = polls();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(polls()).toBe(after);
  });

  it("образец не прошёл проверку: «Не прошёл проверку», текущий остаётся прежним, опроса нет", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = stubBackend({
      sample: {
        current: sampleFile("passed", "Прежний образец.pdf") as never,
        latest: sampleFile("rejected", "Вирус.pdf") as never,
      },
    });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    const badge = await screen.findByText(t.rejected);
    expect(badge.closest('[data-slot="badge"]')!.className).toContain("text-destructive");
    expect(screen.getByText(t.rejectedHint)).toBeTruthy();
    expect(screen.getByText(t.keptCurrent)).toBeTruthy();
    expect(screen.getByText("Прежний образец.pdf")).toBeTruthy();
    expect(sampleCard().getByRole("link", { name: t.download })).toBeTruthy();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(requests(api, "GET", /\/org-chart-sample$/)).toHaveLength(1);
  });

  it("413, 415 и прочие отказы загрузки — переведённые сообщения в карточке; следующая загрузка убирает прежнее", async () => {
    let reply: Response = problemResponse(413, "file_too_large");
    const api = stubBackend({ overrides: [["POST", /\/org-chart-sample$/, () => reply.clone()]] });
    const { user } = renderRoute("/references", { locale: "ru" });
    const t = ru.references;

    await screen.findByText(t.sample.none);
    const pdf = new File(["x"], "a.pdf", { type: "application/pdf" });
    await user.upload(fileInput(), pdf);
    expect(await sampleCard().findByText(t.errors.file_too_large)).toBeTruthy();
    expect(screen.queryByText(t.sample.uploaded)).toBeNull();

    // 415 для DOCX и XLSX с непроверяемой структурой: человеческая подсказка, а не код.
    reply = problemResponse(415, "file_structure_unsupported");
    await user.upload(
      fileInput(),
      new File(["x"], "b.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    );
    expect(await sampleCard().findByText(t.errors.file_structure_unsupported)).toBeTruthy();
    expect(sampleCard().queryByText(t.errors.file_too_large)).toBeNull();
    expect(screen.queryByText(/file_structure_unsupported/)).toBeNull();

    reply = problemResponse(415, "file_type_mismatch");
    await user.upload(fileInput(), pdf);
    expect(await sampleCard().findByText(t.errors.file_type_mismatch)).toBeTruthy();

    // 413 без тела problem+json (отказ прокси): тоже «файл больше 25 МБ».
    reply = new Response("<html>413</html>", { status: 413, headers: { "content-type": "text/html" } });
    await user.upload(fileInput(), pdf);
    expect(await sampleCard().findByText(t.errors.file_too_large)).toBeTruthy();
    expect(requests(api, "POST", /\/org-chart-sample$/)).toHaveLength(4);
  });

  it("файл больше 25 МБ не уходит на сервер", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references", { locale: "ru" });
    const t = ru.references;

    await screen.findByText(t.sample.none);
    const big = new File(["x"], "big.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 25 * 1024 * 1024 + 1 });
    await user.upload(fileInput(), big);
    expect(await sampleCard().findByText(t.errors.file_too_large)).toBeTruthy();
    expect(requests(api, "POST", /\/org-chart-sample$/)).toEqual([]);
  });

  it("ошибка чтения образца — сообщение с «Повторить»", async () => {
    let fail = true;
    const api = stubBackend({
      overrides: [
        [
          "GET",
          /\/org-chart-sample$/,
          () => (fail ? problemResponse(500, "internal") : Response.json({ current: null, latest: null })),
        ],
      ],
    });
    const { user } = renderRoute("/references", { locale: "ru" });

    const message = await screen.findByText(ru.references.sample.loadError);
    fail = false;
    await user.click(
      within(message.closest<HTMLElement>('[role="alert"]')!).getByRole("button", { name: ru.common.retry }),
    );
    expect(await screen.findByText(ru.references.sample.none)).toBeTruthy();
    expect(requests(api, "GET", /\/org-chart-sample$/)).toHaveLength(2);
  });
});

describe("тексты ошибок и языки (LANG-01, LANG-02)", () => {
  it("каждый код REFERENCE_PROBLEM_CODES и FILE_PROBLEM_CODES переведён на трёх языках без кодов и жаргона", () => {
    const codes = [...new Set([...REFERENCE_PROBLEM_CODES, ...FILE_PROBLEM_CODES])];
    for (const code of codes) {
      const key = REFERENCE_PROBLEM_MESSAGES[code];
      expect(key, code).toBeTruthy();
      for (const [locale, messages] of [
        ["kk", kk],
        ["ru", ru],
        ["en", en],
      ] as const) {
        const text = (messages.references.errors as Record<string, string>)[key];
        expect(text, `${locale}: ${code}`).toBeTruthy();
        expect(text!.trim(), `${locale}: ${code}`).not.toBe("");
        // В тексте для человека нет кода ошибки.
        expect(text, `${locale}: ${code}`).not.toContain(code);
      }
    }
    // Ключи сообщений не повисают: каждый ключ errors нужен какому-то коду или запасному случаю.
    const used = new Set<string>([...Object.values(REFERENCE_PROBLEM_MESSAGES), "requestError"]);
    expect(Object.keys(en.references.errors).sort()).toEqual([...used].sort());
    expect(en.references.errors.file_structure_unsupported).toBe(
      "The file could not be checked: save the document again in Word or Excel and upload it once more.",
    );
  });

  it("казахский: заголовок, подпись списка, названия справочников, вкладки, колонки и меню", async () => {
    stubBackend({ sample: { current: sampleFile("passed") as never, latest: null } });
    const { user } = renderRoute("/references", { locale: "kk" });
    const t = kk.references;

    expect(await screen.findByRole("heading", { level: 1, name: t.title })).toBeTruthy();
    expect(document.title).toBe(`${t.title} · ${kk.common.appName}`);
    expect(screen.getByText(t.description)).toBeTruthy();
    expect(screen.getByText(t.listLabel, { selector: "label" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: t.list.certificate_type })).toBeTruthy();
    expect(screen.getByText(t.mandatoryHint)).toBeTruthy();
    // Названия значений — данные: на казахском интерфейсе — казахские названия (LANG-05).
    expect(await screen.findByText("Сертификат ISO 9001 (kk)")).toBeTruthy();
    for (const column of [t.code, t.name, t.mandatory, t.state])
      expect(screen.getByRole("columnheader", { name: column })).toBeTruthy();
    expect(screen.getByRole("tab", { name: fill(t.status.active, { count: "2" }) })).toBeTruthy();
    expect(screen.getByRole("tab", { name: t.status.all })).toBeTruthy();
    expect(screen.getByRole("switch", { name: `${t.mandatory}: ${ISO}` })).toBeTruthy();
    expect(await openMenu(user, kk, ISO)).toEqual([t.edit, t.retire, t.delete]);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: t.add })).toBeTruthy();
    expect(screen.getByRole("link", { name: t.sample.download })).toBeTruthy();
    expect(screen.getByText(t.sample.hint)).toBeTruthy();
    const options = await (async () => {
      await user.click(screen.getByRole("combobox", { name: t.listLabel }));
      return (await screen.findAllByRole("option")).map((o) => o.textContent);
    })();
    expect(options).toEqual(DICTIONARY_CODES.map((code) => t.list[code]));
  });

  it("английский: те же элементы; названия значений — английские", async () => {
    stubBackend();
    const { user } = renderRoute("/references", { locale: "en" });
    const t = en.references;

    expect(await screen.findByRole("heading", { level: 1, name: t.title })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: t.list.certificate_type })).toBeTruthy();
    expect(await screen.findByText("Сертификат ISO 9001 (en)")).toBeTruthy();
    expect(screen.getByRole("tab", { name: fill(t.status.active, { count: "2" }) })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t.add }));
    expect(await screen.findByRole("dialog", { name: t.addTitle })).toBeTruthy();
    expect(screen.getByLabelText(t.nameKk)).toBeTruthy();
    expect(screen.getByLabelText(t.nameRu)).toBeTruthy();
    expect(screen.getByLabelText(t.nameEn)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: t.mandatoryType })).toBeTruthy();
    // Своя кнопка «Отмена»: у встроенной подпись «Close» не переводится.
    expect(screen.getByRole("button", { name: t.cancel })).toBeTruthy();
  });
});

describe("узкий экран, 390 px: список вместо таблицы, без горизонтальной прокрутки (ADM-08)", () => {
  /** Ширина карточки в jsdom не измеряется: подменяем её так, как её отдал бы браузер на 390 px. */
  const narrow = (width = 358) =>
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          width,
          height: 100,
          top: 0,
          left: 0,
          right: width,
          bottom: 100,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );

  it("две колонки: код, название и бейджи слева, меню справа; переключатель обязательности под названием; таблицы нет", async () => {
    narrow();
    const api = stubBackend();
    const { user } = renderRoute("/references?list=certificate_type&status=all", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    expect(screen.queryByRole("table")).toBeNull();
    const list = screen.getByRole("list", { name: t.list.certificate_type });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const iso = within(items[1]!);
    expect(iso.getByText(ISO).className).toContain("font-mono");
    expect(iso.getByText("Сертификат ISO 9001")).toBeTruthy();
    expect(iso.getByRole("switch", { name: `${t.mandatory}: ${ISO}` })).toBeTruthy();
    expect(iso.getByRole("button", { name: fill(t.actions, { code: ISO }) })).toBeTruthy();
    // Выведенное значение: бейдж «Выведено из оборота»; у действующего бейджа состояния нет.
    expect(within(items[2]!).getByText(t.retired)).toBeTruthy();
    expect(iso.queryByText(t.retired)).toBeNull();
    // Обязательный тип у директора был бы бейджем; у администратора — переключатель (его положение).
    expect(
      within(items[0]!)
        .getByRole("switch", { name: `${t.mandatory}: ${ST_KZ}` })
        .getAttribute("aria-checked"),
    ).toBe("true");

    await user.click(iso.getByRole("switch", { name: `${t.mandatory}: ${ISO}` }));
    await waitFor(() => expect(jsonBodies(requests(api, "PUT", /\/mandatory$/))).toEqual([{ mandatory: true }]));
    expect(await openMenu(user, ru, ISO)).toEqual([t.edit, t.retire, t.delete]);
  });

  it("подвал: «Страница N из M» вместо номеров, кнопки «Назад» и «Далее»; группа типа товара — бейджем", async () => {
    narrow();
    stubBackend();
    const { router, user } = renderRoute("/references?list=tn_ved", { locale: "ru" });
    const t = ru.references;

    expect(await screen.findByText(fill(t.shown, { from: "1", to: "50", total: "120" }))).toBeTruthy();
    expect(screen.getByText(fill(t.pageOf, { page: "1", pages: "3" }))).toBeTruthy();
    expect(screen.queryByRole("button", { name: fill(t.page, { page: "2" }) })).toBeNull();
    expect(screen.getByRole("button", { name: t.previous }).getAttribute("aria-disabled")).toBe("true");
    await user.click(screen.getByRole("button", { name: t.next }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&page=2"));
    expect(await screen.findByText(fill(t.pageOf, { page: "2", pages: "3" }))).toBeTruthy();
    // Группа у типов товаров показана бейджем в списке.
    cleanup();
    stubBackend();
    renderRoute("/references?list=commodity_type", { locale: "ru" });
    const pump = (await screen.findByText("Насосы")).closest("li")!;
    expect(within(pump).getByText("A")).toBeTruthy();
  });

  it("директор на узком экране: обязательный тип — бейдж, без переключателей и меню", async () => {
    narrow();
    stubBackend({ me: DIRECTOR });
    renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    const st = (await screen.findByText("Сертификат соответствия СТ-КЗ")).closest("li")!;
    expect(within(st).getByText(t.mandatory)).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Действия:/ })).toBeNull();
    const iso = screen.getByText("Сертификат ISO 9001").closest("li")!;
    expect(within(iso).queryByText(t.mandatory)).toBeNull();
  });
});

describe("справочники: группа типа товара необязательна (ADM-08)", () => {
  /** Временный тип товара без группы — такие значения стоят на стенде. */
  const withUngrouped = () => {
    const store = freshStore();
    store.commodity_type.push(entry("commodity_type", "TEMP", { name: "Временный тип", parentCode: null }));
    return store;
  };

  const fillNames = async (user: UserEvent, dialog: ReturnType<typeof within>, code?: string) => {
    if (code) await user.type(dialog.getByLabelText(ru.references.code), code);
    await user.type(dialog.getByLabelText(ru.references.nameKk), "Сыйымдылық");
    await user.type(dialog.getByLabelText(ru.references.nameRu), "Ёмкости");
    await user.type(dialog.getByLabelText(ru.references.nameEn), "Tanks");
  };

  it("добавление без группы: первый пункт списка — «Без группы», он выбран, ошибки нет, parentCode: null", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=commodity_type", { locale: "ru" });
    const t = ru.references;

    await user.click(await screen.findByRole("button", { name: t.add }));
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    const group = dialog.getByRole("combobox", { name: t.groupLabel });
    expect(group.textContent).toContain(t.noGroup);
    await user.click(group);
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual([t.noGroup, "A · Группа A", "B · Группа B", "C · Группа C"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());

    await fillNames(user, dialog, "TANK");
    await user.click(dialog.getByRole("button", { name: t.add }));
    expect(await screen.findByText(fill(t.added, { code: "TANK" }))).toBeTruthy();
    expect(jsonBodies(requests(api, "POST", /\/commodity_type\/entries$/))).toEqual([
      { code: "TANK", parentCode: null, names: { kk: "Сыйымдылық", ru: "Ёмкости", en: "Tanks" } },
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("добавление: выбрал группу, вернулся к «Без группы» — уходит null; выбрал группу — уходит её код", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=commodity_type", { locale: "ru" });
    const t = ru.references;

    await user.click(await screen.findByRole("button", { name: t.add }));
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    await fillNames(user, dialog, "TANK");
    await choose(user, t.groupLabel, "B · Группа B");
    expect(dialog.getByRole("combobox", { name: t.groupLabel }).textContent).toContain("B · Группа B");
    await choose(user, t.groupLabel, t.noGroup);
    expect(dialog.getByRole("combobox", { name: t.groupLabel }).textContent).toContain(t.noGroup);
    await user.click(dialog.getByRole("button", { name: t.add }));
    expect(await screen.findByText(fill(t.added, { code: "TANK" }))).toBeTruthy();
    expect(jsonBodies(requests(api, "POST", /\/commodity_type\/entries$/))).toEqual([
      { code: "TANK", parentCode: null, names: { kk: "Сыйымдылық", ru: "Ёмкости", en: "Tanks" } },
    ]);
  });

  it("правка типа без группы: можно переименовать, не назначая группу; в таблице — прочерк; уходит parentCode: null", async () => {
    const api = stubBackend({ store: withUngrouped() });
    const { user } = renderRoute("/references?list=commodity_type", { locale: "ru" });
    const t = ru.references;

    const row = within((await screen.findByText("Временный тип")).closest("tr")!);
    expect(row.getByText("—")).toBeTruthy();
    await openMenu(user, ru, "TEMP");
    await user.click(menuItem(t.edit));
    const dialog = within(await screen.findByRole("dialog", { name: fill(t.editTitle, { code: "TEMP" }) }));
    expect(dialog.getByRole("combobox", { name: t.groupLabel }).textContent).toContain(t.noGroup);
    expect((dialog.getByRole("button", { name: t.save }) as HTMLButtonElement).disabled).toBe(true);
    await user.clear(dialog.getByLabelText(t.nameRu));
    await user.type(dialog.getByLabelText(t.nameRu), "Старый тип");
    await user.click(dialog.getByRole("button", { name: t.save }));

    expect(await screen.findByText(fill(t.updated, { code: "TEMP" }))).toBeTruthy();
    expect(jsonBodies(requests(api, "PUT", /\/commodity_type\/entries\/[\w-]+$/))).toEqual([
      {
        names: { kk: "Временный тип (kk)", ru: "Старый тип", en: "Временный тип (en)" },
        sortOrder: 0,
        parentCode: null,
      },
    ]);
    expect(await screen.findByText("Старый тип")).toBeTruthy();
  });

  it("правка типа с группой: «Без группы» снимает группу; возврат к прежней группе делает форму неизменённой", async () => {
    const api = stubBackend();
    const { user } = renderRoute("/references?list=commodity_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Насосы");
    await openMenu(user, ru, "PUMP");
    await user.click(menuItem(t.edit));
    const dialog = within(await screen.findByRole("dialog", { name: fill(t.editTitle, { code: "PUMP" }) }));
    const save = dialog.getByRole("button", { name: t.save }) as HTMLButtonElement;
    expect(dialog.getByRole("combobox", { name: t.groupLabel }).textContent).toContain("A · Группа A");
    expect(save.disabled).toBe(true);

    await choose(user, t.groupLabel, t.noGroup);
    expect(save.disabled).toBe(false);
    await choose(user, t.groupLabel, "A · Группа A");
    expect(save.disabled).toBe(true);
    await choose(user, t.groupLabel, t.noGroup);
    await user.click(save);

    expect(await screen.findByText(fill(t.updated, { code: "PUMP" }))).toBeTruthy();
    expect(jsonBodies(requests(api, "PUT", /\/commodity_type\/entries\/[\w-]+$/))).toEqual([
      { names: { kk: "Насосы (kk)", ru: "Насосы", en: "Насосы (en)" }, sortOrder: 0, parentCode: null },
    ]);
    // Группа снята: в таблице у «Насосы» прочерк.
    await waitFor(() => expect(within(screen.getByText("Насосы").closest("tr")!).queryByText("A")).toBeNull());
    expect(within(screen.getByText("Насосы").closest("tr")!).getByText("—")).toBeTruthy();
  });

  it("список групп не загрузился: сообщение с «Повторить»; значение без группы всё равно можно добавить", async () => {
    let fail = true;
    const api = stubBackend({
      overrides: [
        [
          "GET",
          /\/dictionaries\/commodity_group\/choices$/,
          () =>
            fail
              ? problemResponse(500, "internal")
              : Response.json({
                  items: [{ id: idOf("commodity_group", "A"), code: "A", name: "Группа A", parentCode: null }],
                  total: 1,
                  page: 1,
                  pageSize: 50,
                }),
        ],
      ],
    });
    const { user } = renderRoute("/references?list=commodity_type", { locale: "ru" });
    const t = ru.references;

    await user.click(await screen.findByRole("button", { name: t.add }));
    const dialog = within(await screen.findByRole("dialog", { name: t.addTitle }));
    const message = await dialog.findByText(t.groupLoadError);
    expect(message.closest('[role="alert"]')).toBeTruthy();
    // «Повторить» — рядом с сообщением, в диалоге.
    fail = false;
    await user.click(dialog.getByRole("button", { name: ru.common.retry }));
    await waitFor(() => expect(dialog.queryByText(t.groupLoadError)).toBeNull());
    expect(dialog.queryByRole("button", { name: ru.common.retry })).toBeNull();
    expect(requests(api, "GET", /\/commodity_group\/choices(\?|$)/)).toHaveLength(2);
    await choose(user, t.groupLabel, "A · Группа A");
    expect(dialog.getByRole("combobox", { name: t.groupLabel }).textContent).toContain("A · Группа A");
  });

  it("колонка и подпись поля называются одинаково: «Товарная группа»", async () => {
    stubBackend();
    const { user } = renderRoute("/references?list=commodity_type", { locale: "ru" });
    const t = ru.references;

    expect(t.group).toBe("Товарная группа");
    expect(t.groupLabel).toBe(t.group);
    expect(await screen.findByRole("columnheader", { name: t.group })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: t.add }));
    expect(await screen.findByRole("combobox", { name: t.group })).toBeTruthy();
  });
});

describe("справочники: отказ сервера и конец сеанса посреди действия (ADM-08, DATA-04, GEN-08)", () => {
  /** Ответ /me: пока `expired` не выставлен — администратор; потом — 401 за воротами, которые тест открывает сам. */
  function sessionOverride() {
    const state = { expired: false };
    const gate = deferred<void>();
    const override: [string, RegExp, Handler] = [
      "GET",
      /^\/api\/auth\/me$/,
      async () => {
        if (!state.expired) return Response.json(ADMIN);
        await gate.promise;
        return problemResponse(401, "unauthorized");
      },
    ];
    return { state, gate, override };
  }

  it("«Вернуть в оборот»: отказ сервера — сообщение в строке итога, значение остаётся выведенным", async () => {
    const api = stubBackend({
      overrides: [["POST", /\/restore$/, () => problemResponse(503, "busy")]],
    });
    const { user } = renderRoute("/references?list=certificate_type&status=retired", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Прежний сертификат");
    await openMenu(user, ru, OLD);
    await user.click(menuItem(t.restore));

    const status = (await screen.findByText(t.errors.busy)).closest<HTMLElement>("[aria-live]")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByText(fill(t.restoredDone, { code: OLD }))).toBeNull();
    expect(requests(api, "POST", /\/restore$/)).toHaveLength(1);
    // Состояние не изменилось: значение в той же вкладке «Выведенные», счётчики прежние, на сервере оно выведено.
    expect(screen.getByText("Прежний сертификат")).toBeTruthy();
    expect(screen.getByRole("tab", { name: fill(t.status.retired, { count: "1" }) })).toBeTruthy();
    expect(api.store.certificate_type.find((e) => e.code === OLD)!.retiredAt).not.toBeNull();
    // Кнопка меню снова доступна: действие можно повторить.
    expect(menuButton(ru, OLD).getAttribute("aria-busy")).toBeNull();
    expect(await openMenu(user, ru, OLD)).toEqual([t.edit, t.restore, t.delete]);
  });

  it("сохранение названий: отказ сервера — Alert в диалоге, диалог открыт, введённое сохранено, список прежний", async () => {
    let fail = true;
    const api = stubBackend({
      overrides: [
        [
          "PUT",
          /\/certificate_type\/entries\/[\w-]+$/,
          (_url, init) => {
            if (fail) return problemResponse(503, "busy");
            const target = api.store.certificate_type.find((e) => e.code === ISO)!;
            Object.assign(target, { names: JSON.parse(String(init?.body)).names });
            return Response.json({ entry: target });
          },
        ],
      ],
    });
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    await openMenu(user, ru, ISO);
    await user.click(menuItem(t.edit));
    const dialog = within(await screen.findByRole("dialog", { name: fill(t.editTitle, { code: ISO }) }));
    await user.clear(dialog.getByLabelText(t.nameRu));
    await user.type(dialog.getByLabelText(t.nameRu), "ISO 9001 новый");
    await user.click(dialog.getByRole("button", { name: t.save }));

    const alert = await dialog.findByText(t.errors.busy);
    expect(alert.closest('[data-slot="alert"]')).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((dialog.getByLabelText(t.nameRu) as HTMLInputElement).value).toBe("ISO 9001 новый");
    expect(screen.queryByText(fill(t.updated, { code: ISO }))).toBeNull();
    // В таблице под диалогом прежнее название; на сервере — тоже.
    expect(screen.getAllByText("Сертификат ISO 9001").length).toBeGreaterThan(0);
    expect(screen.queryByText("ISO 9001 новый", { selector: "td" })).toBeNull();
    expect(api.store.certificate_type.find((e) => e.code === ISO)!.names.ru).toBe("Сертификат ISO 9001");
    expect((dialog.getByRole("button", { name: t.save }) as HTMLButtonElement).disabled).toBe(false);

    // Повтор после отказа проходит.
    fail = false;
    await user.click(dialog.getByRole("button", { name: t.save }));
    expect(await screen.findByText(fill(t.updated, { code: ISO }))).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByText("ISO 9001 новый")).toBeTruthy();
    expect(requests(api, "PUT", /\/entries\/[\w-]+$/)).toHaveLength(2);
  });

  it("401 посреди действия: /me перечитан, сообщение о сеансе видно, затем вход с возвратом на страницу (как на /admin/accounts)", async () => {
    const session = sessionOverride();
    const api = stubBackend({
      overrides: [session.override, ["POST", /\/retire$/, () => problemResponse(401, "unauthenticated")]],
    });
    const { router, user } = renderRoute("/references?list=certificate_type&status=all", { locale: "ru" });
    const t = ru.references;
    const meCalls = () => requests(api, "GET", /^\/api\/auth\/me$/).length;

    await screen.findByText("Сертификат ISO 9001");
    const before = meCalls();
    session.state.expired = true;
    await openMenu(user, ru, ISO);
    await user.click(menuItem(t.retire));

    // Итог объявлен, значение не изменилось, а сеанс перечитывается.
    expect(await screen.findByText(t.errors.session)).toBeTruthy();
    await waitFor(() => expect(meCalls()).toBeGreaterThan(before));
    expect(api.store.certificate_type.find((e) => e.code === ISO)!.retiredAt).toBeNull();
    expect(router.state.location.pathname).toBe("/references");

    // /me ответил 401: AppShell уводит на вход и помнит, куда вернуться.
    session.gate.resolve();
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe(
      `?error=session_expired&returnTo=${encodeURIComponent("/references?list=certificate_type&status=all")}`,
    );
  });

  it("401 при сохранении названий: сообщение о сеансе в диалоге, затем вход", async () => {
    const session = sessionOverride();
    const api = stubBackend({
      overrides: [session.override, ["PUT", /\/entries\/[\w-]+$/, () => problemResponse(401, "unauthenticated")]],
    });
    const { router, user } = renderRoute("/references?list=region", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Алматы");
    session.state.expired = true;
    await openMenu(user, ru, "KZ-ALA");
    await user.click(menuItem(t.edit));
    const dialog = within(await screen.findByRole("dialog", { name: fill(t.editTitle, { code: "KZ-ALA" }) }));
    await user.clear(dialog.getByLabelText(t.nameRu));
    await user.type(dialog.getByLabelText(t.nameRu), "Алма-Ата");
    await user.click(dialog.getByRole("button", { name: t.save }));

    expect(await dialog.findByText(t.errors.session)).toBeTruthy();
    expect(api.store.region.find((e) => e.code === "KZ-ALA")!.names.ru).toBe("Алматы");
    session.gate.resolve();
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe(
      `?error=session_expired&returnTo=${encodeURIComponent("/references?list=region")}`,
    );
  });
});

describe("справочники: прежние строки не показываются чужому справочнику (ADM-08)", () => {
  /** Ответ сервера на список, который тест держит «в пути» до своего сигнала. */
  const slow = (store: Store, code: DictionaryCode, when: (url: URL) => boolean) => {
    const wait = deferred<void>();
    const handler: Handler = async (url) => {
      if (when(url)) await wait.promise;
      return listResponse(store, code, url);
    };
    return { wait, handler };
  };

  it("смена справочника: пока новый грузится — скелет, строк прежнего справочника нет; затем строки нового", async () => {
    const store = freshStore();
    const held = slow(store, "region", () => true);
    stubBackend({ store, overrides: [["GET", /\/dictionaries\/region\/entries$/, held.handler]] });
    const { router, user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    await choose(user, t.listLabel, t.list.region);
    await waitFor(() => expect(router.state.location.search).toBe("?list=region"));
    expect(await screen.findByRole("heading", { level: 2, name: t.list.region })).toBeTruthy();

    // Запрос регионов в пути: прежних строк (и таблицы вообще) нет, вместо них скелет.
    const panel = await screen.findByRole("tabpanel");
    await waitFor(() => expect(panel.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(8));
    expect(screen.queryByText("Сертификат ISO 9001")).toBeNull();
    expect(screen.queryByText("Сертификат соответствия СТ-КЗ")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    // Счётчики вкладок прежнего справочника тоже не показываются: «—» до ответа.
    expect(screen.getByRole("tab", { name: fill(t.status.active, { count: "—" }) })).toBeTruthy();

    held.wait.resolve();
    expect(await screen.findByText("Алматы")).toBeTruthy();
    expect(screen.queryByText("Сертификат ISO 9001")).toBeNull();
  });

  it("смена поиска в том же справочнике: прежние строки остаются приглушёнными до ответа, без скелета", async () => {
    const store = freshStore();
    const held = slow(store, "certificate_type", (url) => url.searchParams.get("q") === "ISO");
    stubBackend({ store, overrides: [["GET", /\/dictionaries\/certificate_type\/entries$/, held.handler]] });
    const { router, user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    await user.type(screen.getByRole("textbox", { name: t.search }), "ISO");
    await waitFor(() => expect(router.state.location.search).toBe("?list=certificate_type&q=ISO"));

    // Запрос с q в пути: старые строки на месте, скелета нет.
    const table = screen.getByRole("table", { name: t.list.certificate_type });
    await waitFor(() => expect(table.closest(".opacity-60")).toBeTruthy());
    expect(screen.getByText("Сертификат соответствия СТ-КЗ")).toBeTruthy();
    expect(screen.getByText("Сертификат ISO 9001")).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);

    held.wait.resolve();
    await waitFor(() => expect(screen.queryByText("Сертификат соответствия СТ-КЗ")).toBeNull());
    expect(screen.getByText("Сертификат ISO 9001")).toBeTruthy();
  });

  it("смена вкладки в том же справочнике: прежние строки остаются до ответа, затем строки вкладки", async () => {
    const store = freshStore();
    const held = slow(store, "certificate_type", (url) => url.searchParams.get("status") === "retired");
    stubBackend({ store, overrides: [["GET", /\/dictionaries\/certificate_type\/entries$/, held.handler]] });
    const { router, user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    await user.click(screen.getByRole("tab", { name: fill(t.status.retired, { count: "1" }) }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=certificate_type&status=retired"));

    const table = screen.getByRole("table", { name: t.list.certificate_type });
    await waitFor(() => expect(table.closest(".opacity-60")).toBeTruthy());
    expect(screen.getByText("Сертификат ISO 9001")).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);

    held.wait.resolve();
    expect(await screen.findByText("Прежний сертификат")).toBeTruthy();
    expect(screen.queryByText("Сертификат ISO 9001")).toBeNull();
  });

  it("между выбором справочника и записью адреса заголовок, колонки и строки принадлежат одному справочнику", async () => {
    stubBackend();
    const { user } = renderRoute("/references?list=certificate_type", { locale: "ru" });
    const t = ru.references;

    await screen.findByText("Сертификат ISO 9001");
    // Каждое изменение страницы видно наблюдателю: ни в одном состоянии нет строк сертификатов под колонками
    // типов товаров и наоборот (колонки и заголовок брались из состояния nuqs, а данные — из адреса).
    const seen: string[] = [];
    const observer = new MutationObserver(() => {
      const rows = [...document.querySelectorAll("tbody tr")].map((row) => row.getAttribute("data-entry"));
      const heads = [...document.querySelectorAll("th")].map((head) => head.textContent);
      const title = document.querySelector('[role="heading"][aria-level="2"]')?.textContent;
      if (rows.includes(ST_KZ) && (heads.includes(t.group) || title === t.list.commodity_type))
        seen.push(`${title}: ${heads.join("|")} / ${rows.join(",")}`);
      if (rows.includes("PUMP") && (heads.includes(t.mandatory) || title === t.list.certificate_type))
        seen.push(`${title}: ${heads.join("|")} / ${rows.join(",")}`);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    await choose(user, t.listLabel, t.list.commodity_type);
    await screen.findByText("Насосы");
    observer.disconnect();
    expect(seen).toEqual([]);
  });
});

describe("образец оргструктуры: итог проверки в строке состояния (ADM-11, DATA-07)", () => {
  const sampleCard = () =>
    within(
      screen.getByRole("heading", { name: ru.references.sample.title }).closest<HTMLElement>('[data-slot="card"]')!,
    );
  /** Строка итога страницы: aria-live над карточками. */
  const statusLine = () => document.querySelector<HTMLElement>("[aria-live='polite'][aria-atomic='true']")!;

  it("проверка закончилась успешно: «Образец прошёл проверку и стал текущим», тон успеха; прежнее «проверяется» заменено", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sample: Backend["sample"] = {
      current: sampleFile("passed", "Прежний образец.pdf") as never,
      latest: null,
    };
    stubBackend({ sample });
    const { user } = renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    await screen.findByRole("link", { name: t.download });
    // Загрузка: итог «загружен и проверяется», сервер отвечает 202; затем проверка идёт.
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(["%PDF-1.4"], "Новый образец.pdf", { type: "application/pdf" }),
    );
    expect(await within(statusLine()).findByText(t.uploaded)).toBeTruthy();
    expect(await sampleCard().findByText(t.pending)).toBeTruthy();

    // Проверка прошла: новая загрузка стала текущей, последней загрузки нет.
    sample.current = sampleFile("passed", "Новый образец.pdf") as never;
    sample.latest = null;
    await vi.advanceTimersByTimeAsync(5_500);
    const done = await within(statusLine()).findByText(t.checkPassed);
    expect(within(statusLine()).queryByText(t.uploaded)).toBeNull();
    // Тон успеха: не красный.
    expect(done.closest('[data-slot="alert"]')!.className).not.toContain("text-destructive");
    expect(await sampleCard().findByText("Новый образец.pdf")).toBeTruthy();
    expect(sampleCard().queryByText(t.pending)).toBeNull();
  });

  it("первый образец прошёл проверку (текущего не было): тоже «стал текущим»", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sample: Backend["sample"] = { current: null, latest: sampleFile("pending", "Первый.pdf") as never };
    stubBackend({ sample });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    expect(await screen.findByText(t.pendingFirstHint)).toBeTruthy();
    expect(within(statusLine()).queryByText(t.checkPassed)).toBeNull();
    sample.current = sampleFile("passed", "Первый.pdf") as never;
    sample.latest = null;
    await vi.advanceTimersByTimeAsync(5_500);
    expect(await within(statusLine()).findByText(t.checkPassed)).toBeTruthy();
  });

  it("проверка не пройдена: «Файл не прошёл проверку. Текущий образец не изменился», тон ошибки", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sample: Backend["sample"] = {
      current: sampleFile("passed", "Прежний образец.pdf") as never,
      latest: sampleFile("pending", "Вирус.pdf") as never,
    };
    stubBackend({ sample });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    expect(await screen.findByText(t.pending)).toBeTruthy();
    // Пока проверка идёт, в строке итога ничего нет.
    expect(statusLine().textContent).toBe("");
    sample.latest = sampleFile("rejected", "Вирус.pdf") as never;
    await vi.advanceTimersByTimeAsync(5_500);

    const failed = await within(statusLine()).findByText(`${t.checkRejected} ${t.keptCurrent}`);
    expect(failed.closest('[data-slot="alert"]')!.className).toContain("text-destructive");
    expect(await sampleCard().findByText(t.rejected)).toBeTruthy();
    // Текущий образец прежний.
    expect(sampleCard().getByText("Прежний образец.pdf")).toBeTruthy();
  });

  it("не пройдена проверка первого образца: без слов о неизменившемся текущем", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const sample: Backend["sample"] = { current: null, latest: sampleFile("pending", "Вирус.pdf") as never };
    stubBackend({ sample });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    await screen.findByText(t.pending);
    sample.latest = sampleFile("rejected", "Вирус.pdf") as never;
    await vi.advanceTimersByTimeAsync(5_500);
    expect(await within(statusLine()).findByText(t.checkRejected)).toBeTruthy();
    expect(within(statusLine()).queryByText(t.keptCurrent, { exact: false })).toBeNull();
  });

  it("страница открыта на уже закончившейся проверке: итога нет, объявляется только смена, увиденная опросом", async () => {
    stubBackend({
      sample: {
        current: sampleFile("passed", "Прежний образец.pdf") as never,
        latest: sampleFile("rejected", "Вирус.pdf") as never,
      },
    });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    expect(await screen.findByText(t.rejected)).toBeTruthy();
    expect(statusLine().textContent).toBe("");
  });

  it("новая проверка — «Обычно это занимает до минуты» под отметкой, для первого образца тоже", async () => {
    stubBackend({ sample: { current: null, latest: sampleFile("pending", "Первый.pdf") as never } });
    renderRoute("/references", { locale: "ru" });
    const t = ru.references.sample;

    await screen.findByText(t.pendingFirstHint);
    const hint = sampleCard().getByText(t.pendingDuration);
    const badge = sampleCard().getByText(t.pending);
    // Пояснение — после отметки «Проверяется антивирусом».
    expect(badge.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ru.references.sample.pendingDuration).toContain("до минуты");
    expect(ru.references.sample.pendingDuration).toContain("Страницу можно закрыть");
  });

  it("не принят: администратору — «Загрузите другой», директору (загрузки нет) — «Текущий образец не изменился»", async () => {
    const t = ru.references.sample;
    const sample = {
      current: sampleFile("passed", "Прежний образец.pdf") as never,
      latest: sampleFile("rejected", "Вирус.pdf") as never,
    };

    stubBackend({ sample });
    renderRoute("/references", { locale: "ru" });
    expect(await screen.findByText(t.rejectedHint)).toBeTruthy();
    expect(screen.getByText(t.keptCurrent)).toBeTruthy();
    cleanup();

    stubBackend({ me: DIRECTOR, sample });
    renderRoute("/references", { locale: "ru" });
    expect(await screen.findByText(`${t.rejectedPlain} ${t.keptCurrent}`)).toBeTruthy();
    expect(screen.queryByText(t.rejectedHint)).toBeNull();
    expect(screen.queryByText(/Загрузите другой/)).toBeNull();
    cleanup();

    // Директор, текущего образца нет: нечему «не изменяться» — только «Файл не принят.».
    stubBackend({ me: DIRECTOR, sample: { current: null, latest: sample.latest } });
    renderRoute("/references", { locale: "ru" });
    expect(await screen.findByText(t.rejectedPlain)).toBeTruthy();
    expect(screen.queryByText(t.keptCurrent)).toBeNull();
    expect(screen.queryByText(/Загрузите другой/)).toBeNull();
  });
});

describe("справочники: доступность списка и страниц (ADM-08)", () => {
  it("скелет загрузки читается программой чтения с экрана: «Загрузка…»", async () => {
    const wait = deferred<Response>();
    stubBackend({ overrides: [["GET", /\/dictionaries\/region\/entries$/, () => wait.promise]] });
    renderRoute("/references?list=region", { locale: "ru" });

    const panel = await screen.findByRole("tabpanel");
    await waitFor(() => expect(panel.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(8));
    const busy = panel.querySelector<HTMLElement>('[aria-busy="true"]')!;
    const text = within(busy).getByText(ru.common.loading);
    expect(text.className).toContain("sr-only");
    wait.resolve(
      Response.json({
        dictionary: summaryOf("region", []),
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
      }),
    );
    await waitFor(() => expect(within(screen.getByRole("tabpanel")).queryByText(ru.common.loading)).toBeNull());
  });

  it("«Показано …–… из …» — в области aria-live=polite: смена страницы объявляется", async () => {
    stubBackend();
    renderRoute("/references?list=tn_ved", { locale: "ru" });
    const t = ru.references;

    const shown = await screen.findByText(fill(t.shown, { from: "1", to: "50", total: "120" }));
    expect(shown.closest("[aria-live]")!.getAttribute("aria-live")).toBe("polite");
  });

  it("«Далее» на последней странице не теряет фокус: aria-disabled вместо disabled, нажатие ничего не меняет", async () => {
    stubBackend();
    const { router, user } = renderRoute("/references?list=tn_ved&page=2", { locale: "ru" });
    const t = ru.references;

    await screen.findByText(fill(t.shown, { from: "51", to: "100", total: "120" }));
    const next = screen.getByRole("button", { name: t.next });
    next.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&page=3"));
    await screen.findByText(fill(t.shown, { from: "101", to: "120", total: "120" }));

    // Последняя страница: кнопка недоступна для действия, но остаётся в фокусе (не disabled).
    const last = screen.getByRole("button", { name: t.next });
    expect(last.getAttribute("aria-disabled")).toBe("true");
    expect((last as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(last);
    await user.keyboard("{Enter}");
    await user.click(last);
    expect(router.state.location.search).toBe("?list=tn_ved&page=3");
    expect(screen.getByText(fill(t.shown, { from: "101", to: "120", total: "120" }))).toBeTruthy();
    expect(document.activeElement).toBe(last);
    // «Назад» на последней странице доступна, на первой — недоступна так же.
    expect(screen.getByRole("button", { name: t.previous }).getAttribute("aria-disabled")).not.toBe("true");
    await user.click(screen.getByRole("button", { name: t.previous }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved&page=2"));
    await user.click(screen.getByRole("button", { name: t.previous }));
    await waitFor(() => expect(router.state.location.search).toBe("?list=tn_ved"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: t.previous }).getAttribute("aria-disabled")).toBe("true"),
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t.previous }));
  });
});

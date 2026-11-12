// Общее состояние прототипа на сервере стенда: режим, запись с версией, повтор после 409, опрос, сброс.
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialState, type ProtoState, SCHEMA_VERSION } from "@/prototype/data";
import { getSyncStatus, POLL_MS, PROTOTYPE_STATE_URL, resetSyncForTests } from "@/prototype/remote";
import {
  actorFor,
  commit,
  getProtoState,
  resetProto,
  setProtoState,
  startProtoSync,
  STORAGE_KEY,
} from "@/prototype/store";

import { stubApi } from "../support/api";
import { apiV1Calls, renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
vi.mock("@/prototype/operator", () => import("./example-cabinet"));

const actor = actorFor(createInitialState(), { email: "operator@operator.local", fullName: null, role: "operator" });
const audit = {
  action: "operator_note.update",
  subject: { type: "operator_note" as const, id: "n-1", label: "ТОО «Демо Металл Конструкция»" },
  summary: { en: "Changed", ru: "Изменено", kk: "Өзгертілді" },
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": status >= 400 ? "application/problem+json" : "application/json" },
  });

interface Deferred {
  promise: Promise<void>;
  release: () => void;
}
function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/**
 * Сервер стенда в памяти с той же семантикой версии, что у таблицы `prototype_state`. `down` —
 * сервер не отвечает (`"network"`) или отвечает 500; `holdGet`/`holdPut` задерживают ответ.
 */
function fakeServer(start: { version: number; state: unknown }) {
  const server = {
    ...start,
    puts: [] as { baseVersion: number; state: ProtoState }[],
    gets: 0,
    down: null as null | "network" | 500,
    holdGet: null as Deferred | null,
    holdPut: null as Deferred | null,
    beforePut: null as null | (() => void),
  };
  const handlers = {
    [`GET ${PROTOTYPE_STATE_URL}`]: (async () => {
      if (server.down === "network") throw new TypeError("Failed to fetch");
      if (server.down) return reply(500, { status: 500, code: "internal" });
      server.gets += 1;
      const snapshot = { version: server.version, state: structuredClone(server.state) };
      await server.holdGet?.promise;
      return reply(200, snapshot);
    }) as never,
    [`PUT ${PROTOTYPE_STATE_URL}`]: (async (_url: URL, init?: RequestInit) => {
      if (server.down === "network") throw new TypeError("Failed to fetch");
      if (server.down) return reply(500, { status: 500, code: "internal" });
      await server.holdPut?.promise;
      server.beforePut?.();
      const body = JSON.parse(String(init?.body)) as { baseVersion: number; state: ProtoState };
      server.puts.push(body);
      if (body.baseVersion !== server.version) {
        return reply(409, { status: 409, code: "version_conflict", version: server.version, state: server.state });
      }
      server.version += 1;
      server.state = body.state;
      return reply(200, { version: server.version });
    }) as never,
  };
  stubApi(handlers);
  return Object.assign(server, { handlers });
}

/** Дать ответам заглушки и цепочкам промисов дойти до конца (таймеры подменены, setImmediate — нет). */
async function settle() {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function tick(ms = POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  });
}

function withStatus(status: ProtoState["profiles"][number]["status"], index = 0): ProtoState {
  const state = createInitialState();
  state.profiles[index]!.status = status;
  return state;
}

async function open(server: { version: number; state: unknown }) {
  const fake = fakeServer(server);
  startProtoSync();
  await settle();
  return fake;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  setProtoState(createInitialState());
  resetSyncForTests();
});

afterEach(() => {
  cleanup();
  resetSyncForTests();
  vi.useRealTimers();
});

describe("режим хранилища", () => {
  it("GET ответил 404 — локальный режим: после первой проверки запросов нет", async () => {
    const api = stubApi({});
    startProtoSync();
    await settle();
    expect(getSyncStatus().mode).toBe("local");

    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    startProtoSync();
    await tick(POLL_MS * 10);
    expect(api.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${String(url)}`)).toEqual([
      `GET ${PROTOTYPE_STATE_URL}`,
    ]);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).profiles[0].status).toBe("draft");
  });

  it("проверка режима не считается запросом экрана к /api/v1", () => {
    const api = stubApi({});
    void fetch(PROTOTYPE_STATE_URL, { cache: "no-store" });
    void fetch("/api/v1/catalog/search");
    expect(apiV1Calls(api)).toEqual(["/api/v1/catalog/search"]);
  });
});

describe("общий режим", () => {
  it("загрузка: состояние сервера заменяет локальную копию, без записи", async () => {
    const server = await open({ version: 4, state: withStatus("returned") });
    expect(getSyncStatus().mode).toBe("shared");
    expect(getProtoState().profiles[0]!.status).toBe("returned");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).profiles[0].status).toBe("returned");
    await tick(POLL_MS * 3);
    expect(server.puts).toEqual([]);
  });

  it("пустой сервер — записываются исходные данные с версией 0, один раз", async () => {
    setProtoState(withStatus("draft"));
    resetSyncForTests();
    const server = await open({ version: 0, state: null });
    expect(server.puts).toEqual([{ baseVersion: 0, state: createInitialState() }]);
    expect(getProtoState()).toEqual(createInitialState());
    expect(server.version).toBe(1);
    await tick(POLL_MS * 3);
    expect(server.puts).toHaveLength(1);
  });

  it("пустой сервер засеяла и уже правит другая вкладка: её документ принимается, без перезаписи", async () => {
    const server = fakeServer({ version: 0, state: null });
    server.beforePut = () => {
      server.beforePut = null;
      server.state = withStatus("returned");
      server.version = 2;
    };
    startProtoSync();
    await settle();
    expect(server.puts.map((p) => p.baseVersion)).toEqual([0]);
    expect(getProtoState().profiles[0]!.status).toBe("returned");
    await tick(POLL_MS * 2);
    expect(server.puts).toHaveLength(1);
  });

  it("правка применяется сразу и уходит на сервер с версией", async () => {
    const server = await open({ version: 3, state: createInitialState() });
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    expect(getProtoState().profiles[0]!.status).toBe("draft");
    await settle();
    expect(server.puts.map((p) => p.baseVersion)).toEqual([3]);
    expect(server.version).toBe(4);
    expect(server.state).toEqual(getProtoState());
    expect(getProtoState().audit.at(-1)).toMatchObject({ action: "operator_note.update", actor: { role: "operator" } });
  });

  it("409: рецепт применяется к состоянию сервера заново, запись повторяется", async () => {
    const server = await open({ version: 1, state: createInitialState() });
    // Другой пользователь успел записать свою правку.
    server.state = withStatus("returned", 1);
    server.version = 2;

    const recipe = vi.fn((draft: ProtoState) => {
      draft.profiles[0]!.status = "draft";
    });
    commit(actor, audit, recipe);
    await settle();

    expect(server.puts.map((p) => p.baseVersion)).toEqual([1, 2]);
    expect(recipe).toHaveBeenCalledTimes(2);
    const state = getProtoState();
    expect(state.profiles[0]!.status).toBe("draft");
    expect(state.profiles[1]!.status).toBe("returned");
    expect(server.state).toEqual(state);
    expect(state.audit).toHaveLength(createInitialState().audit.length + 1);
    expect(getSyncStatus().notice).toBeNull();
  });

  it("правка, которую нельзя применить к новому состоянию сервера, отбрасывается с сообщением", async () => {
    const server = await open({ version: 1, state: createInitialState() });
    const noteId = createInitialState().operatorNotes[0]!.id;
    const removed = createInitialState();
    removed.operatorNotes = removed.operatorNotes.filter((n) => n.id !== noteId);
    server.state = removed;
    server.version = 2;

    commit(actor, audit, (draft) => {
      draft.operatorNotes.find((n) => n.id === noteId)!.text = "Правка";
    });
    expect(getProtoState().operatorNotes.find((n) => n.id === noteId)!.text).toBe("Правка");
    await settle();

    expect(server.puts).toHaveLength(1);
    expect(getProtoState()).toEqual(removed);
    expect(getSyncStatus().notice).toBe("dropped");
  });

  it("после трёх повторов — сообщение и состояние сервера", async () => {
    const server = await open({ version: 1, state: createInitialState() });
    let n = 0;
    server.beforePut = () => {
      n += 1;
      server.state = withStatus(n % 2 ? "returned" : "submitted", 2);
      server.version += 1;
    };
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    await settle();

    expect(server.puts).toHaveLength(4);
    expect(getSyncStatus().notice).toBe("conflict");
    expect(getProtoState()).toEqual(server.state);
    expect(getProtoState().profiles[0]!.status).toBe("verified");
    await tick(POLL_MS * 2);
    expect(server.puts).toHaveLength(4);
  });

  it("опрос приносит чужую правку и не пишет её обратно", async () => {
    const server = await open({ version: 1, state: createInitialState() });
    server.state = withStatus("returned");
    server.version = 2;
    await tick(POLL_MS - 1);
    expect(getProtoState().profiles[0]!.status).toBe("verified");
    await tick(1);
    expect(getProtoState().profiles[0]!.status).toBe("returned");
    await tick(POLL_MS * 3);
    expect(server.puts).toEqual([]);
  });

  it("возврат на вкладку — опрос сразу", async () => {
    const server = await open({ version: 1, state: createInitialState() });
    server.state = withStatus("returned");
    server.version = 2;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
    });
    expect(getProtoState().profiles[0]!.status).toBe("returned");
    visibility.mockRestore();
  });

  it("опрос не идёт во время записи и не отбрасывает неподтверждённую правку", async () => {
    const server = await open({ version: 1, state: createInitialState() });
    const gets = server.gets;

    // Запись в пути: опросов нет.
    server.holdPut = deferred();
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    await tick(POLL_MS * 3);
    expect(server.gets).toBe(gets);
    server.holdPut.release();
    server.holdPut = null;
    await settle();
    expect(server.version).toBe(2);

    // Опрос в пути, пока пользователь правит: старый ответ не затирает правку.
    server.holdGet = deferred();
    await tick();
    expect(server.gets).toBe(gets + 1);
    commit(actor, audit, (draft) => {
      draft.profiles[1]!.status = "draft";
    });
    await settle();
    expect(server.version).toBe(3);
    server.holdGet.release();
    server.holdGet = null;
    await settle();
    expect(getProtoState().profiles[0]!.status).toBe("draft");
    expect(getProtoState().profiles[1]!.status).toBe("draft");
    expect(server.state).toEqual(getProtoState());
  });

  it("«Сбросить демо-данные» записывает исходные данные для всех", async () => {
    const server = await open({ version: 5, state: withStatus("returned") });
    resetProto();
    expect(getProtoState()).toEqual(createInitialState());
    await settle();
    expect(server.puts).toEqual([{ baseVersion: 5, state: createInitialState() }]);
    expect(server.state).toEqual(createInitialState());
  });

  it.each([
    ["сеть", "network" as const],
    ["500", 500 as const],
  ])("сервер не отвечает (%s): «не сохранено, повтор», локальная копия цела, затем запись", async (_, down) => {
    const server = await open({ version: 1, state: createInitialState() });
    server.down = down;
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    await settle();
    expect(getSyncStatus().offline).toBe(true);
    expect(getProtoState().profiles[0]!.status).toBe("draft");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).profiles[0].status).toBe("draft");

    await tick();
    expect(getSyncStatus().offline).toBe(true);
    server.down = null;
    await tick();
    expect(getSyncStatus().offline).toBe(false);
    expect(server.puts.map((p) => p.baseVersion)).toEqual([1]);
    expect(server.state).toEqual(getProtoState());
  });

  it.each([
    ["старая версия схемы", { ...createInitialState(), version: SCHEMA_VERSION - 1 }],
    ["повреждённый документ", { ...createInitialState(), profiles: { p01: {} } }],
  ])("%s на сервере заменяется исходными данными этой сборки", async (_, doc) => {
    setProtoState(withStatus("draft"));
    resetSyncForTests();
    const server = await open({ version: 7, state: doc });
    expect(server.puts).toEqual([{ baseVersion: 7, state: createInitialState() }]);
    expect(getProtoState()).toEqual(createInitialState());
  });

  it("документ более новой схемы не перезаписывается: сообщение, правки не уходят", async () => {
    const newer = { ...createInitialState(), version: SCHEMA_VERSION + 1 };
    const server = await open({ version: 7, state: newer });
    expect(getSyncStatus().outdated).toBe(true);
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    await tick(POLL_MS * 2);
    expect(server.puts).toEqual([]);
    expect(server.state).toEqual(newer);
  });

  it("правка до ответа о режиме уходит на сервер поверх его состояния", async () => {
    const server = fakeServer({ version: 2, state: withStatus("returned", 1) });
    server.holdGet = deferred();
    startProtoSync();
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    server.holdGet.release();
    server.holdGet = null;
    await settle();
    expect(server.puts.map((p) => p.baseVersion)).toEqual([2]);
    expect(getProtoState().profiles[0]!.status).toBe("draft");
    expect(getProtoState().profiles[1]!.status).toBe("returned");
  });

  it("событие storage другой вкладки в общем режиме не меняет состояние", async () => {
    await open({ version: 1, state: createInitialState() });
    const other = JSON.stringify(withStatus("returned"));
    window.localStorage.setItem(STORAGE_KEY, other);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: other }));
    });
    expect(getProtoState().profiles[0]!.status).toBe("verified");
  });
});

describe("кабинет в общем режиме", () => {
  it("страница говорит, что данные общие; сервер недоступен — видимое «не сохранено», экран цел", async () => {
    // userEvent ждёт настоящих таймеров; повтор записи — по возврату на вкладку.
    vi.useRealTimers();
    const server = fakeServer({ version: 1, state: createInitialState() });
    const { user } = renderCabinet("/proto/operator/notes", {
      role: "operator",
      keepState: true,
      api: server.handlers,
    });
    expect(await screen.findByText("Fictional data. Changes are shared by all users of the stand.")).toBeTruthy();

    server.down = "network";
    await user.type(await screen.findByRole("textbox", { name: "Add note" }), "Новая заметка");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    await act(settle);
    expect(screen.getByText(/Новая заметка/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Not saved");
    expect(screen.queryByText("This prototype screen failed")).toBeNull();

    server.down = null;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await settle();
    });
    visibility.mockRestore();
    expect(screen.queryByText(/Not saved/)).toBeNull();
    expect(JSON.stringify(server.state)).toContain("Новая заметка");
  });

  it("кабинет директора в общем режиме: открытие и просмотр ничего не пишут на сервер (GEN-04)", async () => {
    vi.useRealTimers();
    const server = fakeServer({ version: 3, state: withStatus("returned") });
    const { router } = renderCabinet("/proto/director/profiles", {
      role: "director",
      keepState: true,
      api: server.handlers,
    });
    expect(await screen.findByText("Fictional data. Changes are shared by all users of the stand.")).toBeTruthy();
    for (const path of ["audit", "operators", "requests", "profiles/p01"]) {
      await act(() => router.navigate(`/proto/director/${path}`));
      expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    }
    await act(settle);
    expect(server.gets).toBeGreaterThanOrEqual(1);
    expect(server.puts).toEqual([]);
    expect(server.version).toBe(3);
  });
});

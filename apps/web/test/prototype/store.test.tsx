// Хранилище прототипа: одно состояние в localStorage, общее для ролей браузера (GEN-08, NFR-15).
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createInitialState, SCHEMA_VERSION } from "@/prototype/data";
import {
  actorFor,
  commit,
  extOf,
  getProtoState,
  resetProto,
  setProtoState,
  STORAGE_KEY,
  useExt,
  useProto,
} from "@/prototype/store";

import "./support";

const actor = actorFor(createInitialState(), { email: "operator@operator.local", fullName: null, role: "operator" });
const audit = {
  action: "operator_note.create",
  subject: { type: "operator_note" as const, id: "n-1", label: "ТОО «Демо Металл Конструкция»" },
  summary: { en: "Added a note", ru: "Добавлена заметка", kk: "Жазба қосылды" },
};

/** Модуль хранилища заново: первое чтение берёт то, что лежит в localStorage. */
async function freshStore() {
  vi.resetModules();
  return import("@/prototype/store");
}

/** Событие `storage`: так браузер сообщает вкладке о записи из другой вкладки. */
function storageEvent(key: string | null, newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  });
}

describe("хранилище прототипа", () => {
  it("без сохранённого состояния — исходные данные", async () => {
    const store = await freshStore();
    expect(store.getProtoState()).toEqual(createInitialState());
  });

  it.each([
    ["неверный JSON", "{not json"],
    ["чужой объект", JSON.stringify({ theme: "dark" })],
    ["массив", JSON.stringify([1, 2, 3])],
    ["старая версия схемы", JSON.stringify({ ...createInitialState(), version: SCHEMA_VERSION - 1 })],
    ["набор не той формы", JSON.stringify({ ...createInitialState(), profiles: { p01: {} } })],
    ["нет набора", JSON.stringify({ ...createInitialState(), audit: undefined })],
  ])("%s в localStorage — исходные данные без ошибки", async (_, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    const store = await freshStore();
    expect(store.getProtoState()).toEqual(createInitialState());
  });

  it("сохранённое состояние этой схемы читается", async () => {
    const saved = createInitialState();
    saved.profiles[0]!.status = "returned";
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const store = await freshStore();
    expect(store.getProtoState().profiles[0]!.status).toBe("returned");
  });

  it("правка пишет событие журнала от действующего и сохраняется в localStorage (AUD-01)", () => {
    setProtoState(createInitialState());
    const before = getProtoState().audit.length;
    commit(actor, audit, (draft) => {
      draft.operatorNotes.push({
        id: "n-1",
        operatorOrgId: actor.organizationId,
        authorId: actor.accountId!,
        profileId: "p01",
        text: "Новая заметка",
        createdAt: "2026-11-12T10:00:00Z",
      });
    });
    const state = getProtoState();
    expect(state.audit).toHaveLength(before + 1);
    expect(state.audit.at(-1)).toMatchObject({
      action: "operator_note.create",
      actor: { accountId: "acc-operator", role: "operator", organizationId: "org-operator-demo" },
      subject: { type: "operator_note", id: "n-1" },
    });
    expect(Number.isNaN(Date.parse(state.audit.at(-1)!.at))).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual(state);
  });

  it("правка не меняет исходные константы данных", () => {
    setProtoState(createInitialState());
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.nameRu = "Изменено";
    });
    expect(createInitialState().profiles[0]!.nameRu).toBe("ТОО «Демо Металл Конструкция»");
  });

  it("сброс возвращает исходные данные и записывает их", () => {
    commit(actor, audit, (draft) => {
      draft.profiles[0]!.status = "draft";
    });
    resetProto();
    expect(getProtoState()).toEqual(createInitialState());
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual(createInitialState());
  });

  it("событие storage из другой вкладки обновляет открытые экраны", () => {
    setProtoState(createInitialState());
    function Status() {
      return <p>{useProto((s) => s.profiles[0]!.status)}</p>;
    }
    render(<Status />);
    expect(screen.getByText("verified")).toBeTruthy();

    const other = createInitialState();
    other.profiles[0]!.status = "returned";
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
    storageEvent(STORAGE_KEY, JSON.stringify(other));
    expect(screen.getByText("returned")).toBeTruthy();

    // Чужой ключ не трогает состояние; очистка хранилища (key: null) — исходные данные.
    storageEvent("other-key", "x");
    expect(screen.getByText("returned")).toBeTruthy();
    window.localStorage.clear();
    storageEvent(null, null);
    expect(screen.getByText("verified")).toBeTruthy();
  });

  it("свои данные модуля — в ext[role]", () => {
    setProtoState(createInitialState());
    function Counter() {
      return <p>{useExt("operator", { count: 0 }).count}</p>;
    }
    render(<Counter />);
    expect(screen.getByText("0")).toBeTruthy();
    act(() => {
      commit(actor, audit, (draft) => {
        extOf(draft, "operator", () => ({ count: 0 })).count += 2;
      });
    });
    expect(screen.getByText("2")).toBeTruthy();
    expect(getProtoState().ext.expert).toBeUndefined();
  });

  it("сеанс вне демо-аккаунтов — демо-персона роли; почта и имя сеанса не сохраняются (NFR-11)", () => {
    setProtoState(createInitialState());
    const session = { email: "real.person@company.example", fullName: "Реальный Человек", role: "operator" as const };
    const persona = actorFor(getProtoState(), session);
    expect(persona).toEqual({
      accountId: "acc-operator",
      email: "operator@operator.local",
      name: "Специалист оператора",
      role: "operator",
      organizationId: "org-operator-demo",
    });
    commit(persona, audit, (draft) => {
      draft.operatorNotes[0]!.text = "Правка";
    });
    const stored = window.localStorage.getItem(STORAGE_KEY)!;
    expect(stored).toContain("Правка");
    for (const leak of ["real.person", "company.example", "Реальный Человек"]) {
      expect(stored).not.toContain(leak);
      expect(JSON.stringify(getProtoState())).not.toContain(leak);
    }
  });

  it.each([
    ["manufacturer", "acc-manufacturer", "org-m01"],
    ["expert", "acc-expert", "org-imbc"],
    ["administrator", "acc-admin", "org-imbc"],
    ["director", "acc-director", "org-imbc"],
    ["operator", "acc-operator", "org-operator-demo"],
    ["observer", "acc-observer", "org-observer-demo"],
  ] as const)("персона роли %s — демо-аккаунт seed", (role, accountId, organizationId) => {
    const actor = actorFor(createInitialState(), { email: "someone@else.example", fullName: "X", role });
    expect(actor).toMatchObject({ accountId, role, organizationId });
    expect(actor.email).not.toContain("else.example");
    expect(actor.name).not.toBe("X");
  });

  it("сеанс демо-аккаунта — этот аккаунт; адрес той же роли без учёта регистра", () => {
    const state = createInitialState();
    expect(
      actorFor(state, { email: "Arman.Bekov@operator.demo.local", fullName: "Чужое имя", role: "operator" }),
    ).toEqual({
      accountId: "acc-operator-2",
      email: "arman.bekov@operator.demo.local",
      name: "Арман Беков",
      role: "operator",
      organizationId: "org-operator-demo",
    });
    // Пробелы по краям адреса сеанса не мешают найти демо-аккаунт.
    expect(
      actorFor(state, { email: "  arman.bekov@operator.demo.local\t", fullName: null, role: "operator" }).accountId,
    ).toBe("acc-operator-2");
    // Адрес демо-аккаунта другой роли — персона своей роли.
    expect(actorFor(state, { email: "expert@imbc.local", fullName: null, role: "director" }).accountId).toBe(
      "acc-director",
    );
  });

  it.each([
    ["JSON null", "null"],
    ["число", "42"],
    ["элемент набора — null", JSON.stringify({ ...createInitialState(), profiles: [null] })],
    ["элемент набора без id", JSON.stringify({ ...createInitialState(), profiles: [{ nameRu: "X" }] })],
    ["id не строка", JSON.stringify({ ...createInitialState(), accounts: [{ id: 1 }] })],
    ["запись due diligence без profileId", JSON.stringify({ ...createInitialState(), dueDiligence: [{}] })],
  ])("%s в localStorage — исходные данные", async (_, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    const store = await freshStore();
    expect(store.getProtoState()).toEqual(createInitialState());
  });

  it("localStorage бросает при чтении — исходные данные; при записи — правка живёт в памяти", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const store = await freshStore();
    expect(store.getProtoState()).toEqual(createInitialState());
    getItem.mockRestore();

    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      store.commit(actor, audit, (draft) => {
        draft.profiles[0]!.status = "draft";
      }),
    ).not.toThrow();
    expect(store.getProtoState().profiles[0]!.status).toBe("draft");
    setItem.mockRestore();
  });
});

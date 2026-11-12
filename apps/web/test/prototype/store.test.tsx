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

  it("сеанс вне демо-аккаунтов — организация по роли", () => {
    const state = createInitialState();
    expect(actorFor(state, { email: "other@operator.local", fullName: "Другой", role: "operator" })).toEqual({
      accountId: null,
      email: "other@operator.local",
      name: "Другой",
      role: "operator",
      organizationId: "org-operator-demo",
    });
    expect(actorFor(state, { email: "EXPERT@imbc.local", fullName: null, role: "expert" }).accountId).toBe(
      "acc-expert",
    );
  });
});

import type { Role } from "@imbc/contracts";
import { useSyncExternalStore } from "react";

import { useMe } from "@/lib/session";

import { type AuditEvent, createInitialState, type ProtoState, SCHEMA_VERSION } from "./data";
import { ACCOUNT, accounts as seedAccounts } from "./data/accounts";
import { DEMO_PROFILE_ID } from "./data/profiles";

/**
 * Хранилище прототипа: одно состояние на браузер в `localStorage`, общее для всех ролей. Ведущий
 * выходит и входит другой ролью — следующая роль видит, что сделала предыдущая. Сервера нет.
 */
export const STORAGE_KEY = "imbc-prototype-v1";

export type { ProtoState };

let state: ProtoState | undefined;
const listeners = new Set<() => void>();

/**
 * Сохранённое состояние, если оно этой схемы: объект с той же версией, где каждый набор того же
 * вида (массив или объект). Повреждённое, чужое или старое содержимое — исходные данные, без ошибки.
 */
function load(): ProtoState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isState(parsed)) return parsed;
    }
  } catch {
    // Нет доступа к localStorage или неверный JSON — исходные данные.
  }
  return createInitialState();
}

function isState(value: unknown): value is ProtoState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== SCHEMA_VERSION) return false;
  const initial = createInitialState() as unknown as Record<string, unknown>;
  return Object.entries(initial).every(([key, sample]) => {
    const stored = record[key];
    if (Array.isArray(sample)) return Array.isArray(stored) && stored.every((item) => isRecordLike(item, sample[0]));
    if (typeof sample === "object" && sample !== null) {
      return typeof stored === "object" && stored !== null && !Array.isArray(stored);
    }
    return typeof stored === typeof sample;
  });
}

/**
 * Элемент набора — объект со строковым ключом, как в образце: `id`, а у записей due diligence,
 * где `id` нет, — `profileId`.
 */
function isRecordLike(item: unknown, sample: unknown): boolean {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return false;
  if (typeof sample !== "object" || sample === null) return true;
  const key = "id" in sample ? "id" : "profileId" in sample ? "profileId" : null;
  return key === null || typeof (item as Record<string, unknown>)[key] === "string";
}

function save(next: ProtoState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Переполнено или запрещено: состояние живёт до перезагрузки вкладки.
  }
}

function emit() {
  for (const listener of listeners) listener();
}

/** Текущее состояние (вне React). Внутри компонентов — `useProto`. */
export function getProtoState(): ProtoState {
  state ??= load();
  return state;
}

/** Заменяет состояние целиком. Для тестов и сброса; экраны меняют данные через `useProtoUpdate`. */
export function setProtoState(next: ProtoState): void {
  state = next;
  save(next);
  emit();
}

/** «Сбросить демо-данные»: исходные данные во всех ролях этого браузера. В журнал не пишется. */
export function resetProto(): void {
  setProtoState(createInitialState());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Другая вкладка того же браузера записала состояние: открытые вкладки перечитывают его.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    state = load();
    emit();
  });
}

/**
 * Данные из хранилища: `useProto((s) => s.profiles)`. Компонент перерисовывается при любой правке
 * состояния, поэтому селектор может возвращать новый массив (`filter`, `map`).
 */
export function useProto(): ProtoState;
export function useProto<T>(selector: (state: ProtoState) => T): T;
export function useProto<T>(selector?: (state: ProtoState) => T): T | ProtoState {
  const current = useSyncExternalStore(subscribe, getProtoState, getProtoState);
  return selector ? selector(current) : current;
}

/**
 * Кто действует — всегда демо-аккаунт: аккаунт демо-данных с адресом сеанса и той же ролью, иначе
 * демо-персона роли (аккаунт seed). Из сеанса берётся только роль: адрес и имя настоящего
 * пользователя стенда не попадают ни в действующего, ни в журнал, ни в localStorage (NFR-11).
 */
export type ProtoActor = AuditEvent["actor"] & { organizationId: string };

/** Демо-персона роли: аккаунт seed (`data/accounts.ts`). */
const PERSONA_BY_ROLE: Record<Role, string> = {
  manufacturer: ACCOUNT.manufacturer,
  expert: ACCOUNT.expert,
  administrator: ACCOUNT.administrator,
  director: ACCOUNT.director,
  operator: ACCOUNT.operator,
  observer: ACCOUNT.observer,
};

/**
 * Действующий для сеанса. `user.email` и `user.fullName` только сравниваются с демо-аккаунтами и
 * никуда не возвращаются; `accountId` — всегда ключ существующего демо-аккаунта.
 */
export function actorFor(state: ProtoState, user: { email: string; fullName: string | null; role: Role }): ProtoActor {
  const email = user.email.toLowerCase();
  const persona = PERSONA_BY_ROLE[user.role];
  const account =
    state.accounts.find((a) => a.role === user.role && a.email.toLowerCase() === email) ??
    state.accounts.find((a) => a.id === persona) ??
    // Персона удалена из состояния — исходная запись того же аккаунта.
    seedAccounts.find((a) => a.id === persona)!;
  return {
    accountId: account.id,
    email: account.email,
    name: account.fullName,
    role: user.role,
    organizationId: account.organizationId,
  };
}

/**
 * Пользователь сеанса в демо-данных (см. `actorFor`). Из сеанса (`useMe`) берётся роль; оболочка
 * открывает страницу только после загрузки сеанса, поэтому данные уже есть.
 */
export function useActor(): ProtoActor {
  const me = useMe().data;
  const current = useProto();
  if (!me) throw new Error("prototype: no session");
  return actorFor(current, me.user);
}

/** Профиль демо-производителя: сеанс производителя видит только его (GEN-11). */
export const MANUFACTURER_PROFILE_ID = DEMO_PROFILE_ID;

/** Запись в журнал: код действия, объект и фраза на трёх языках (`localized` из `i18n.ts`). */
export type AuditInput = Pick<AuditEvent, "action" | "subject" | "summary">;

let sequence = 0;

/** Ключ новой записи. Не `crypto.randomUUID`: в браузере без HTTPS его нет. */
export function newId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Время события в ISO 8601 (DATA-08: показывает `useFormat` в часовом поясе Алматы). */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Правка с записью в журнал аудита (AUD-01). `recipe` меняет черновик — глубокую копию состояния;
 * после него в журнал дописывается событие от `actor`. Вне React — для тестов и редких случаев.
 */
export function commit(actor: ProtoActor, audit: AuditInput, recipe: (draft: ProtoState) => void): void {
  const draft = structuredClone(getProtoState());
  recipe(draft);
  draft.audit.push({ id: newId("au"), at: nowIso(), actor, ...audit });
  setProtoState(draft);
}

/** `const update = useProtoUpdate(); update({ action, subject, summary }, (draft) => { … })`. */
export function useProtoUpdate(): (audit: AuditInput, recipe: (draft: ProtoState) => void) => void {
  const actor = useActor();
  return (audit, recipe) => commit(actor, audit, recipe);
}

/**
 * Свои данные модуля в черновике: `ext[role]`, при первом обращении — `initial()`. Тип задаёт модуль;
 * сохранённое значение старой формы модуль проверяет сам.
 */
export function extOf<T>(draft: ProtoState, role: Role, initial: () => T): T {
  draft.ext[role] ??= initial();
  return draft.ext[role] as T;
}

/** Свои данные модуля для чтения: `ext[role]` или `initial`. */
export function useExt<T>(role: Role, initial: T): T {
  return useProto((s) => (s.ext[role] as T | undefined) ?? initial);
}

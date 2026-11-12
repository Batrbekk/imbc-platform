import type { Locale, Role } from "@imbc/contracts";
import type { Mock } from "vitest";
import { afterEach } from "vitest";

import type { Me } from "@/lib/session";
import { createInitialState, type ProtoState } from "@/prototype/data";
import { PROTOTYPE_STATE_URL } from "@/prototype/remote";
import { getProtoState, setProtoState } from "@/prototype/store";

import { type ApiReply, stubApi } from "../support/api";
import { renderRoute } from "../support/render";

/** Адреса демо-сеансов — как в seed: по ним прототип находит аккаунт (`useActor`). */
export const SESSION_EMAIL: Record<Role, string> = {
  manufacturer: "manufacturer@demo.local",
  expert: "expert@imbc.local",
  administrator: "admin@imbc.local",
  director: "director@imbc.local",
  operator: "operator@operator.local",
  observer: "observer@observer.local",
};

const HOME: Record<Role, string> = {
  manufacturer: "/profile",
  expert: "/reviews",
  administrator: "/admin/accounts",
  director: "/dashboard",
  operator: "/dashboard",
  observer: "/dashboard",
};

/**
 * Сеанс роли с пройденными шлюзами входа; `email` и `fullName` — другой пользователь той же роли
 * (например, настоящий человек на стенде: в хранилище прототипа его данные попадать не должны).
 */
export function sessionFor(role: Role, email = SESSION_EMAIL[role], fullName: string | null = null): Me {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email,
      fullName,
      role,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationType:
        role === "manufacturer"
          ? "manufacturer"
          : role === "operator"
            ? "operator"
            : role === "observer"
              ? "observer"
              : "imbc",
      locale: "en",
    },
    gates: { mfa: true, responsibility: true },
    homePath: HOME[role],
    otpDelivery: "email",
  };
}

/**
 * Запросы к /api/v1: экраны прототипа их не делают (берут данные из хранилища). Проверка режима
 * хранилища при открытии кабинета (`GET /api/v1/prototype/state`, `remote.ts`) — не запрос экрана.
 */
export function apiV1Calls(api: Mock<typeof fetch>): string[] {
  return api.mock.calls
    .filter(([url, init]) => !(String(url) === PROTOTYPE_STATE_URL && (init?.method ?? "GET") === "GET"))
    .map(([url]) => String(url))
    .filter((url) => url.includes("/api/v1/"));
}

/**
 * Открывает адрес приложения ролью `role` в проекте `prototype` (флаг сборки включён) с исходными
 * демо-данными. `prepare` правит свежее состояние до отрисовки; `keepState` оставляет состояние
 * прошлого рендера — так в тесте другая роль входит в том же браузере. `api` — ответы для готовых
 * экранов, если тест уходит на них (стартовая страница после шлюза роли). Язык по умолчанию — английский.
 */
export function renderCabinet(
  entry: string,
  options: {
    role: Role;
    email?: string;
    fullName?: string;
    locale?: Locale;
    prepare?: (draft: ProtoState) => void;
    keepState?: boolean;
    api?: Record<string, ApiReply>;
  },
) {
  if (!options.keepState) {
    const state = createInitialState();
    options.prepare?.(state);
    setProtoState(state);
  }
  const api = stubApi({
    "GET /api/auth/me": { body: sessionFor(options.role, options.email, options.fullName) },
    ...options.api,
  });
  const rendered = renderRoute(entry, { locale: options.locale ?? "en" });
  return { ...rendered, api, state: getProtoState };
}

// Каждый тест начинает с пустого localStorage; состояние в памяти задаёт renderCabinet.
afterEach(() => {
  window.localStorage.clear();
});

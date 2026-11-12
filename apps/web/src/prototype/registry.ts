import type { Locale, Role } from "@imbc/contracts";
import type { LucideIcon } from "lucide-react";
import type { RouteObject } from "react-router";

/** Начало адресов прототипа: `/proto/<role>/<screen>`. */
export const PROTO_BASE = "/proto";

/** Адрес экрана модуля роли: `protoPath("operator", "marks")` → `/proto/operator/marks`. */
export function protoPath(role: Role, screen = ""): string {
  return `${PROTO_BASE}/${role}${screen ? `/${screen.replace(/^\/+/, "")}` : ""}`;
}

/** Пункт группы «Прототип» в меню оболочки. */
export interface CabinetMenuItem {
  /** Полный адрес экрана, построенный `protoPath(role, screen)`. */
  href: string;
  /** Подпись на языке интерфейса: словарь модуля, см. `i18n.ts`. */
  label: (locale: Locale) => string;
  icon: LucideIcon;
  /** Возможность Release 2: пункт помечается бейджем. */
  badge?: "release2";
}

/**
 * Модуль кабинета роли (`prototype/<role>/index.tsx`). Маршруты — относительно `/proto/<role>/`
 * (`{ path: "marks", element: <MarksPage /> }`, `{ index: true, … }`): они рисуются внутри шлюза
 * роли как вложенные `<Routes>`, поэтому loader и action в них не работают — данные берутся из
 * хранилища (`store.ts`).
 */
export interface CabinetModule {
  role: Role;
  menu: CabinetMenuItem[];
  routes: RouteObject[];
}

/** Модули по ролям. Каждый — отдельный чанк, загружается только своей ролью. */
export const cabinets: Record<Role, () => Promise<CabinetModule>> = {
  manufacturer: () => import("./manufacturer").then((m) => m.cabinet),
  expert: () => import("./expert").then((m) => m.cabinet),
  administrator: () => import("./administrator").then((m) => m.cabinet),
  director: () => import("./director").then((m) => m.cabinet),
  operator: () => import("./operator").then((m) => m.cabinet),
  observer: () => import("./observer").then((m) => m.cabinet),
};

const loaded = new Map<Role, Promise<CabinetModule>>();

/** Один и тот же промис на роль: его читает `use()` в меню оболочки и в шлюзе роли. */
export function loadCabinet(role: Role): Promise<CabinetModule> {
  let promise = loaded.get(role);
  if (!promise) {
    promise = cabinets[role]();
    // Неудачная загрузка чанка не запоминается: следующий заход попробует снова.
    promise.catch(() => loaded.delete(role));
    loaded.set(role, promise);
  }
  return promise;
}

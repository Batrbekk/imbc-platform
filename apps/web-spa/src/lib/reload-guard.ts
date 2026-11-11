import { reloadApp } from "./leave-app";

/**
 * Одна перезагрузка на сбой: флаг в sessionStorage не даёт вкладке зациклиться, если и после
 * перезагрузки файл не загрузился. Флаги разные: старт (main.tsx) снимает свой при каждом
 * успешном рендере, поэтому общий флаг превратил бы сбой ленивой страницы в цикл.
 */
export const STARTUP_RELOAD = "imbc:startup-reload";
export const LAZY_RELOAD = "imbc:lazy-reload";
const PROBE = "imbc:storage-probe";

/** «Не перезагружено»: `used` — перезагрузка уже была, `unavailable` — sessionStorage недоступен. */
export type ReloadOutcome = "reloaded" | "used" | "unavailable";

/**
 * Можно ли ещё перезагрузить страницу по этому флагу. Хранилище, в которое нельзя записать
 * флаг, — нельзя: иначе перезагрузка не запомнилась бы и повторялась.
 */
export function canReload(flag: string): boolean {
  try {
    if (sessionStorage.getItem(flag) !== null) return false;
    sessionStorage.setItem(PROBE, "1");
    sessionStorage.removeItem(PROBE);
    return true;
  } catch {
    return false;
  }
}

export function reloadOnce(flag: string): ReloadOutcome {
  try {
    if (sessionStorage.getItem(flag) !== null) return "used";
    sessionStorage.setItem(flag, "1");
  } catch {
    return "unavailable";
  }
  reloadApp();
  return "reloaded";
}

export function clearReloadFlag(flag: string): void {
  try {
    sessionStorage.removeItem(flag);
  } catch {
    // Хранилище недоступно — и флага в нём нет.
  }
}

/**
 * Динамический import не загрузился: так браузеры сообщают об отсутствующем чанке
 * (вкладка старше выката, /assets/* отвечает 404). Тексты Chrome/Edge, Firefox и Safari.
 */
export function isChunkLoadError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(error.message)
  );
}

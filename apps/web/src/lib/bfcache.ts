import { reloadApp } from "./leave-app";

/**
 * Вкладка восстановлена из back/forward cache (`persisted`): страница показана такой, какой её
 * оставили, без запросов к BFF — например, каталог прежнего пользователя после выхода и «Назад».
 * Перезагрузка заново проверяет сеанс (NFR-11). index.html отдаётся с `Cache-Control: no-store`,
 * но не каждый браузер из-за этого отказывается от back/forward cache.
 */
export function reloadFromBackForwardCache(event: PageTransitionEvent): void {
  if (event.persisted) reloadApp();
}

/** Подписка на `pageshow` для вкладки; возвращает отписку. Вызывается один раз при старте (main.tsx). */
export function watchBackForwardCache(): () => void {
  window.addEventListener("pageshow", reloadFromBackForwardCache);
  return () => window.removeEventListener("pageshow", reloadFromBackForwardCache);
}

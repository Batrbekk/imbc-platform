/**
 * Уход со SPA: адреса /api/* и /kc/* обслуживают BFF и Keycloak, а не роутер,
 * поэтому туда идёт обычный переход браузера. Тесты подменяют модуль через vi.mock.
 */
export function leaveApp(url: string, options: { replace?: boolean } = {}): void {
  if (options.replace) window.location.replace(url);
  else window.location.assign(url);
}

/** Полная перезагрузка страницы, например когда чанк вкладки старше выката. */
export function reloadApp(): void {
  window.location.reload();
}

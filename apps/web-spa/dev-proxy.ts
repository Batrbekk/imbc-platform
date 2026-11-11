import type { ProxyOptions } from "vite";

/**
 * Только для `pnpm dev` на хосте: один origin для UI, BFF (/api) и Keycloak (/kc),
 * как rewrites прежнего next.config.ts. В Docker и на стендах переменные не заданы —
 * маршрутизирует nginx/ingress. Host браузера сохраняется, X-Forwarded-* добавляются,
 * как у nginx.
 */
export function devProxy(env: Record<string, string | undefined>): Record<string, ProxyOptions> {
  const routes: Array<[prefix: string, target: string | undefined]> = [
    ["api", env.API_PROXY_URL],
    ["kc", env.KEYCLOAK_PROXY_URL],
  ];
  const proxy: Record<string, ProxyOptions> = {};
  for (const [prefix, target] of routes) {
    // Пустая строка равна отсутствию переменной.
    if (target) proxy[`^/${prefix}(?:/|$)`] = { target, changeOrigin: false, xfwd: true };
  }
  return proxy;
}

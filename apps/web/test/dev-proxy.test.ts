// Замена rewrites прежнего Next.js-приложения (next.config.ts): dev-прокси Vite на тот же origin.
import { describe, expect, it } from "vitest";

import { devProxy } from "../dev-proxy";

const env = { API_PROXY_URL: "http://localhost:3001", KEYCLOAK_PROXY_URL: "http://localhost:8180" };

describe("devProxy", () => {
  it("проксирует /api и /kc на заданные адреса, как rewrites Next.js", () => {
    expect(devProxy(env)).toEqual({
      "^/api(?:[/?#]|$)": { target: "http://localhost:3001", changeOrigin: false, xfwd: true },
      "^/kc(?:[/?#]|$)": { target: "http://localhost:8180", changeOrigin: false, xfwd: true },
    });
  });

  it("без переменных прокси нет — как в Docker и на стенде", () => {
    expect(devProxy({})).toEqual({});
    expect(devProxy({ API_PROXY_URL: "" })).toEqual({});
  });

  // Vite проверяет ключ-регулярное выражение на адресе вместе с query string.
  it("ключ принимает префикс с путём, query и fragment и отклоняет более длинное имя", () => {
    const [api, kc] = Object.keys(devProxy(env)).map((key) => new RegExp(key));
    for (const url of ["/api", "/api/", "/api/x", "/api?x=1", "/api#x"]) expect(url).toMatch(api);
    for (const url of ["/apix", "/apix/y", "/x/api", "/kc"]) expect(url).not.toMatch(api);
    for (const url of ["/kc", "/kc/realms/imbc", "/kc?x=1"]) expect(url).toMatch(kc);
    for (const url of ["/kcx", "/kc-admin", "/api"]) expect(url).not.toMatch(kc);
  });
});

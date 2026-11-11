// Замена rewrites из apps/web/next.config.ts: dev-прокси Vite на тот же origin.
import { describe, expect, it } from "vitest";

import { devProxy } from "../dev-proxy";

describe("devProxy", () => {
  it("проксирует /api и /kc на заданные адреса, как rewrites Next.js", () => {
    expect(
      devProxy({ API_PROXY_URL: "http://localhost:3001", KEYCLOAK_PROXY_URL: "http://localhost:8180" }),
    ).toEqual({
      "^/api(?:/|$)": { target: "http://localhost:3001", changeOrigin: false, xfwd: true },
      "^/kc(?:/|$)": { target: "http://localhost:8180", changeOrigin: false, xfwd: true },
    });
  });

  it("без переменных прокси нет — как в Docker и на стенде", () => {
    expect(devProxy({})).toEqual({});
    expect(devProxy({ API_PROXY_URL: "" })).toEqual({});
  });
});

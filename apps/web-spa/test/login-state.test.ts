import { describe, expect, it } from "vitest";

import { LOGIN_ERRORS, resolveLoginState } from "@/lib/login-state";

describe("состояние страницы входа", () => {
  it("без ошибки уводит в BFF с безопасным returnTo и языком (ADR-04)", () => {
    expect(resolveLoginState(new URLSearchParams("returnTo=/catalog?q=steel"), "kk")).toEqual({
      kind: "redirect",
      url: "/api/auth/login?returnTo=%2Fcatalog%3Fq%3Dsteel&locale=kk",
    });
    expect(resolveLoginState(new URLSearchParams("returnTo=https://evil.example"), "ru")).toEqual({
      kind: "redirect",
      url: "/api/auth/login?returnTo=%2F&locale=ru",
    });
    expect(resolveLoginState(new URLSearchParams(""), "en")).toEqual({
      kind: "redirect",
      url: "/api/auth/login?returnTo=%2F&locale=en",
    });
  });

  it("известная ошибка показывается как есть, любая другая — как oidc", () => {
    expect(resolveLoginState(new URLSearchParams("error=no_account"), "kk")).toEqual({
      kind: "error",
      error: "no_account",
      target: "/",
    });
    for (const error of LOGIN_ERRORS)
      expect(resolveLoginState(new URLSearchParams(`error=${error}&returnTo=/dashboard`), "kk")).toEqual({
        kind: "error",
        error,
        target: "/dashboard",
      });
    expect(resolveLoginState(new URLSearchParams("error=whatever"), "kk")).toMatchObject({
      kind: "error",
      error: "oidc",
    });
  });

  it("после выхода — «Вы вышли», но ошибка важнее", () => {
    expect(resolveLoginState(new URLSearchParams("logged_out=1"), "kk")).toEqual({ kind: "signedOut", target: "/" });
    expect(resolveLoginState(new URLSearchParams("logged_out=1&error=oidc"), "kk")).toMatchObject({ kind: "error" });
    expect(resolveLoginState(new URLSearchParams("logged_out=0"), "kk")).toMatchObject({ kind: "redirect" });
  });
});

import type { Role } from "@imbc/contracts";
import { describe, expect, it } from "vitest";

import { authDestination } from "@/lib/auth-navigation";

describe("authDestination", () => {
  it("all six roles land on a page they can open", () => {
    const homes: Record<Role, string> = {
      manufacturer: "/profile",
      administrator: "/account",
      expert: "/catalog",
      director: "/catalog",
      operator: "/catalog",
      observer: "/catalog",
    };
    for (const [role, homePath] of Object.entries(homes) as [Role, string][]) {
      expect(authDestination({ user: { role }, homePath })).toBe(homePath);
    }
  });

  it("a saved catalogue URL cannot send a manufacturer or administrator to forbidden content", () => {
    expect(authDestination({ user: { role: "manufacturer" }, homePath: "/profile" }, "/catalog?q=steel")).toBe(
      "/profile",
    );
    expect(authDestination({ user: { role: "administrator" }, homePath: "/account" }, "/catalog")).toBe("/account");
    expect(authDestination({ user: { role: "expert" } }, "/dashboard")).toBe("/catalog");
  });

  it("authorized deep links keep their filters and fragments", () => {
    expect(authDestination({ user: { role: "operator" } }, "/catalog?q=steel&page=2#results")).toBe(
      "/catalog?q=steel&page=2#results",
    );
    expect(authDestination({ user: { role: "manufacturer" } }, "/account")).toBe("/account");
  });

  it("external and authentication return paths recover to the role home", () => {
    const me = { user: { role: "manufacturer" as const }, homePath: "/profile" };
    for (const target of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "javascript:alert(1)",
      "/auth/verify",
      "/login",
      "/register",
    ]) {
      expect(authDestination(me, target)).toBe("/profile");
    }
  });
});

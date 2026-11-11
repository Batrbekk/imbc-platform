import { destinationFor, ROLES, type Role } from "@imbc/contracts";
import { describe, expect, it } from "vitest";

import { authDestination } from "@/lib/auth-navigation";

describe("authDestination", () => {
  it("без сохранённого адреса — стартовая страница роли: дашборд у оператора, наблюдателя и директора (OPR-31)", () => {
    const homes: Record<Role, string> = {
      manufacturer: "/profile",
      administrator: "/account",
      expert: "/catalog",
      director: "/dashboard",
      operator: "/dashboard",
      observer: "/dashboard",
    };
    for (const [role, home] of Object.entries(homes) as [Role, string][]) {
      expect(authDestination({ user: { role } }), role).toBe(home);
    }
  });

  it("a saved catalogue URL cannot send a manufacturer or administrator to forbidden content", () => {
    expect(authDestination({ user: { role: "manufacturer" } }, "/catalog?q=steel")).toBe("/profile");
    expect(authDestination({ user: { role: "administrator" } }, "/catalog")).toBe("/account");
    expect(authDestination({ user: { role: "expert" } }, "/dashboard")).toBe("/catalog");
    // Профиль компании — только у производителя (profile.edit).
    expect(authDestination({ user: { role: "operator" } }, "/profile")).toBe("/dashboard");
  });

  it("путь с завершающим / не обходит шлюз роли", () => {
    expect(authDestination({ user: { role: "manufacturer" } }, "/catalog/")).toBe("/profile");
    expect(authDestination({ user: { role: "expert" } }, "/dashboard/")).toBe("/catalog");
    expect(authDestination({ user: { role: "expert" } }, "/catalog/")).toBe("/catalog/");
  });

  it("authorized deep links keep their filters and fragments", () => {
    expect(authDestination({ user: { role: "operator" } }, "/catalog?q=steel&page=2#results")).toBe(
      "/catalog?q=steel&page=2#results",
    );
    expect(authDestination({ user: { role: "operator" } }, "/catalog/123")).toBe("/catalog/123");
    expect(authDestination({ user: { role: "manufacturer" } }, "/account")).toBe("/account");
  });

  it("external and authentication return paths recover to the role home", () => {
    for (const target of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "javascript:alert(1)",
      "/auth/verify",
      "/login",
      "/register",
    ]) {
      expect(authDestination({ user: { role: "manufacturer" } }, target)).toBe("/profile");
    }
  });

  it("правило одно с сервером: destinationFor из @imbc/contracts", () => {
    for (const role of ROLES)
      for (const target of ["/", "/catalog", "/dashboard?x=1", "/profile/", "/account", "/login", "//example.com"])
        expect(authDestination({ user: { role } }, target), `${role} ${target}`).toBe(destinationFor(role, target));
  });
});

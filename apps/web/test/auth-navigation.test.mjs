import assert from "node:assert/strict";
import test from "node:test";
import { authDestination } from "../src/lib/auth-navigation.ts";

test("all six roles land on a page they can open", () => {
  const homes = {
    manufacturer: "/profile",
    administrator: "/account",
    expert: "/catalog",
    director: "/catalog",
    operator: "/catalog",
    spectator: "/catalog",
  };
  for (const [role, homePath] of Object.entries(homes)) {
    assert.equal(authDestination({ user: { role }, homePath }), homePath);
  }
});

test("a saved catalogue URL cannot send a manufacturer or administrator to forbidden content", () => {
  assert.equal(
    authDestination({ user: { role: "manufacturer" }, homePath: "/profile" }, "/catalog?q=steel"),
    "/profile",
  );
  assert.equal(authDestination({ user: { role: "administrator" }, homePath: "/account" }, "/catalog"), "/account");
  assert.equal(authDestination({ user: { role: "expert" } }, "/dashboard"), "/catalog");
});

test("authorized deep links keep their filters and fragments", () => {
  assert.equal(
    authDestination({ user: { role: "operator" } }, "/catalog?q=steel&page=2#results"),
    "/catalog?q=steel&page=2#results",
  );
  assert.equal(authDestination({ user: { role: "manufacturer" } }, "/account"), "/account");
});

test("external and authentication return paths recover to the role home", () => {
  const me = { user: { role: "manufacturer" }, homePath: "/profile" };
  for (const target of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "javascript:alert(1)",
    "/auth/verify",
    "/login",
    "/register",
  ]) {
    assert.equal(authDestination(me, target), "/profile");
  }
});

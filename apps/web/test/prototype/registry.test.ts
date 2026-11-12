// Реестр кабинетов: модуль на роль, адреса /proto/<role>/<screen> (GEN-08).
import { ROLES } from "@imbc/contracts";
import { describe, expect, it } from "vitest";

import { cabinets, loadCabinet, protoPath } from "@/prototype/registry";

describe("реестр кабинетов", () => {
  it("адрес экрана строится от роли", () => {
    expect(protoPath("operator", "marks")).toBe("/proto/operator/marks");
    expect(protoPath("operator", "/marks")).toBe("/proto/operator/marks");
    expect(protoPath("expert")).toBe("/proto/expert");
  });

  it.each(ROLES)("модуль %s: своя роль, пункты меню и маршруты внутри своего адреса", async (role) => {
    const cabinet = await cabinets[role]();
    expect(cabinet.role).toBe(role);
    for (const item of cabinet.menu) {
      expect(item.href.startsWith(`${protoPath(role)}/`) || item.href === protoPath(role), item.href).toBe(true);
      for (const locale of ["kk", "ru", "en"] as const) expect(item.label(locale).trim(), item.href).not.toBe("");
    }
    // Маршруты относительно /proto/<role>/: без ведущего «/».
    for (const route of cabinet.routes) expect(route.path?.startsWith("/") ?? false, route.path).toBe(false);
    expect(await loadCabinet(role)).toBe(await loadCabinet(role));
  });
});

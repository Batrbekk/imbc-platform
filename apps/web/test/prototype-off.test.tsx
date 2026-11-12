// Сборка без флага VITE_PROTOTYPE_CABINETS: прототипа кабинетов нет (GEN-08, NFR-15).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { screen } from "@testing-library/react";
import type { RouteObject } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/session";
import { PROTOTYPE, PROTOTYPE_CONDITION } from "@/prototype/flag";
import { routes } from "@/router";

import en from "../messages/en.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const SRC = resolve(import.meta.dirname, "../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const PROTO = join(SRC, "prototype");

/**
 * Импорты файла, ведущие в src/prototype: через «@/» и относительные. `static` — `from "…"` и
 * `import "…"`, `dynamic` — `import("…")`.
 */
function prototypeImports(file: string, text: string) {
  const target = (spec: string) => {
    const path = spec.startsWith("@/")
      ? join(SRC, spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(file), spec)
        : null;
    return path !== null && (path === PROTO || path.startsWith(PROTO + sep));
  };
  const specs = (pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]!).filter(target);
  return {
    static: specs(/(?:from|^\s*import)\s+["']([^"']+)["']/gm),
    dynamic: specs(/import\(\s*["']([^"']+)["']\s*\)/g),
  };
}

const paths = (list: RouteObject[] = []): string[] => list.flatMap((r) => [r.path ?? "", ...paths(r.children)]);

const OPERATOR: Me = {
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "operator@operator.local",
    fullName: null,
    role: "operator",
    organizationId: "00000000-0000-4000-8000-000000000002",
    organizationType: "operator",
    locale: "en",
  },
  gates: { mfa: true, responsibility: true },
  homePath: "/dashboard",
  otpDelivery: "email",
};

describe("без флага прототипа", () => {
  it("флаг выключен, маршрута /proto нет — адрес «не найдено»", async () => {
    expect(PROTOTYPE).toBe(false);
    expect(paths(routes)).not.toContain("proto/:role/*");

    stubApi({ "GET /api/auth/me": { body: OPERATOR } });
    renderRoute("/proto/operator/marks", { locale: "en" });
    expect(await screen.findByRole("heading", { name: en.notFound.title })).toBeTruthy();
  });

  it("проверка импортов видит и «@/», и относительные пути в src/prototype", () => {
    const file = join(SRC, "routes/app/page.tsx");
    expect(
      prototypeImports(
        file,
        [
          'import { a } from "../../prototype/store";',
          'import "@/prototype/flag";',
          'import { b } from "@/lib/api";',
          'const m = import("../../prototype/menu");',
          'const n = import("@/prototype/gate");',
        ].join("\n"),
      ),
    ).toEqual({
      static: ["../../prototype/store", "@/prototype/flag"],
      dynamic: ["../../prototype/menu", "@/prototype/gate"],
    });
  });

  it("прототип подключается только динамическим import() под условием флага", () => {
    for (const path of files(SRC)) {
      const name = relative(SRC, path);
      if (name.startsWith(`prototype${sep}`) || !/\.tsx?$/.test(name)) continue;
      const found = prototypeImports(path, readFileSync(path, "utf8"));
      // Статический импорт вытянул бы прототип в сборку без флага.
      expect(found.static, name).toEqual([]);
      if (found.dynamic.length > 0) expect(readFileSync(path, "utf8"), name).toContain(PROTOTYPE_CONDITION);
    }
    expect(readFileSync(join(SRC, "router.tsx"), "utf8")).toContain(PROTOTYPE_CONDITION);
    expect(readFileSync(join(SRC, "components/app/app-shell.tsx"), "utf8")).toContain(PROTOTYPE_CONDITION);
  });
});

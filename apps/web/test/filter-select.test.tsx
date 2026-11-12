// Выпадающие фильтры очереди и каталога: список под кнопкой и не уже своих вариантов (OPR-02, REV-04).
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Me } from "@/lib/session";

import en from "../messages/en.json";
import { stubApi } from "./support/api";
import { renderRoute } from "./support/render";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

function me(role: "expert" | "operator"): Me {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000001",
      email: `${role}@${role}.local`,
      fullName: null,
      role,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationType: role === "operator" ? "operator" : "imbc",
      locale: "en",
    },
    gates: { mfa: true, responsibility: true },
    homePath: role === "expert" ? "/reviews" : "/dashboard",
    otpDelivery: "email",
  };
}

/**
 * Открывает список и проверяет всплывающую часть. Ширину в jsdom не измерить, поэтому закреплены
 * параметры: список под кнопкой и не совмещает выбранный вариант с кнопкой (иначе он ложится поверх неё),
 * ширина по содержимому (`w-auto`), но не меньше кнопки (`min-w-(--anchor-width)`); ширины
 * ровно с кнопку (`w-(--anchor-width)`), из-за которой обрезались длинные варианты, нет.
 */
async function expectWideList(user: ReturnType<typeof renderRoute>["user"], name: string) {
  await user.click(await screen.findByRole("combobox", { name }));
  const list = (await screen.findByRole("listbox")).closest<HTMLElement>("[data-slot=select-content]")!;
  expect(list.dataset.alignTrigger, name).toBe("false");
  expect(list.dataset.side, name).toBe("bottom");
  const classes = list.className.split(/\s+/);
  expect(classes, name).toContain("w-auto");
  expect(classes, name).toContain("min-w-(--anchor-width)");
  expect(classes, name).not.toContain("w-(--anchor-width)");
  await user.keyboard("{Escape}");
}

describe("выпадающие фильтры (OPR-02, REV-04)", () => {
  it("очередь SME: список статусов не уже своих вариантов", async () => {
    stubApi({
      "GET /api/auth/me": { body: me("expert") },
      "GET /api/v1/reviews/queue": { body: { items: [], total: 0 } },
    });
    const { user } = renderRoute("/reviews", { locale: "en" });

    await expectWideList(user, en.reviews.statusFilter);
  });

  it("каталог: три списка не уже своих вариантов", async () => {
    stubApi({
      "GET /api/auth/me": { body: me("operator") },
      "GET /api/v1/catalog/search": { body: { items: [], total: 0, page: 1, pageSize: 25 } },
    });
    const { user } = renderRoute("/catalog", { locale: "en" });

    for (const name of [en.catalog.surveyed, en.catalog.unifiedRegister, en.catalog.sort]) {
      await expectWideList(user, name);
    }
  });
});

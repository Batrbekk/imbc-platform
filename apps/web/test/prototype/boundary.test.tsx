// Ошибка модуля прототипа не ломает готовые страницы и меню роли (GEN-08, NFR-15).
import type { Dashboard } from "@imbc/contracts";
import type { Role } from "@imbc/contracts";
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialState } from "@/prototype/data";
import { loadCabinet } from "@/prototype/registry";

import en from "../../messages/en.json";
import { renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
// Пункт меню SME бросает при подписи.
vi.mock("@/prototype/expert", async () => {
  const { BugIcon } = await import("lucide-react");
  return {
    cabinet: {
      role: "expert",
      menu: [
        {
          href: "/proto/expert/x",
          label: () => {
            throw new Error("label failed");
          },
          icon: BugIcon,
        },
      ],
      routes: [],
    },
  };
});
// Модуль наблюдателя не загрузился (чанк не найден).
vi.mock("@/prototype/observer", () => Promise.reject(new Error("chunk failed")));
// Экран оператора бросает при отрисовке.
vi.mock("@/prototype/operator", async () => {
  const { BugIcon } = await import("lucide-react");
  function Broken(): never {
    throw new Error("screen failed");
  }
  return {
    cabinet: {
      role: "operator",
      menu: [{ href: "/proto/operator/broken", label: () => "Broken screen", icon: BugIcon }],
      routes: [{ path: "broken", element: <Broken /> }],
    },
  };
});

const DASHBOARD: Dashboard = {
  total: 0,
  byRegion: [],
  byCommodityGroup: [],
  siteSurveyed: 0,
  unifiedRegister: 0,
  updateStatus: { active: 0, outdated: 0, unresponsive: 0 },
  tier: { tier_1: 0, tier_2: 0 },
  generatedAt: "2026-11-11T10:00:00Z",
};

beforeEach(() => {
  // React пишет пойманные ошибки в консоль; здесь они ожидаемы.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Дождаться, пока модуль роли загрузится или упадёт, и React отрисует последствия. */
async function settle(role: Role) {
  await act(async () => {
    await loadCabinet(role).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe("границы ошибок прототипа", () => {
  it("пункт меню бросает — готовая страница и меню на месте, группы нет", async () => {
    renderCabinet("/reviews", {
      role: "expert",
      api: { "GET /api/v1/reviews/queue": { body: { items: [], total: 0 } } },
    });
    expect(await screen.findByRole("heading", { level: 1, name: en.reviews.title })).toBeTruthy();
    await settle("expert");
    expect(screen.getByRole("heading", { level: 1, name: en.reviews.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.nav.reviews })).toBeTruthy();
    expect(screen.queryByText("Prototype")).toBeNull();
  });

  it("модуль не загрузился — готовая страница и меню на месте", async () => {
    renderCabinet("/dashboard", { role: "observer", api: { "GET /api/v1/dashboard": { body: DASHBOARD } } });
    expect(await screen.findByRole("heading", { level: 1, name: en.dashboard.title })).toBeTruthy();
    await settle("observer");
    expect(screen.getByRole("heading", { level: 1, name: en.dashboard.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: en.nav.dashboard })).toBeTruthy();
    expect(screen.queryByText("Prototype")).toBeNull();
  });

  it("экран бросает — сообщение в оболочке, сброс демо-данных возвращает исходное состояние", async () => {
    const { user, state } = renderCabinet("/proto/operator/broken", {
      role: "operator",
      prepare: (draft) => {
        draft.operatorNotes = [];
      },
    });
    expect(await screen.findByRole("heading", { name: "This prototype screen failed" })).toBeTruthy();
    // Оболочка и меню целы: готовые пункты и группа прототипа.
    expect(screen.getByRole("link", { name: en.nav.dashboard })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Broken screen" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    await waitFor(() => expect(state()).toEqual(createInitialState()));
    // Экран отрисован заново (и снова бросил): сообщение на месте, страница не упала.
    expect(await screen.findByRole("heading", { name: "This prototype screen failed" })).toBeTruthy();
  });

  it("сообщение переведено", async () => {
    renderCabinet("/proto/operator/broken", { role: "operator", locale: "kk" });
    expect(await screen.findByRole("heading", { name: "Прототип экраны ашылмады" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Демо-деректерді қалпына келтіру" })).toBeTruthy();
  });
});

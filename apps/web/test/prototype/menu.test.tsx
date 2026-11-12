// Группа «Прототип» в меню: длинная подпись не уходит под бейдж «Release 2».
// В jsdom нет раскладки: тест закрепляет только классы и структуру, ширину проверяют в браузере.
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
vi.mock("@/prototype/operator", async () => {
  const { BellIcon, ListIcon } = await import("lucide-react");
  return {
    cabinet: {
      role: "operator",
      menu: [
        { href: "/proto/operator/a", label: () => "Short", icon: ListIcon },
        {
          href: "/proto/operator/b",
          label: () => "A very long subscriptions label for the export",
          icon: BellIcon,
          badge: "release2",
        },
      ],
      routes: [{ path: "a", element: <h1>A</h1> }],
    },
  };
});

describe("пункт меню прототипа с бейджем", () => {
  it("кнопка оставляет место под бейдж, подпись обрезается и сохраняет полный текст в title", async () => {
    renderCabinet("/proto/operator/a", { role: "operator" });
    const long = await screen.findByRole("link", { name: "A very long subscriptions label for the export" });
    // Подпись — последний span кнопки: его обрезает многоточием `[&>span:last-child]:truncate` из ui/sidebar.
    const label = long.querySelector(":scope > span:last-child")!;
    expect(label.textContent).toBe("A very long subscriptions label for the export");
    expect(label.getAttribute("title")).toBe("A very long subscriptions label for the export");
    // Бейдж стоит абсолютно справа (right-1): правый отступ кнопки шире него.
    expect(long.className.split(/\s+/)).toContain("pr-20");
    const badge = long.parentElement!.querySelector("[data-sidebar=menu-badge]")!;
    expect(badge.textContent).toBe("Release 2");
    expect(badge.previousElementSibling).toBe(long);

    // Без бейджа — обычный отступ кнопки.
    expect(screen.getByRole("link", { name: "Short" }).className.split(/\s+/)).not.toContain("pr-20");
  });
});

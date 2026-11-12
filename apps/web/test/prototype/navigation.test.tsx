// Граница ошибок шлюза и переходы внутри кабинета: здоровое дерево не перемонтируется (GEN-08).
import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderCabinet } from "./support";

vi.mock("@/lib/leave-app", () => ({ leaveApp: vi.fn(), reloadApp: vi.fn() }));
vi.mock("@/prototype/operator", async () => {
  const { useState } = await import("react");
  const { Link, Outlet } = await import("react-router");
  const { useProto } = await import("@/prototype/store");
  function Layout() {
    const [count, setCount] = useState(0);
    return (
      <div>
        <button onClick={() => setCount(count + 1)}>Count: {count}</button>
        <Link to="/proto/operator/layout/a">To A</Link>
        <Link to="/proto/operator/layout/b">To B</Link>
        <Outlet />
      </div>
    );
  }
  function Broken(): never {
    throw new Error("screen failed");
  }
  // Бросает только на повреждённых данных: у профиля нет секций.
  function Fragile() {
    return <h1>{useProto((s) => s.profiles[0]!.sections.main.legalName)}</h1>;
  }
  return {
    cabinet: {
      role: "operator",
      menu: [],
      routes: [
        {
          path: "layout",
          element: <Layout />,
          children: [
            { path: "a", element: <p>Child A</p> },
            { path: "b", element: <p>Child B</p> },
          ],
        },
        { path: "broken", element: <Broken /> },
        { path: "ok", element: <h1>OK screen</h1> },
        { path: "fragile", element: <Fragile /> },
      ],
    },
  };
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FAILED = "This prototype screen failed";

describe("переходы внутри кабинета", () => {
  it("layout-маршрут сохраняет своё состояние при смене дочернего экрана", async () => {
    const { user } = renderCabinet("/proto/operator/layout/a", { role: "operator" });
    expect(await screen.findByText("Child A")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Count: 0" }));
    await user.click(screen.getByRole("link", { name: "To B" }));
    expect(await screen.findByText("Child B")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Count: 1" })).toBeTruthy();
  });

  it("после сбоя экрана переход на другой экран модуля показывает его", async () => {
    const { router } = renderCabinet("/proto/operator/broken", { role: "operator" });
    expect(await screen.findByRole("heading", { name: FAILED })).toBeTruthy();
    await act(() => router.navigate("/proto/operator/ok"));
    expect(await screen.findByRole("heading", { name: "OK screen" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: FAILED })).toBeNull();
  });

  it("экран, упавший на повреждённых данных, открывается после сброса демо-данных", async () => {
    const { user } = renderCabinet("/proto/operator/fragile", {
      role: "operator",
      prepare: (draft) => {
        draft.profiles = [{ id: "p01" } as unknown as (typeof draft.profiles)[number]];
      },
    });
    expect(await screen.findByRole("heading", { name: FAILED })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Reset demo data" }));
    expect(await screen.findByRole("heading", { name: "ТОО «Демо Металл Конструкция»" })).toBeTruthy();
  });
});

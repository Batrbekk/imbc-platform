// Компоненты собраны на Base UI, а не на Radix. Ссылка с видом кнопки пишется как
// <a className={buttonVariants(…)}>: Base UI даёт <a> внутри Button role="button".
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "@/components/ui/button";

describe("набор компонентов base-nova", () => {
  it("ссылка с видом кнопки остаётся ссылкой (Base UI не рендерит ссылки через Button)", () => {
    render(
      <a className={buttonVariants({ variant: "outline" })} href="/api/auth/login">
        Go
      </a>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.getAttribute("href")).toBe("/api/auth/login");
    expect(link.className).toBe(buttonVariants({ variant: "outline" }));
  });

  it("Button — настоящая кнопка на Base UI", () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("data-slot")).toBe("button");
  });
});

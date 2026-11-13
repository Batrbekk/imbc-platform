// Компоненты собраны на Base UI, а не на Radix. Ссылка с видом кнопки пишется как
// <a className={cn(buttonVariants(…))}>: Base UI даёт <a> внутри Button role="button".
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { cn } from "cn";
import { describe, expect, it } from "vitest";

import { Button, buttonVariants } from "@/components/ui/button";

const classes = (element: Element) => element.className.split(/\s+/);

describe("набор компонентов base-nova", () => {
  it("ссылка с видом кнопки остаётся ссылкой (Base UI не рендерит ссылки через Button)", () => {
    render(
      <a className={cn(buttonVariants({ variant: "outline" }))} href="/api/auth/login">
        Go
      </a>,
    );
    const link = screen.getByRole("link", { name: "Go" });
    expect(link.getAttribute("href")).toBe("/api/auth/login");
    expect(link.className).toBe(cn(buttonVariants({ variant: "outline" })));
  });

  it("у ссылки-кнопки outline есть рамка: cn сводит border-transparent и border-border (ADM-08, GEN-08)", () => {
    // buttonVariants — cva без слияния классов: оба остаются, а в собранном CSS побеждает прозрачная рамка.
    // Button пропускает класс через cn(), поэтому у кнопки рамка есть; ссылка обязана делать то же.
    const raw = buttonVariants({ variant: "outline" }).split(/\s+/);
    expect(raw).toContain("border-transparent");
    expect(raw).toContain("border-border");

    render(
      <>
        <a className={cn(buttonVariants({ variant: "outline" }))} href="/outline">
          Outline
        </a>
        <Button variant="outline">Button</Button>
      </>,
    );
    for (const element of [
      screen.getByRole("link", { name: "Outline" }),
      screen.getByRole("button", { name: "Button" }),
    ]) {
      expect(classes(element)).not.toContain("border-transparent");
      expect(classes(element)).toContain("border-border");
    }
  });

  it("каждый buttonVariants( в приложении обёрнут в cn( — иначе outline снова без рамки", () => {
    const root = resolve(import.meta.dirname, "../src");
    const files = (readdirSync(root, { recursive: true }) as string[])
      .map((path) => join(root, path))
      // Сгенерированные компоненты shadcn не правим: там buttonVariants определяется и передаётся как есть.
      .filter((path) => /\.tsx?$/.test(path) && !path.includes(join("components", "ui")));
    const bare: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/buttonVariants\(/g))
        if (text.slice(Math.max(0, match.index - 3), match.index) !== "cn(") bare.push(file.slice(root.length + 1));
    }
    expect(bare).toEqual([]);
  });

  it("Button — настоящая кнопка на Base UI", () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("data-slot")).toBe("button");
  });
});

import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Элемент уже `breakpoint` пикселей. Ширина берётся у самого элемента (карточки), а не окна: при открытом
 * боковом меню карточка на окне 768 px уже, чем на телефоне. Измерение идёт до первой отрисовки
 * (layout effect), поэтому кадра с неверной раскладкой нет. Ширина 0 — размеров нет (не измерено, например
 * в jsdom): элемент считается широким.
 */
export function useNarrow(ref: RefObject<HTMLElement | null>, breakpoint: number): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { width } = element.getBoundingClientRect();
      setNarrow(width > 0 && width < breakpoint);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, breakpoint]);
  return narrow;
}

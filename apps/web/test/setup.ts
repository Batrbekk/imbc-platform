import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// В jsdom нет matchMedia, а его читает useIsMobile (компонент sidebar).
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// В jsdom нет elementFromPoint, а input-otp по таймеру ищет им значок менеджера паролей.
if (typeof document !== "undefined" && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

// ScrollRestoration корня прокручивает окно, а jsdom вместо прокрутки пишет «Not implemented».
if (typeof window !== "undefined") {
  window.scrollTo = () => {};
}

// В jsdom нет ResizeObserver и scrollIntoView, а ими пользуется список cmdk (фильтры каталога).
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

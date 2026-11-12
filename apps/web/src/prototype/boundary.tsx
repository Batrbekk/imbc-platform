import { Component, type ErrorInfo, type ReactNode } from "react";

import { isChunkLoadError, reloadOnce } from "@/lib/reload-guard";

/**
 * Флаг одной перезагрузки из-за чанка прототипа в меню. Не `LAZY_RELOAD`: его снимает `Root`,
 * когда готовая страница отрисовалась, а меню падает уже после этого — с общим флагом постоянно
 * отсутствующий чанк перезагружал бы страницу без конца. Снимает его меню, загрузившись
 * (`menu.tsx`); то же значение — у `import()` меню в `app-shell.tsx`.
 */
export const PROTOTYPE_RELOAD = "imbc:prototype-reload";

/**
 * Граница ошибок прототипа: ошибка модуля роли (бросил экран или подпись меню, повреждённые
 * демо-данные) не доходит до `RouteError` корня, поэтому готовые страницы и меню роли остаются на месте.
 * `fallback(retry)` — что показать вместо; `retry` рисует детей заново. Смена `resetKey` (адрес)
 * снимает сбой без перемонтирования: здоровое дерево при переходах не пересоздаётся.
 *
 * Устаревший чанк (вкладка старше выката, `isChunkLoadError`) — не повреждённые данные:
 * `chunkError="rethrow"` отдаёт его `RouteError` маршрута (одна перезагрузка), `"reload"` сам делает
 * одну перезагрузку (`reloadOnce(PROTOTYPE_RELOAD)`) и ничего не показывает — для меню на готовых страницах.
 */
export class ProtoBoundary extends Component<
  {
    fallback: (retry: () => void) => ReactNode;
    children: ReactNode;
    resetKey?: unknown;
    chunkError: "rethrow" | "reload";
  },
  { failed: boolean; error: unknown }
> {
  state = { failed: false, error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      if (this.props.chunkError === "reload") reloadOnce(PROTOTYPE_RELOAD);
      return;
    }
    // Для разработчика: в журнал браузера, как остальные пойманные ошибки React.
    console.error("prototype:", error, info.componentStack);
  }

  componentDidUpdate(previous: Readonly<{ resetKey?: unknown }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.retry();
  }

  retry = () => this.setState({ failed: false, error: null });

  render() {
    if (!this.state.failed) return this.props.children;
    if (isChunkLoadError(this.state.error)) {
      // Граница не ловит то, что бросила сама: ошибка уходит выше, к RouteError.
      if (this.props.chunkError === "rethrow") throw this.state.error;
      return null;
    }
    return this.props.fallback(this.retry);
  }
}

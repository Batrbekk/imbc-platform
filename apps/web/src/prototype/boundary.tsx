import { Component, type ErrorInfo, type ReactNode } from "react";

import { isChunkLoadError, type ReloadOutcome, reloadOnce } from "@/lib/reload-guard";

/**
 * Флаг одной перезагрузки из-за чанка прототипа (меню и шлюз ждут один и тот же модуль роли).
 * Не `LAZY_RELOAD`: его снимает `Root` при первом рендере, а модуль роли грузится уже после — с
 * общим флагом недоступный чанк (частичный выкат, прокси отвечает HTML или 404 на `/assets/*`)
 * перезагружал бы страницу без конца. Снимают его меню и шлюз, когда модуль загрузился;
 * то же значение — у `import()` меню в `app-shell.tsx`.
 */
export const PROTOTYPE_RELOAD = "imbc:prototype-reload";

/**
 * Граница ошибок прототипа: ошибка модуля роли (бросил экран или подпись меню, повреждённые
 * демо-данные) не доходит до `RouteError` корня, поэтому готовые страницы и меню роли остаются на месте.
 * `fallback(retry)` — что показать вместо; `retry` рисует детей заново. Смена `resetKey` (адрес)
 * снимает сбой без перемонтирования: здоровое дерево при переходах не пересоздаётся.
 *
 * Чанк не загрузился (`isChunkLoadError`) — это не повреждённые данные, `fallback` не показывается:
 * одна перезагрузка страницы (`reloadOnce(PROTOTYPE_RELOAD)`), а если она уже была — `chunkFallback`
 * (по умолчанию ничего, как в меню). Сброс демо-данных здесь не помог бы.
 */
export class ProtoBoundary extends Component<
  {
    fallback: (retry: () => void) => ReactNode;
    children: ReactNode;
    resetKey?: unknown;
    chunkFallback?: ReactNode;
  },
  { failed: boolean; error: unknown; reload: ReloadOutcome | null }
> {
  state = { failed: false, error: null as unknown, reload: null as ReloadOutcome | null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      this.setState({ reload: reloadOnce(PROTOTYPE_RELOAD) });
      return;
    }
    // Для разработчика: в журнал браузера, как остальные пойманные ошибки React.
    console.error("prototype:", error, info.componentStack);
  }

  componentDidUpdate(previous: Readonly<{ resetKey?: unknown }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.retry();
  }

  retry = () => this.setState({ failed: false, error: null, reload: null });

  render() {
    if (!this.state.failed) return this.props.children;
    if (isChunkLoadError(this.state.error)) {
      // Страница перезагружается (или решение ещё не принято) — пусто; перезагрузка уже была — сообщение.
      if (this.state.reload === null || this.state.reload === "reloaded") return null;
      return this.props.chunkFallback ?? null;
    }
    return this.props.fallback(this.retry);
  }
}

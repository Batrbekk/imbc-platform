import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Граница ошибок прототипа: ошибка модуля роли (не загрузился чанк, бросил экран или подпись меню)
 * не доходит до `RouteError` корня, поэтому готовые страницы и меню роли остаются на месте.
 * `fallback(retry)` — что показать вместо; `retry` рисует детей заново.
 */
export class ProtoBoundary extends Component<
  { fallback: (retry: () => void) => ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // Для разработчика: в журнал браузера, как остальные пойманные ошибки React.
    console.error("prototype:", error, info.componentStack);
  }

  retry = () => this.setState({ failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.retry) : this.props.children;
  }
}

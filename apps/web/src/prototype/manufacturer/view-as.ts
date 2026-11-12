// Переключатель ведущего «показать как»: какой профиль общих данных открыт в кабинете. Это не
// действие пользователя платформы: выбор живёт в адресе (`?as=`) и в памяти модуля, не в хранилище,
// и не пишется в журнал.
import { useEffect, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";

import type { ProtoProfile } from "../data";
import { useActor, useProto } from "../store";

/** Профили для показа всего пути: свой Verified, остальные статусы раздела 6.3 и актуальности. */
export const VIEW_AS_OPTIONS = ["p01", "p02", "p07", "p04", "p03", "p12", "p09", "p11", "p10"] as const;

export const VIEW_AS_PARAM = "as";

let chosen: string | null = null;
const listeners = new Set<() => void>();

function setChosen(id: string | null) {
  chosen = id;
  for (const listener of listeners) listener();
}

/** Для тестов: забыть выбор ведущего. */
export function resetViewAs(): void {
  setChosen(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isOption = (value: string | null): value is string =>
  value !== null && (VIEW_AS_OPTIONS as readonly string[]).includes(value);

/**
 * Профиль, с которым работает кабинет: выбранный ведущим или профиль организации сеанса
 * (`useActor().organizationId`). Действия всегда относятся к этому профилю.
 */
export function useViewedProfile(): { profile: ProtoProfile; own: boolean; select: (id: string) => void } {
  const actor = useActor();
  const [params, setParams] = useSearchParams();
  const remembered = useSyncExternalStore(
    subscribe,
    () => chosen,
    () => chosen,
  );
  const fromAddress = params.get(VIEW_AS_PARAM);
  const id = isOption(fromAddress) ? fromAddress : remembered;

  useEffect(() => {
    if (isOption(fromAddress) && fromAddress !== chosen) setChosen(fromAddress);
  }, [fromAddress]);

  const profiles = useProto((s) => s.profiles);
  const own = profiles.find((p) => p.organizationId === actor.organizationId);
  const profile = profiles.find((p) => p.id === id) ?? own ?? profiles[0]!;

  const select = (next: string) => {
    setChosen(next);
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        copy.set(VIEW_AS_PARAM, next);
        return copy;
      },
      { replace: true },
    );
  };
  return { profile, own: profile.organizationId === actor.organizationId, select };
}

/** Адрес экрана кабинета с текущим выбором ведущего: ссылка открывает тот же профиль. */
export function useWithViewAs(): (href: string) => string {
  const [params] = useSearchParams();
  const fromAddress = params.get(VIEW_AS_PARAM);
  return (href) => (isOption(fromAddress) ? `${href}?${VIEW_AS_PARAM}=${fromAddress}` : href);
}

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

/** Выбор ведущего вместе с аккаунтом, при котором он сделан: другой вход в той же вкладке его не видит. */
let chosen: { accountId: string | null; profileId: string } | null = null;
const listeners = new Set<() => void>();

function setChosen(next: typeof chosen) {
  chosen = next;
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
  const accountId = actor.accountId;
  const id = isOption(fromAddress) ? fromAddress : remembered?.accountId === accountId ? remembered.profileId : null;

  useEffect(() => {
    if (isOption(fromAddress) && (chosen?.profileId !== fromAddress || chosen.accountId !== accountId))
      setChosen({ accountId, profileId: fromAddress });
  }, [fromAddress, accountId]);

  const profiles = useProto((s) => s.profiles);
  const own = profiles.find((p) => p.organizationId === actor.organizationId);
  const profile = profiles.find((p) => p.id === id) ?? own ?? profiles[0]!;

  const select = (next: string) => {
    setChosen({ accountId, profileId: next });
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

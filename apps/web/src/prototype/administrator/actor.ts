import { ACCOUNT } from "@/prototype/data/accounts";
import { type AuditInput, getProtoState, type ProtoState, useActor, useProtoUpdate } from "@/prototype/store";

/**
 * Ключ демо-аккаунта, от имени которого администратор пишет записи (`issuedBy`, `publishedBy`…) и
 * который считается «своим» (его нельзя заблокировать). Общий слой всегда даёт демо-аккаунт;
 * запасной вариант — аккаунт администратора seed.
 */
export function useAdminAccountId(): string {
  return useActor().accountId ?? ACCOUNT.administrator;
}

/**
 * Правка с журналом, которая не делает ничего, если её записи уже нет (например, другая вкладка
 * сбросила демо-данные, пока был открыт диалог): ни ошибки, ни события журнала. Рецепт возвращает
 * `false`, когда менять нечего; сначала он пробуется на копии текущего состояния.
 */
export function useGuardedUpdate(): (audit: AuditInput, recipe: (draft: ProtoState) => boolean) => boolean {
  const update = useProtoUpdate();
  return (audit, recipe) => {
    if (!recipe(structuredClone(getProtoState()))) return false;
    update(audit, (draft) => {
      recipe(draft);
    });
    return true;
  };
}

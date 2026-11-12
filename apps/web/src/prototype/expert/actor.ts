import { ACCOUNT } from "@/prototype/data/accounts";
import { useActor } from "@/prototype/store";

/**
 * Ключ аккаунта SME для записей (`decidedBy`, `authorId`, `recordedBy`): только демо-аккаунт.
 * Сеанс не из демо-данных — демо-SME seed; адрес и имя сеанса в хранилище не попадают.
 */
export function useExpertId(): string {
  return useActor().accountId ?? ACCOUNT.expert;
}

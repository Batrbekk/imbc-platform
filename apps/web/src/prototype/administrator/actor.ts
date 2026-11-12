import { ACCOUNT } from "@/prototype/data/accounts";
import { useActor } from "@/prototype/store";

/**
 * Ключ демо-аккаунта, от имени которого администратор пишет записи (`issuedBy`, `publishedBy`…).
 * Сеанс не из демо-данных — аккаунт администратора seed: почта и имя сеанса в хранилище не попадают.
 */
export function useAdminAccountId(): string {
  return useActor().accountId ?? ACCOUNT.administrator;
}

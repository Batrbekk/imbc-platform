import type { ExternalCheck, ProtoState } from "@/prototype/data";
import { dueDiligence as SOURCE_DD, ddResultOf } from "@/prototype/data/due-diligence";
import { externalChecks as SOURCE_CHECKS } from "@/prototype/data/external-checks";
import { newId } from "@/prototype/store";

/**
 * Имитация запуска проверок: Adata не вызывается никогда. Ответ «источника» — исходные демо-данные
 * этого профиля (`data/due-diligence.ts`, `data/external-checks.ts`), то есть каталог IMBC-10
 * с теми же значениями. Квота заказчика (IMBC-07) не расходуется.
 */

/** Повторный запуск due diligence (IMBC-13): строки и итог по строкам заново, время — сейчас. */
export function rerunDueDiligence(draft: ProtoState, profileId: string, at: string): void {
  const record = draft.dueDiligence.find((d) => d.profileId === profileId);
  if (!record) return;
  const source = SOURCE_DD.find((d) => d.profileId === profileId);
  const checks = structuredClone(source?.checks ?? record.checks);
  const autoResult = ddResultOf(checks);
  record.checks = checks;
  record.checkedAt = at;
  record.autoResult = autoResult;
  // Результат коннектора задаёт итог записи (EXT-03); прежнее решение SME снимается.
  record.result = autoResult;
  record.resultSetBy = null;
  draft.externalChecks.push({
    id: newId("ext"),
    profileId,
    connector: "adata",
    status: "ok",
    result: autoResult,
    source: "Adata",
    at,
    testData: true,
  });
}

/**
 * Запуск всех коннекторов (EXT-01, EXT-03): Adata — как due diligence; e-Ondiris читает локальную
 * копию (EXT-02) — по данным профиля; остальные — заглушки с тестовыми данными. Недоступный
 * в исходных данных сервис остаётся недоступным (EXT-04).
 */
export function runExternalChecks(draft: ProtoState, profileId: string, at: string): void {
  const profile = draft.profiles.find((p) => p.id === profileId);
  if (!profile) return;
  rerunDueDiligence(draft, profileId, at);
  const unavailable = (connector: ExternalCheck["connector"]) =>
    SOURCE_CHECKS.some((c) => c.profileId === profileId && c.connector === connector && c.status === "unavailable");
  const registry = profile.sections.products.find((p) => p.registry)?.registry ?? null;
  const results: Omit<ExternalCheck, "id" | "profileId" | "at">[] = [
    {
      connector: "e_ondiris",
      status: "ok",
      result: registry ? `${registry.entryNumber} · ${registry.inclusionDate}` : "Записей в реестре нет",
      source: "Локальная копия e-Ondiris",
      testData: false,
    },
    {
      connector: "legal_registry",
      status: "ok",
      result: "Действующее юрлицо",
      source: "Реестр юрлиц (заглушка)",
      testData: true,
    },
    unavailable("accounting")
      ? {
          connector: "accounting",
          status: "unavailable",
          result: "—",
          source: "Учётный сервис (заглушка)",
          testData: true,
        }
      : {
          connector: "accounting",
          status: "ok",
          result: "Отчётность сдана",
          source: "Учётный сервис (заглушка)",
          testData: true,
        },
  ];
  for (const r of results) draft.externalChecks.push({ id: newId("ext"), profileId, at, ...r });
}

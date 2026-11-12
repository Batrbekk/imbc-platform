// Выгрузка результатов поиска директора — та же выгрузка платформы, что у оператора: раскладка раздела 9.2
// (DATA-09, строка на продуктовую линию, все стандартные колонки), CSV по DATA-10, экранирование формул
// (DATA-12), без итога due diligence, названий операторов и заметок (DATA-13). Сборщик — `operator/export-file`;
// список профилей — отфильтрованный список директора (все профили, раздел 4), видимость здесь не применяется.
// Только файл в этом браузере: хранилище не меняется (GEN-04).
import type { CapacityUnit, Locale } from "@imbc/contracts";

import type { ProtoProfile, ProtoState } from "@/prototype/data";
import { translate } from "@/prototype/i18n";
import { commonTexts } from "@/prototype/labels";
import { ALL_COLUMNS, downloadFile, exportTable, toCsv } from "@/prototype/operator/export-file";
import { texts as exportTexts } from "@/prototype/operator/texts";
import { nowIso } from "@/prototype/store";

import { almatyDay } from "./paths";

/** Содержимое CSV: подписи колонок и значений — на языке интерфейса. */
export function profilesCsv(state: ProtoState, rows: ProtoProfile[], locale: Locale): string {
  const tr = (key: keyof (typeof exportTexts)["en"], values?: Record<string, string>) =>
    translate(exportTexts, locale, key, values);
  const table = exportTable(
    state,
    rows,
    ALL_COLUMNS,
    {
      column: (c) => tr(`col.${c}`),
      yes: tr("yes"),
      no: tr("no"),
      tier: (tier) => translate(commonTexts, locale, `tier.${tier}`),
      perYear: (value, unit) => tr("perYear", { value, unit: tr(`unit.${unit as CapacityUnit}`) }),
    },
    locale,
  );
  return toCsv(table);
}

/** Имя файла с датой по Алматы (DATA-08), как у дат на страницах. */
export function csvFileName(at: string = nowIso()): string {
  return `imbc-profiles-${almatyDay(at)}.csv`;
}

export function downloadCsv(name: string, content: string): void {
  downloadFile(name, content, "csv");
}

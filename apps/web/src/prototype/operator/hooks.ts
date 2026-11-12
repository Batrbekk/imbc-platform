// Общие хуки кабинета оператора: кто действует (по ключу демо-аккаунта) и сборка файла выгрузки.
import type { CapacityUnit } from "@imbc/contracts";

import { ACCOUNT } from "../data/accounts";
import { useCommonTexts } from "../labels";
import { translate, useProtoLocale } from "../i18n";
import { getProtoState, useActor } from "../store";
import { type Column, exportTable, type FileMeta, toCsv, xlsxParts, zipStored } from "./export-file";
import { parseFilters, searchProfiles, type SearchFilters } from "./scope";
import { texts } from "./texts";

/**
 * Организация и аккаунт сеанса в демо-данных. Людей храним только ключами демо-аккаунтов:
 * email и имя сеанса не попадают ни в данные, ни на экран; сеанс не из демо-данных — аккаунт seed.
 */
export function useOperator() {
  const actor = useActor();
  return { organizationId: actor.organizationId, accountId: actor.accountId ?? ACCOUNT.operator };
}

/** Описание сохранённого поиска для людей: «Группа B · KZ-ATY · Tier 2» или «Все видимые производители». */
export function useDescribeFilters() {
  const locale = useProtoLocale();
  const common = useCommonTexts();
  return (filters: SearchFilters | string) => {
    const f = typeof filters === "string" ? parseFilters(filters) : filters;
    const parts = [
      f.q && `“${f.q}”`,
      f.group && translate(texts, locale, "groupValue", { group: f.group }),
      f.region,
      f.tier && common(`tier.${f.tier}`),
      f.surveyed && translate(texts, locale, "surveyedFilter"),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : translate(texts, locale, "allManufacturers");
  };
}

type TextKey = keyof (typeof texts)["en"];

export interface BuiltFile {
  name: string;
  rows: number;
  format: "csv" | "xlsx";
  content: string | Uint8Array<ArrayBuffer>;
}

/** Собирает файл выгрузки по фильтрам и колонкам из текущих демо-данных (OPR-14, DATA-09…DATA-12). */
export function useBuildExport() {
  const locale = useProtoLocale();
  const common = useCommonTexts();
  return (filtersString: string, columns: Column[], fileFormat: "csv" | "xlsx"): BuiltFile => {
    const state = getProtoState();
    const tr = (key: TextKey, values?: Record<string, string>) => translate(texts, locale, key, values);
    const table = exportTable(
      state,
      searchProfiles(state, parseFilters(filtersString)),
      columns,
      {
        column: (c) => tr(`col.${c}`),
        yes: tr("yes"),
        no: tr("no"),
        tier: (tier) => common(`tier.${tier}`),
        perYear: (value, unit) => tr("perYear", { value, unit: tr(`unit.${unit as CapacityUnit}`) }),
      },
      locale,
    );
    const takenAt = new Date().toISOString();
    const name = `imbc-export-${takenAt.slice(0, 10)}.${fileFormat}`;
    if (fileFormat === "csv") return { name, rows: table.rows.length, format: fileFormat, content: toCsv(table) };
    const meta: FileMeta = {
      takenAt,
      filters: filtersString,
      labels: {
        version: tr("metaVersion"),
        takenAt: tr("metaTakenAt"),
        rows: tr("metaRows"),
        filters: tr("metaFilters"),
        sheet: tr("sheetData"),
        about: tr("sheetAbout"),
      },
    };
    return { name, rows: table.rows.length, format: fileFormat, content: zipStored(xlsxParts(table, meta)) };
  };
}

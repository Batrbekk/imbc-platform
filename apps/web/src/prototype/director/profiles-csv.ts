// Выгрузка списка профилей директора в CSV по DATA-10: UTF-8 с BOM, «;», кавычки по RFC 4180, строка
// заголовка, даты ISO 8601. Без итога due diligence, названий операторов и заметок (DATA-13). Только файл в
// этом браузере: хранилище не меняется (GEN-04).
import type { ProtoProfile, ProtoState } from "@/prototype/data";
import { referenceLabel } from "@/prototype/expert/dossier";
import { profileTier, tier3ProductIds, worksWithCount } from "@/prototype/rules";

export const CSV_COLUMNS = [
  "bin",
  "nameRu",
  "nameEn",
  "region",
  "status",
  "pendingChanges",
  "updateStatus",
  "tier",
  "tier3",
  "worksWith",
  "registeredAt",
  "verifiedAt",
  "ddCheckedAt",
] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];

export interface CsvWords {
  column: (column: CsvColumn) => string;
  status: (profile: ProtoProfile) => string;
  updateStatus: (profile: ProtoProfile) => string;
  tier: (profile: ProtoProfile) => string;
  yes: string;
  no: string;
}

/** Метка порядка байтов UTF-8 (DATA-10). */
const BOM = "\uFEFF";

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

function cell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function profilesCsv(state: ProtoState, rows: ProtoProfile[], words: CsvWords): string {
  const value = (p: ProtoProfile, column: CsvColumn): string => {
    switch (column) {
      case "bin":
        return p.bin;
      case "nameRu":
        return p.nameRu;
      case "nameEn":
        return p.nameEn;
      case "region":
        return referenceLabel(state, "regions", p.sections.main.region);
      case "status":
        return words.status(p);
      case "pendingChanges":
        return p.pendingChanges ? words.yes : words.no;
      case "updateStatus":
        return words.updateStatus(p);
      case "tier":
        return profileTier(state, p) ? words.tier(p) : "";
      case "tier3":
        return String(tier3ProductIds(state, p.id).length);
      case "worksWith":
        return String(worksWithCount(state, p.id));
      case "registeredAt":
        return day(p.registeredAt);
      case "verifiedAt":
        return day(p.verifiedAt);
      case "ddCheckedAt":
        return day(state.dueDiligence.find((d) => d.profileId === p.id)?.checkedAt);
    }
  };
  const lines = [
    CSV_COLUMNS.map((c) => cell(words.column(c))).join(";"),
    ...rows.map((p) => CSV_COLUMNS.map((c) => cell(value(p, c))).join(";")),
  ];
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** Скачивание файла: ссылка на Blob в этом браузере, в сеть ничего не уходит. В jsdom без `createObjectURL` — ничего. */
export function downloadCsv(name: string, content: string): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

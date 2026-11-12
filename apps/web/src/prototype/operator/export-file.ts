// Файл выгрузки, собранный в браузере из демо-данных (OPR-14, DATA-09…DATA-13). Ничего не уходит в сеть.
import type { ProfileTier } from "@imbc/contracts";

import type { ProtoProfile, ProtoState } from "../data";
import { isSiteSurveyed, profileTier, tier3ProductIds, worksWithCount } from "../rules";

/** Стандартные колонки по группам раздела 9.2 (DATA-09). Порядок — порядок в файле. */
export const COLUMN_GROUPS = {
  company: ["bin", "nameEn", "nameRu", "region", "address", "website", "companyEmail", "companyPhone"],
  focal: ["focalName", "focalPosition", "focalEmail", "focalPhone"],
  activity: ["oked", "commodityGroup", "commodityType", "productName", "tnved", "kpved", "capacity"],
  production: ["workshops", "utilisation"],
  personnel: ["headcount"],
  checks: [
    "certificates",
    "siteSurveyed",
    "tier",
    "unifiedRegister",
    "worksWith",
    "verifiedAt",
    "ddCheckedAt",
    "pendingChanges",
  ],
} as const;

export type ColumnGroup = keyof typeof COLUMN_GROUPS;
export type Column = (typeof COLUMN_GROUPS)[ColumnGroup][number];
export const ALL_COLUMNS: Column[] = Object.values(COLUMN_GROUPS).flat();

/** Версия раскладки файла (DATA-11): лист «О файле». */
export const FILE_CONTRACT_VERSION = "1.0";

export type Cell =
  { kind: "text"; value: string } | { kind: "number"; value: number } | { kind: "date"; value: string };

export interface ExportTable {
  header: string[];
  rows: Cell[][];
}

const text = (value: string | null | undefined): Cell => ({ kind: "text", value: value ?? "" });
const date = (iso: string | null | undefined): Cell => (iso ? { kind: "date", value: iso.slice(0, 10) } : text(""));
const num = (value: number | null | undefined): Cell =>
  value === null || value === undefined ? text("") : { kind: "number", value };

/** Подписи значений в файле: «да/нет», тиры, единицы мощности — на языке выгрузки. */
export interface ExportWords {
  column: (column: Column) => string;
  yes: string;
  no: string;
  tier: (tier: ProfileTier | "tier_3") => string;
  perYear: (value: string, unit: string) => string;
}

/**
 * Таблица выгрузки: строка на продуктовую линию (DATA-09). Значения — последние верифицированные
 * (`sections`, OPR-11); ожидающих значений, заметок, итога due diligence и названий операторов нет
 * (DATA-13). Тир строки — tier 3, если продукт tier 3 (IMBC-21, оператору видно), иначе тир профиля.
 */
export function exportTable(
  state: ProtoState,
  profiles: ProtoProfile[],
  columns: Column[],
  words: ExportWords,
  locale: "en" | "ru" | "kk",
): ExportTable {
  const majors = state.organizations.filter((o) => o.majorOperator).length;
  const rows: Cell[][] = [];
  for (const p of profiles) {
    const { main, contacts, products, production, personnel, certificates } = p.sections;
    const focal = contacts.find((c) => c.focalPoint);
    const tier = profileTier(state, p);
    const tier3 = new Set(tier3ProductIds(state, p.id));
    const surveys = state.siteSurveys
      .filter((s) => s.profileId === p.id && s.result)
      .sort((a, b) => a.visitTo.localeCompare(b.visitTo));
    const lastVisit = surveys.at(-1)?.visitTo ?? null;
    const surveyed = isSiteSurveyed(state, p.id);
    const headcount = [personnel.managers, personnel.office, personnel.production].every((n) => n === null)
      ? null
      : (personnel.managers ?? 0) + (personnel.office ?? 0) + (personnel.production ?? 0);
    const dd = state.dueDiligence.find((d) => d.profileId === p.id);
    for (const line of products) {
      const values: Record<Column, Cell> = {
        bin: text(p.bin),
        nameEn: text(p.nameEn),
        nameRu: text(p.nameRu),
        region: text(main.region),
        address: text(main.legalAddress),
        website: text(main.website),
        companyEmail: text(main.contactEmail),
        companyPhone: text(main.companyPhone),
        focalName: text(focal?.fullName),
        focalPosition: text(focal?.position),
        focalEmail: text(focal?.email),
        focalPhone: text(focal?.phone),
        oked: text(main.okedCodes.join(" | ")),
        commodityGroup: text(line.group),
        commodityType: text(line.commodityType),
        productName: text(locale === "en" ? line.nameEn : line.nameRu),
        tnved: text(line.tnved),
        kpved: text(line.kpved),
        capacity: text(
          line.capacity.kind === "registry"
            ? line.capacity.text
            : words.perYear(String(line.capacity.value), line.capacity.unit),
        ),
        workshops: num(production.workshops),
        utilisation: num(production.utilisationPct),
        headcount: num(headcount),
        certificates: text(
          certificates
            .filter((c) => c.status === "verified")
            .map((c) => (c.expiresOn ? `${c.type} (${c.expiresOn})` : c.type))
            .join(" | "),
        ),
        siteSurveyed: text(surveyed ? `${words.yes}${lastVisit ? ` (${lastVisit})` : ""}` : words.no),
        tier: text(tier3.has(line.id) ? words.tier("tier_3") : tier ? words.tier(tier) : ""),
        unifiedRegister: text(main.unifiedRegister.registered ? words.yes : words.no),
        worksWith: text(`${worksWithCount(state, p.id)}/${majors}`),
        verifiedAt: date(p.verifiedAt),
        ddCheckedAt: date(dd?.checkedAt),
        pendingChanges: text(p.pendingChanges ? words.yes : words.no),
      };
      rows.push(columns.map((c) => values[c]));
    }
  }
  return { header: columns.map(words.column), rows };
}

/** DATA-12: значение, начинающееся с =, +, −, - или @, экранируется апострофом. */
export function escapeFormula(value: string): string {
  return /^[=+\-−@]/.test(value) ? `'${value}` : value;
}

function cellText(cell: Cell): string {
  return cell.kind === "number" ? String(cell.value) : cell.kind === "date" ? cell.value : escapeFormula(cell.value);
}

const BOM = "\uFEFF";

/** CSV по DATA-10: UTF-8 с BOM, «;», кавычки по RFC 4180, строка заголовка, даты ISO 8601. */
export function toCsv(table: ExportTable): string {
  const field = (value: string) => (/[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [
    table.header.map((h) => field(escapeFormula(h))).join(";"),
    ...table.rows.map((row) => row.map((cell) => field(cellText(cell))).join(";")),
  ];
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** Лист «О файле» XLSX (DATA-11): версия раскладки, время данных, число строк, фильтры. */
export interface FileMeta {
  takenAt: string;
  filters: string;
  labels: { version: string; takenAt: string; rows: string; filters: string; sheet: string; about: string };
}

const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** Дата ISO → серийный номер Excel (DATA-11: даты — ячейки даты). */
function excelSerial(isoDate: string): number {
  return Math.round(
    (Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10)) - Date.UTC(1899, 11, 30)) /
      86_400_000,
  );
}

function sheetXml(rows: Cell[][]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (cell.kind === "number") return `<c r="${ref}"><v>${cell.value}</v></c>`;
          if (cell.kind === "date") return `<c r="${ref}" s="1"><v>${excelSerial(cell.value)}</v></c>`;
          // БИН и коды — текстовые ячейки (DATA-11). Inline-строка формулой не вычисляется, поэтому
          // апостроф DATA-12 здесь не нужен: он только в CSV.
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Части книги XLSX: путь → XML. Отдельно — чтобы тест проверял содержимое без распаковки. */
export function xlsxParts(table: ExportTable, meta: FileMeta): Record<string, string> {
  const t = (value: string): Cell => ({ kind: "text", value });
  const data = [table.header.map(t), ...table.rows];
  const about: Cell[][] = [
    [t(meta.labels.version), t(FILE_CONTRACT_VERSION)],
    [t(meta.labels.takenAt), t(meta.takenAt)],
    [t(meta.labels.rows), { kind: "number", value: table.rows.length }],
    [t(meta.labels.filters), t(meta.filters)],
  ];
  const ns = "http://schemas.openxmlformats.org";
  return {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="${xml(meta.labels.sheet)}" sheetId="1" r:id="rId1"/><sheet name="${xml(meta.labels.about)}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="${ns}/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheetXml(data),
    "xl/worksheets/sheet2.xml": sheetXml(about),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Постоянные дата и время в заголовках ZIP: 1980-01-01 00:00 в формате DOS. */
const DOS_DATE = ((1980 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/** ZIP без сжатия (stored): XLSX — это ZIP с XML-частями. */
export function zipStored(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true); // имена в UTF-8
    head.setUint16(10, DOS_TIME, true);
    head.setUint16(12, DOS_DATE, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, data.length, true);
    head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    local.push(new Uint8Array(head.buffer), name, data);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(12, DOS_TIME, true);
    dir.setUint16(14, DOS_DATE, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    central.push(new Uint8Array(dir.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export const MIME = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

/** Скачивание собранного файла: ссылка на Blob в этом браузере. В jsdom `createObjectURL` нет — ничего. */
export function downloadFile(name: string, content: string | Uint8Array<ArrayBuffer>, format: keyof typeof MIME): void {
  if (typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([content], { type: MIME[format] }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

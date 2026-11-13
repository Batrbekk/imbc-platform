/**
 * Структура ZIP документа DOCX или XLSX до хранилища (DATA-06, DATA-07). ClamAV 1.4 не разбирает записи ZIP64
 * (проверено на живом clamd: EICAR в записи с ZIP64 только в локальном заголовке — «OK»), то есть такой архив
 * антивирус целиком не проверит, и платформа его не принимает. Повреждённая структура — тоже отказ: что не
 * разобрать здесь, не обязательно разберёт и антивирус. Разбор — по буферу загрузки, без распаковки.
 */

/** Почему архив не принят. Признаки ZIP64 — `zip64_*`, прочее — повреждённая или необычная структура. */
export type ZipStructureIssue =
  /** Нет записи конца центрального каталога, которая заканчивает файл (усечённый или не ZIP). */
  | 'end_record_missing'
  /** Перед записью конца каталога — локатор конца каталога ZIP64 (`0x07064b50`). */
  | 'zip64_locator'
  /** Между каталогом и записью его конца — запись конца каталога ZIP64 (`0x06064b50`). */
  | 'zip64_end_record'
  /** В записи конца каталога число записей `0xFFFF` или размер / смещение каталога `0xFFFFFFFF`. */
  | 'zip64_end_values'
  /** В записи каталога сжатый или несжатый размер, смещение `0xFFFFFFFF` либо номер диска `0xFFFF`. */
  | 'zip64_central_values'
  /** В дополнительных полях записи каталога — заголовок ZIP64 `0x0001`. */
  | 'zip64_central_extra'
  /** В локальном заголовке сжатый или несжатый размер `0xFFFFFFFF`. */
  | 'zip64_local_values'
  /** В дополнительных полях локального заголовка — заголовок ZIP64 `0x0001`. */
  | 'zip64_local_extra'
  /** Многотомный архив: номера дисков не нулевые или число записей тома не равно общему. */
  | 'multi_disk'
  /** Каталог за пределами файла, не вплотную к записи конца или не совпадает по числу записей. */
  | 'central_directory_bounds'
  /** Запись каталога без сигнатуры, за пределами каталога или с дополнительными полями за своей длиной. */
  | 'central_entry_malformed'
  /** Локальный заголовок без сигнатуры, за пределами данных или с дополнительными полями за своей длиной. */
  | 'local_header_malformed'
  /** Данные двух записей перекрываются (так строят архивные бомбы). */
  | 'entries_overlap';

const SIGNATURE = {
  local: 0x04034b50,
  central: 0x02014b50,
  end: 0x06054b50,
  zip64End: 0x06064b50,
  zip64Locator: 0x07064b50,
} as const;
const ZIP64_EXTRA_ID = 0x0001;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const END_RECORD = 22;
const CENTRAL_HEADER = 46;
const LOCAL_HEADER = 30;
const ZIP64_LOCATOR = 20;

/**
 * Запись конца каталога, которая заканчивает файл: от конца назад, с комментарием ровно до последнего байта.
 * Нет такой — -1.
 */
function findEndRecord(bytes: Buffer): number {
  const last = bytes.length - END_RECORD;
  for (let at = last; at >= 0 && at >= last - U16_MAX; at--) {
    if (bytes.readUInt32LE(at) === SIGNATURE.end && at + END_RECORD + bytes.readUInt16LE(at + 20) === bytes.length)
      return at;
  }
  return -1;
}

/**
 * Дополнительные поля `[start, start + length)`: последовательность «id (2), размер (2), данные». Поле, которое
 * выходит за свою область, — повреждение; заголовок ZIP64 — признак ZIP64. Хвост короче заголовка поля (выравнивание
 * нулями) полем не считается.
 */
function extraFieldsIssue(bytes: Buffer, start: number, length: number): 'zip64' | 'malformed' | null {
  const end = start + length;
  for (let at = start; at + 4 <= end;) {
    const id = bytes.readUInt16LE(at);
    const size = bytes.readUInt16LE(at + 2);
    if (at + 4 + size > end) return 'malformed';
    if (id === ZIP64_EXTRA_ID) return 'zip64';
    at += 4 + size;
  }
  return null;
}

/**
 * Проверка структуры ZIP по буферу: null — архив без ZIP64 и с целой структурой (центральный каталог вплотную
 * к записи своего конца, каждая запись каталога и её локальный заголовок в пределах файла, данные записей не
 * перекрываются). Иначе — первый найденный признак. Локальные заголовки проверяются обязательно: Python
 * с `force_zip64` пишет ZIP64 только в локальный заголовок, а в каталоге размеры обычные.
 */
export function zipStructureIssue(bytes: Buffer): ZipStructureIssue | null {
  const end = findEndRecord(bytes);
  if (end === -1) return 'end_record_missing';
  if (end >= ZIP64_LOCATOR && bytes.readUInt32LE(end - ZIP64_LOCATOR) === SIGNATURE.zip64Locator)
    return 'zip64_locator';

  const disk = bytes.readUInt16LE(end + 4);
  const directoryDisk = bytes.readUInt16LE(end + 6);
  const diskEntries = bytes.readUInt16LE(end + 8);
  const entries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (diskEntries === U16_MAX || entries === U16_MAX || directorySize === U32_MAX || directoryOffset === U32_MAX)
    return 'zip64_end_values';
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== entries) return 'multi_disk';

  const directoryEnd = directoryOffset + directorySize;
  if (directoryEnd !== end) {
    // Между каталогом и записью его конца — только записи ZIP64 (в обычном архиве промежутка нет).
    if (directoryEnd < end && directoryEnd + 4 <= end && bytes.readUInt32LE(directoryEnd) === SIGNATURE.zip64End)
      return 'zip64_end_record';
    return 'central_directory_bounds';
  }

  const records: { start: number; end: number }[] = [];
  let at = directoryOffset;
  for (let index = 0; index < entries; index++) {
    if (at + CENTRAL_HEADER > end || bytes.readUInt32LE(at) !== SIGNATURE.central) return 'central_entry_malformed';
    const compressed = bytes.readUInt32LE(at + 20);
    const uncompressed = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const diskStart = bytes.readUInt16LE(at + 34);
    const localOffset = bytes.readUInt32LE(at + 42);
    const next = at + CENTRAL_HEADER + nameLength + extraLength + commentLength;
    if (next > end) return 'central_entry_malformed';
    if (compressed === U32_MAX || uncompressed === U32_MAX || localOffset === U32_MAX || diskStart === U16_MAX)
      return 'zip64_central_values';
    if (diskStart !== 0) return 'multi_disk';
    const centralExtra = extraFieldsIssue(bytes, at + CENTRAL_HEADER + nameLength, extraLength);
    if (centralExtra === 'zip64') return 'zip64_central_extra';
    if (centralExtra === 'malformed') return 'central_entry_malformed';

    // Локальный заголовок этой записи и её данные — до начала каталога.
    if (localOffset + LOCAL_HEADER > directoryOffset || bytes.readUInt32LE(localOffset) !== SIGNATURE.local)
      return 'local_header_malformed';
    const localCompressed = bytes.readUInt32LE(localOffset + 18);
    const localUncompressed = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    if (localCompressed === U32_MAX || localUncompressed === U32_MAX) return 'zip64_local_values';
    const localExtraStart = localOffset + LOCAL_HEADER + localNameLength;
    if (localExtraStart + localExtraLength > directoryOffset) return 'local_header_malformed';
    const localExtra = extraFieldsIssue(bytes, localExtraStart, localExtraLength);
    if (localExtra === 'zip64') return 'zip64_local_extra';
    if (localExtra === 'malformed') return 'local_header_malformed';
    // Размер данных — из каталога: при дескрипторе данных (бит 3) в локальном заголовке нули.
    const dataEnd = localExtraStart + localExtraLength + compressed;
    if (dataEnd > directoryOffset) return 'local_header_malformed';
    records.push({ start: localOffset, end: dataEnd });
    at = next;
  }
  if (at !== end) return 'central_directory_bounds';

  records.sort((a, b) => a.start - b.start);
  for (let index = 1; index < records.length; index++)
    if (records[index]!.start < records[index - 1]!.end) return 'entries_overlap';
  return null;
}

import { constants as zlib, inflateRawSync } from 'node:zlib';

/**
 * Структура ZIP документа DOCX или XLSX до хранилища (DATA-06, DATA-07). Антивирус и Office читают архив
 * по-разному: Word, Excel, LibreOffice и .NET — по центральному каталогу, а libclamav (`unzip.c`) при сброшенном
 * бите 3 флагов берёт размеры и метод сжатия из локального заголовка и запись с нулевым или «переполняющим»
 * размером пропускает. Запись, у которой локальный заголовок расходится с каталогом, может пройти мимо антивируса и
 * быть прочитана Office (ZIP64 — частный случай: на живом clamd EICAR в записи с ZIP64 только в локальном
 * заголовке — «OK»). Поэтому платформа принимает только архив, который обе стороны читают одинаково: без ZIP64,
 * без комментария, с совпадающими локальными заголовками и записями каталога, записи идут вплотную от начала файла
 * до каталога. Вложенный архив (DOCX с диаграммой хранит XLSX) clamd разбирает тем же кодом — он проверяется той же
 * функцией, рекурсивно, с пределами глубины, числа пакетов и объёма распаковки на файл. Разбор — по буферу;
 * распаковываются только начала сжатых записей и вложенные пакеты, с жёстким пределом вывода.
 */

/** Почему архив не принят — для журнала и тестов; клиенту уходит один код `file_structure_unsupported`. */
export type ZipStructureIssue =
  /** В последних 64 КиБ нет целой записи конца каталога (усечённый архив или не ZIP). */
  | 'end_record_missing'
  /**
   * Запись конца каталога не занимает ровно последние 22 байта файла с пустым комментарием: у архива комментарий,
   * после записи есть байты или в комментарии подделана вторая запись. Office комментарий не пишет.
   */
  | 'archive_comment'
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
  /** Шифрование: бит 0, 6 или 13 флагов в локальном заголовке или в записи каталога. */
  | 'encrypted'
  /** Бит 3 флагов (описатель данных) в локальном заголовке и в записи каталога не совпадает. */
  | 'descriptor_flag_mismatch'
  /** Метод сжатия в локальном заголовке и в записи каталога не совпадает. */
  | 'method_mismatch'
  /** Метод сжатия не 0 (stored) и не 8 (deflate). */
  | 'method_unsupported'
  /**
   * Размеры в локальном заголовке расходятся с каталогом: без описателя данных — не равны, с описателем — не нули
   * и не равны.
   */
  | 'local_sizes_mismatch'
  /**
   * Несжатая (stored) запись, у которой сжатый и несжатый размеры в каталоге различаются: данные такой записи
   * читатели берут по разной длине.
   */
  | 'stored_sizes_mismatch'
  /** Данные двух записей перекрываются (так строят архивные бомбы). */
  | 'entries_overlap'
  /** В каталоге нет ни одной записи. */
  | 'directory_empty'
  /**
   * В каталоге нет записи `[Content_Types].xml` в корне (точное имя): тип файла определён по содержимому как DOCX
   * или XLSX, и проверенный каталог должен описывать тот же пакет Office.
   */
  | 'content_types_missing'
  /**
   * Записи не идут вплотную от начала файла до каталога: байты до первой записи, между записями (после данных и
   * описателя данных) или между последней записью и каталогом. Там может лежать запись вне каталога, которую
   * читатель по локальным заголовкам увидит, а читатель по каталогу — нет.
   */
  | 'entries_gap'
  /**
   * Сжатые данные записи не читаются так, как заявлены: поток deflate испорчен, первый КиБ сжатых данных не даёт
   * и 4 байт, а поток длиннее; у вложенного пакета поток оборван или распакованный размер не равен размеру в каталоге.
   */
  | 'entry_data_malformed'
  /** Вложенный пакет глубже `MAX_NESTED_DEPTH` уровней вложения. */
  | 'nested_too_deep'
  /** Вложенных пакетов в файле больше `MAX_NESTED_PACKAGES`. */
  | 'nested_too_many'
  /** Распакованных данных (начала записей и вложенные пакеты) в файле больше `MAX_INFLATED_BYTES`. */
  | 'inflate_limit'
  /** Записей в файле и всех вложенных в него пакетах вместе больше `MAX_ARCHIVE_ENTRIES`. */
  | 'entries_too_many';

/** Глубина вложения пакетов: файл — 0, пакет в нём — 1, пакет в пакете — 2; глубже — `nested_too_deep`. */
export const MAX_NESTED_DEPTH = 2;
/** Вложенных пакетов на файл, на всех уровнях вместе; больше — `nested_too_many`. */
export const MAX_NESTED_PACKAGES = 32;
/** Распакованных байтов на файл: начала сжатых записей и вложенные пакеты всех уровней; больше — `inflate_limit`. */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;
/**
 * Записей на файл — в нём и во всех вложенных пакетах вместе, столько, сколько вмещает один архив без ZIP64; больше —
 * `entries_too_many`. Без этого предела файл в 2 МБ с дюжиной вложенных пакетов по 65 534 записи занимал бы процессор
 * на секунду: каждая запись — разбор заголовков и распаковка начала данных.
 */
export const MAX_ARCHIVE_ENTRIES = 65_535;

/** Остаток пределов проверки одного файла: общий для файла и всех вложенных в него пакетов, уменьшается по ходу. */
export interface InflateBudget {
  remainingBytes: number;
  remainingPackages: number;
  remainingEntries: number;
}

/** Пределы на новый файл: `MAX_INFLATED_BYTES` байтов, `MAX_NESTED_PACKAGES` пакетов, `MAX_ARCHIVE_ENTRIES` записей. */
export function createInflateBudget(): InflateBudget {
  return {
    remainingBytes: MAX_INFLATED_BYTES,
    remainingPackages: MAX_NESTED_PACKAGES,
    remainingEntries: MAX_ARCHIVE_ENTRIES,
  };
}

const SIGNATURE = {
  local: 0x04034b50,
  central: 0x02014b50,
  end: 0x06054b50,
  zip64End: 0x06064b50,
  zip64Locator: 0x07064b50,
  descriptor: 0x08074b50,
} as const;
const ZIP64_EXTRA_ID = 0x0001;
const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const END_RECORD = 22;
const CENTRAL_HEADER = 46;
const LOCAL_HEADER = 30;
const ZIP64_LOCATOR = 20;
/** Бит 0 — шифрование, бит 6 — сильное шифрование, бит 13 — зашифрованный каталог (маскирует локальные заголовки). */
const ENCRYPTION_FLAGS = 0x0001 | 0x0040 | 0x2000;
/** Бит 3 — размеры и CRC в описателе данных после записи, в локальном заголовке нули. */
const DESCRIPTOR_FLAG = 0x0008;
const STORED = 0;
const DEFLATE = 8;
/** Описание типов частей пакета Office (OPC) — обязательная запись в корне DOCX и XLSX. */
const CONTENT_TYPES = Buffer.from('[Content_Types].xml', 'latin1');
/** Описатель данных после записи с битом 3: CRC и два размера (12 байт), с сигнатурой впереди — 16. */
const DESCRIPTOR = 12;
const SIGNED_DESCRIPTOR = 16;
/** По первым 4 байтам данных записи (`50 4B 03 04`) узнаётся вложенный пакет. */
const HEAD = 4;
/** Сколько сжатых байтов распаковывается, чтобы получить начало записи: 64, при выходе короче 4 байт — 1 КиБ. */
const HEAD_PREFIXES = [64, 1024] as const;

/** Запись по каталогу: её локальный заголовок с ним уже сверен (флаги, метод, размеры). */
interface ArchiveEntry {
  /** Смещение локального заголовка. */
  start: number;
  /** Данные: `[dataStart, dataEnd)`, длина — сжатый размер из каталога. */
  dataStart: number;
  dataEnd: number;
  /** Бит 3: после данных — описатель. */
  descriptor: boolean;
  method: number;
  uncompressed: number;
}

/** Архив, прошедший проверки этапа 2: записи по возрастанию смещения и начало каталога. */
interface Archive {
  entries: ArchiveEntry[];
  directoryOffset: number;
}

/**
 * Запись конца каталога — ровно последние 22 байта файла с пустым комментарием: clamd и читатели Office берут первую
 * сигнатуру с конца, и это должна быть она же. Иначе — есть ли сигнатура в пределах комментария (64 КиБ) вообще.
 */
function endRecordIssue(bytes: Buffer): 'end_record_missing' | 'archive_comment' | null {
  const at = bytes.length - END_RECORD;
  if (at >= 0 && bytes.readUInt32LE(at) === SIGNATURE.end && bytes.readUInt16LE(at + 20) === 0) return null;
  // Целая запись (22 байта) не на своём месте — комментарий, байты после неё или подделка; обрывок — усечённый файл.
  for (let candidate = at; candidate >= 0 && candidate >= at - U16_MAX; candidate--)
    if (bytes.readUInt32LE(candidate) === SIGNATURE.end) return 'archive_comment';
  return 'end_record_missing';
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
 * Проверки этапа 2: запись конца каталога — последние 22 байта файла, комментария нет; ZIP64 нет нигде (записи
 * конца и локатор, `0xFFFF` / `0xFFFFFFFF`, поле `0x0001` в каталоге и в локальных заголовках); каталог вплотную к
 * записи своего конца, каждая его запись и её локальный заголовок — в пределах файла, данные записей не
 * перекрываются; у каждой записи локальный заголовок совпадает с каталогом: без шифрования, бит 3 одинаков, метод
 * одинаков и это stored или deflate, размеры равны (с описателем данных — нули или равны); у stored сжатый размер
 * равен несжатому; в каталоге хотя бы одна запись и есть `[Content_Types].xml` в корне. Имена файлов в двух
 * заголовках не сверяются.
 */
function readArchive(bytes: Buffer): Archive | ZipStructureIssue {
  const endIssue = endRecordIssue(bytes);
  if (endIssue) return endIssue;
  const end = bytes.length - END_RECORD;
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
  if (entries === 0) return 'directory_empty';

  const records: ArchiveEntry[] = [];
  let contentTypes = false;
  let at = directoryOffset;
  for (let index = 0; index < entries; index++) {
    if (at + CENTRAL_HEADER > end || bytes.readUInt32LE(at) !== SIGNATURE.central) return 'central_entry_malformed';
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
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
    const name = bytes.subarray(at + CENTRAL_HEADER, at + CENTRAL_HEADER + nameLength);
    if (name.equals(CONTENT_TYPES)) contentTypes = true;
    const centralExtra = extraFieldsIssue(bytes, at + CENTRAL_HEADER + nameLength, extraLength);
    if (centralExtra === 'zip64') return 'zip64_central_extra';
    if (centralExtra === 'malformed') return 'central_entry_malformed';

    // Локальный заголовок этой записи и её данные — до начала каталога.
    if (localOffset + LOCAL_HEADER > directoryOffset || bytes.readUInt32LE(localOffset) !== SIGNATURE.local)
      return 'local_header_malformed';
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localCompressed = bytes.readUInt32LE(localOffset + 18);
    const localUncompressed = bytes.readUInt32LE(localOffset + 22);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localExtraStart = localOffset + LOCAL_HEADER + localNameLength;
    if (localExtraStart + localExtraLength > directoryOffset) return 'local_header_malformed';
    const localExtra = extraFieldsIssue(bytes, localExtraStart, localExtraLength);
    if (localExtra === 'malformed') return 'local_header_malformed';

    // Локальный заголовок читается антивирусом так же, как каталог — Office.
    if ((flags | localFlags) & ENCRYPTION_FLAGS) return 'encrypted';
    if (localCompressed === U32_MAX || localUncompressed === U32_MAX) return 'zip64_local_values';
    if (localExtra === 'zip64') return 'zip64_local_extra';
    if ((flags & DESCRIPTOR_FLAG) !== (localFlags & DESCRIPTOR_FLAG)) return 'descriptor_flag_mismatch';
    if (method !== localMethod) return 'method_mismatch';
    if (method !== STORED && method !== DEFLATE) return 'method_unsupported';
    const sameSizes = localCompressed === compressed && localUncompressed === uncompressed;
    const zeroSizes = localCompressed === 0 && localUncompressed === 0;
    if (flags & DESCRIPTOR_FLAG ? !(sameSizes || zeroSizes) : !sameSizes) return 'local_sizes_mismatch';

    // Размер данных — из каталога: при описателе данных (бит 3) в локальном заголовке нули.
    const dataEnd = localExtraStart + localExtraLength + compressed;
    if (dataEnd > directoryOffset) return 'local_header_malformed';
    if (method === STORED && compressed !== uncompressed) return 'stored_sizes_mismatch';
    records.push({
      start: localOffset,
      dataStart: localExtraStart + localExtraLength,
      dataEnd,
      descriptor: (flags & DESCRIPTOR_FLAG) !== 0,
      method,
      uncompressed,
    });
    at = next;
  }
  if (at !== end) return 'central_directory_bounds';

  records.sort((a, b) => a.start - b.start);
  for (let index = 1; index < records.length; index++)
    if (records[index]!.start < records[index - 1]!.dataEnd) return 'entries_overlap';
  if (!contentTypes) return 'content_types_missing';
  return { entries: records, directoryOffset };
}

/**
 * Записи вплотную: первая — на смещении 0, каждая следующая — сразу за данными предыдущей (и её описателем, если
 * бит 3: 16 байт, если за данными сигнатура `50 4B 07 08`, иначе 12 — так шагает и libclamav), за последней —
 * каталог. Тогда читатель по локальным заголовкам (clamd без каталога, потоковые распаковщики) и читатель по
 * каталогу (Office) видят одни и те же записи.
 */
function entriesGapIssue(bytes: Buffer, { entries, directoryOffset }: Archive): 'entries_gap' | null {
  let expected = 0;
  for (const entry of entries) {
    if (entry.start !== expected) return 'entries_gap';
    expected = entry.dataEnd;
    if (entry.descriptor)
      expected +=
        expected + 4 <= directoryOffset && bytes.readUInt32LE(expected) === SIGNATURE.descriptor
          ? SIGNED_DESCRIPTOR
          : DESCRIPTOR;
  }
  return expected === directoryOffset ? null : 'entries_gap';
}

/** Предел вывода `maxOutputLength` превышен (`ERR_BUFFER_TOO_LARGE`). */
const isOutputLimit = (error: unknown) =>
  error instanceof RangeError && (error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE';

/**
 * Начало сжатых данных записи: всё, что даёт префикс потока deflate (`Z_SYNC_FLUSH` — без требования конца потока).
 * Вывод не больше остатка бюджета и списывается с него: файл из тысяч записей с плотным сжатием не распакует больше
 * `MAX_INFLATED_BYTES` и на этом.
 */
function inflatePrefix(prefix: Buffer, budget: InflateBudget): Buffer | 'inflate_limit' | 'entry_data_malformed' {
  if (budget.remainingBytes < 1) return 'inflate_limit';
  try {
    const head = inflateRawSync(prefix, { finishFlush: zlib.Z_SYNC_FLUSH, maxOutputLength: budget.remainingBytes });
    budget.remainingBytes -= head.length;
    return head;
  } catch (error) {
    return isOutputLimit(error) ? 'inflate_limit' : 'entry_data_malformed';
  }
}

/**
 * Первые байты данных записи (не меньше 4, если данных столько есть): stored — сами байты; deflate — распакованный
 * префикс 64 байта, при выходе короче 4 байт — 1 КиБ. Если и 1 КиБ сжатых данных не дал 4 байт, а поток длиннее,
 * начало не определить — `entry_data_malformed` (законный писатель выдаёт данные сразу за заголовком блока).
 */
function entryHead(bytes: Buffer, entry: ArchiveEntry, budget: InflateBudget): Buffer | ZipStructureIssue {
  const compressed = entry.dataEnd - entry.dataStart;
  if (entry.method === STORED || compressed === 0)
    return bytes.subarray(entry.dataStart, entry.dataStart + Math.min(HEAD, compressed));
  for (const length of HEAD_PREFIXES) {
    const head = inflatePrefix(bytes.subarray(entry.dataStart, entry.dataStart + Math.min(length, compressed)), budget);
    if (typeof head === 'string' || head.length >= HEAD || compressed <= length) return head;
  }
  return 'entry_data_malformed';
}

/**
 * Байты вложенного пакета. Размер из каталога — верхняя граница: больше остатка бюджета — `inflate_limit` без
 * распаковки; распаковка не выходит за него (`maxOutputLength`), и поток, который даёт больше или меньше, —
 * `entry_data_malformed`. Буфер вывода один, на весь заявленный размер (`chunkSize` на байт больше: без второго
 * буфера и склейки кусков). Stored — часть буфера файла без копии, с тем же списанием.
 */
function packageBytes(bytes: Buffer, entry: ArchiveEntry, budget: InflateBudget): Buffer | ZipStructureIssue {
  if (entry.uncompressed > budget.remainingBytes) return 'inflate_limit';
  if (entry.method === STORED) {
    budget.remainingBytes -= entry.uncompressed;
    return bytes.subarray(entry.dataStart, entry.dataEnd);
  }
  // Начало данных уже дало 4 байта: заявлено меньше — размер в каталоге неверен.
  if (entry.uncompressed < HEAD) return 'entry_data_malformed';
  try {
    const nested = inflateRawSync(bytes.subarray(entry.dataStart, entry.dataEnd), {
      maxOutputLength: entry.uncompressed,
      chunkSize: Math.max(entry.uncompressed + 1, zlib.Z_MIN_CHUNK),
    });
    if (nested.length !== entry.uncompressed) return 'entry_data_malformed';
    budget.remainingBytes -= nested.length;
    return nested;
  } catch {
    // Поток длиннее заявленного размера, испорчен или оборван.
    return 'entry_data_malformed';
  }
}

/**
 * Каждая запись, данные которой начинаются с `50 4B 03 04` (имя не важно, `[Content_Types].xml` тоже), — вложенный
 * пакет: проверяется той же `zipStructureIssue` на уровень глубже, с тем же бюджетом. Глубже `MAX_NESTED_DEPTH` —
 * `nested_too_deep`, пакетов больше бюджета — `nested_too_many`; первая причина вложенного пакета возвращается как
 * есть. Объекты OLE (`*.bin`) и архивы не с начала данных записи не разбираются — их разбирает ClamAV.
 */
function nestedPackagesIssue(
  bytes: Buffer,
  entries: ArchiveEntry[],
  budget: InflateBudget,
  depth: number,
): ZipStructureIssue | null {
  for (const entry of entries) {
    const head = entryHead(bytes, entry, budget);
    if (typeof head === 'string') return head;
    if (head.length < HEAD || head.readUInt32LE(0) !== SIGNATURE.local) continue;
    if (depth + 1 > MAX_NESTED_DEPTH) return 'nested_too_deep';
    if (budget.remainingPackages < 1) return 'nested_too_many';
    budget.remainingPackages -= 1;
    const nested = packageBytes(bytes, entry, budget);
    if (typeof nested === 'string') return nested;
    const issue = zipStructureIssue(nested, { budget, depth: depth + 1 });
    if (issue !== null) return issue;
  }
  return null;
}

/**
 * Проверка структуры ZIP по буферу: null — архив принят, иначе — первая найденная причина отказа. Порядок: проверки
 * этапа 2 (`readArchive`), записи вплотную (`entries_gap`), число записей в бюджете (`entries_too_many`), вложенные
 * пакеты (рекурсивно). `budget` — пределы на файл (по умолчанию новые, `createInflateBudget`), передаётся во
 * вложенные пакеты и уменьшается; `depth` — глубина этого пакета (файл — 0).
 */
export function zipStructureIssue(
  bytes: Buffer,
  options: { budget?: InflateBudget; depth?: number } = {},
): ZipStructureIssue | null {
  const archive = readArchive(bytes);
  if (typeof archive === 'string') return archive;
  const gap = entriesGapIssue(bytes, archive);
  if (gap) return gap;
  const budget = options.budget ?? createInflateBudget();
  if (archive.entries.length > budget.remainingEntries) return 'entries_too_many';
  budget.remainingEntries -= archive.entries.length;
  return nestedPackagesIssue(bytes, archive.entries, budget, options.depth ?? 0);
}

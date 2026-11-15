import { constants as zlib, inflateRawSync } from 'node:zlib';
import type { InflateBudget } from './zip-structure.js';

/**
 * Зашифрованные PDF и вложения PDF до хранилища (DATA-06, DATA-07; расхождения 4 и 5 плана этапа 3а), по именам PDF
 * (ISO 32000-1, 7.3.5: `/` и обычные символы до пробельного или разделителя, коды `#xx` раскрываются).
 *
 * - **Зашифрованный PDF — отказ** (`encrypted`, проверка первой): имя `Encrypt` в байтах файла, где угодно. Внутри
 *   зашифрованного PDF антивирус видит не всё даже без пароля на открытие: clamd 1.4.6 считает PDF с паролем только
 *   владельца расшифровываемым, но поток без `/Filter` перед проверкой не расшифровывает (`pdf_decodestream: no
 *   non-forced filters decoded, returning raw stream`) — вложение с EICAR без фильтра в таком PDF дало «OK». Потоки
 *   объектов зашифрованного PDF не читает и платформа. Правило намеренно широкое: имя в комментарии, строке или чужом
 *   словаре тоже даёт отказ — ложный отказ безопаснее пропуска; пользователю — «снимите защиту».
 * - **Вложения — отказ** (`attachments`): имена `EmbeddedFile`, `EmbeddedFiles` (дерево вложений документа) и
 *   `FileAttachment` (вложение в пометке страницы) в байтах файла — где угодно, в том числе в несжатых данных потоков, —
 *   и в распакованных потоках объектов: словарь потока содержит `/Type /ObjStm` и единственный фильтр `/FlateDecode`
 *   (так Acrobat и другие писатели PDF 1.5+ сжимают каталог и дерево имён). Файл, вложенный в PDF, антивирус может не
 *   проверить: архив с ZIP64 во вложении clamd 1.4 признаёт чистым. Распаковка — с пределом вывода из бюджета файла;
 *   превышение — `inflate_limit`.
 *
 * Пределы проверки. Это гигиеническое правило, а не граница безопасности и не разбор PDF: вложение, спрятанное в
 * потоке объектов без `/Type /ObjStm` или под фильтром не `FlateDecode` (или с цепочкой фильтров), платформа не увидит.
 * Подтверждённый класс обхода — ZIP64 во вложении — закрывает своя сигнатура clamd (`infrastructure/clamav/imbc.ndb`),
 * документ под паролем, который проверка по именам пропустила, отклоняет clamd (`AlertEncryptedDoc`). Словарь потока
 * ищется по `<< … >>` прямо перед ключевым словом `stream`, данные — до `endstream` (нет — до конца файла), синтаксис
 * вне словарей не разбирается: нестандартно записанный файл может пройти мимо правила. Например, комментарий
 * `%<<>>stream` перед потоком объектов читается как начало потока до следующего `endstream` и «проглатывает» сам поток
 * объектов — проверка возвращает null.
 *
 * Время и память ограничены на любом файле до 25 МБ (NFR-09): байты файла просматриваются за линейное время, данные
 * потоков объектов распаковываются один раз и вместе не больше остатка бюджета (`remainingBytes`), потоков объектов —
 * не больше `MAX_OBJECT_STREAMS`. Поток, который не распаковывается, пропускается: с неверным заголовком zlib — сразу,
 * с испорченными данными deflate — списав с бюджета верхнюю границу его вывода (сколько он успел распаковать до
 * ошибки, синхронный zlib не сообщает): `1032 × длина сжатых данных + 258`, но не больше остатка.
 */

/** Почему PDF не принят: зашифрован, вложенные файлы или распакованные потоки объектов сверх бюджета. */
export type PdfStructureIssue = 'encrypted' | 'attachments' | 'inflate_limit';

/**
 * Потоков объектов (`/Type /ObjStm` с `FlateDecode`) на файл; больше — `inflate_limit`. Писатели кладут в поток по
 * 100–200 объектов: предел соответствует сотням тысяч объектов, а распаковка каждого потока — вызов zlib.
 */
export const MAX_OBJECT_STREAMS = 4096;

/**
 * Имена, которые различает проверка; индекс в списке — код имени. Вложения (ISO 32000-1, 7.11.4, 12.5.6.15) и
 * `Encrypt` ищутся в байтах файла, остальные — в словаре потока.
 */
const NAMES = [
  'EmbeddedFile',
  'EmbeddedFiles',
  'FileAttachment',
  'Encrypt',
  'Type',
  'ObjStm',
  'Filter',
  'FlateDecode',
].map((name) => Buffer.from(name, 'latin1'));
const EMBEDDED_FILE = 0;
const EMBEDDED_FILES = 1;
const FILE_ATTACHMENT = 2;
const ENCRYPT = 3;
const TYPE = 4;
const OBJSTM = 5;
const FILTER = 6;
const FLATE_DECODE = 7;
/** Коды, которые ищутся в байтах файла и в потоках объектов: `Encrypt` и вложения. */
const FILE_NAMES = [EMBEDDED_FILE, EMBEDDED_FILES, FILE_ATTACHMENT, ENCRYPT] as const;
/** Коды, которые нужны в словаре потока. */
const DICT_NAMES = [TYPE, OBJSTM, FILTER, FLATE_DECODE] as const;
/** Самое длинное имя списка — 14 символов; записанное кодами `#xx` — до 42 байт. Имя длиннее ни с чем не совпадёт. */
const MAX_NAME_BYTES = 3 * 'FileAttachment'.length;
/** Самое короткое имя списка — `Type`. */
const MIN_NAME_BYTES = 4;
/** Раскрытое имя с кодами `#xx` (одно на вызов; проверка синхронная). */
const DECODED = Buffer.alloc(MAX_NAME_BYTES);

const SLASH = 0x2f;
const HASH = 0x23;
const LT = 0x3c;
const GT = 0x3e;
const LPAREN = 0x28;
const RPAREN = 0x29;
const LBRACKET = 0x5b;
const RBRACKET = 0x5d;
const PERCENT = 0x25;
const BACKSLASH = 0x5c;
const CR = 0x0d;
const LF = 0x0a;
const SPACE = 0x20;
const TAB = 0x09;
const UPPER_E = 0x45;
const UPPER_F = 0x46;

/** Пробельные символы и разделители PDF (ISO 32000-1, 7.2.2); прочие байты — обычные символы. */
const WHITESPACE = new Uint8Array(256);
for (const b of [0x00, TAB, LF, 0x0c, CR, SPACE]) WHITESPACE[b] = 1;
const NOT_REGULAR = new Uint8Array(WHITESPACE);
for (const c of '()<>[]{}/%') NOT_REGULAR[c.charCodeAt(0)] = 1;

const STREAM = Buffer.from('stream', 'latin1');
const ENDSTREAM = Buffer.from('endstream', 'latin1');

const hexDigit = (b: number) => {
  if (b >= 0x30 && b <= 0x39) return b - 0x30;
  const lower = b | 0x20;
  return lower >= 0x61 && lower <= 0x66 ? lower - 0x57 : -1;
};

/**
 * Конец имени, начатого `/` в позиции `at` (первый байт после него), и есть ли в нём `#`. Результат — в `NAME` (один
 * на вызов: без выделения памяти на каждое имя).
 */
const NAME = { end: 0, hash: false };
function readName(bytes: Buffer, at: number, end: number): typeof NAME {
  let i = at + 1;
  let hash = false;
  for (; i < end; i++) {
    const b = bytes[i]!;
    if (NOT_REGULAR[b]) break;
    if (b === HASH) hash = true;
  }
  NAME.end = i;
  NAME.hash = hash;
  return NAME;
}

/**
 * Код имени `[from, to)` (без `/`) из `codes` после раскрытия `#xx` (`#` без двух шестнадцатеричных цифр остаётся
 * как есть, как читают PDF Acrobat и pdf.js); не из них — −1. Сравнение — по байтам, без строк.
 */
function nameCode(bytes: Buffer, from: number, to: number, hash: boolean, codes: readonly number[]): number {
  let source: Uint8Array = bytes;
  let start = from;
  let length = to - from;
  if (length < MIN_NAME_BYTES || length > MAX_NAME_BYTES) return -1;
  if (hash) {
    length = 0;
    for (let i = from; i < to; i++) {
      let b = bytes[i]!;
      if (b === HASH && i + 2 < to) {
        const high = hexDigit(bytes[i + 1]!);
        const low = hexDigit(bytes[i + 2]!);
        if (high >= 0 && low >= 0) {
          b = high * 16 + low;
          i += 2;
        }
      }
      DECODED[length++] = b;
    }
    source = DECODED;
    start = 0;
  }
  for (const code of codes) {
    const name = NAMES[code]!;
    if (name.length !== length) continue;
    let k = 0;
    while (k < length && source[start + k] === name[k]) k++;
    if (k === length) return code;
  }
  return -1;
}

/**
 * Имена `Encrypt` и вложений в байтах: `encrypted` главнее — при нём просмотр сразу кончается, а найденное вложение
 * просмотр не прерывает. Сравниваются только имена, начатые с `E`, `F` или `#`; просмотр идёт от имени к концу имени —
 * каждый байт один раз.
 */
function scanNames(bytes: Buffer, checkEncryption = true): 'encrypted' | 'attachments' | null {
  let attachments = false;
  const end = bytes.length;
  for (let i = 0; i < end; i++) {
    if (bytes[i] !== SLASH) continue;
    const { end: to, hash } = readName(bytes, i, end);
    const first = bytes[i + 1];
    if (first === UPPER_E || first === UPPER_F || first === HASH) {
      const code = nameCode(bytes, i + 1, to, hash, FILE_NAMES);
      if (code === ENCRYPT) {
        if (checkEncryption) return 'encrypted';
      } else if (code !== -1) attachments = true;
    }
    i = to - 1;
  }
  return attachments ? 'attachments' : null;
}

/** Поток файла: словарь `[dictStart, dictEnd)` (от `<<` до `>>` включительно) и данные `[dataStart, dataEnd)`. */
interface StreamPart {
  dictStart: number;
  dictEnd: number;
  dataStart: number;
  dataEnd: number;
}

/** Начало данных после ключевого слова `stream`: пробелы и табуляция, затем `\r\n`, `\n` или `\r`; иначе −1. */
function dataStartAfter(bytes: Buffer, at: number): number {
  let i = at;
  while (i < bytes.length && (bytes[i] === SPACE || bytes[i] === TAB)) i++;
  if (bytes[i] === LF) return i + 1;
  if (bytes[i] !== CR) return -1;
  return bytes[i + 1] === LF ? i + 2 : i + 1;
}

/**
 * Словарь прямо перед ключевым словом `stream` в позиции `at`: между `>>` и ключевым словом — только пробельные.
 * Начало — парная `<<`, поиск назад не ниже `floor`. Нет словаря — null.
 */
function dictionaryBefore(bytes: Buffer, at: number, floor: number): { start: number; end: number } | null {
  let end = at;
  while (end > floor && WHITESPACE[bytes[end - 1]!]) end--;
  if (end - 2 < floor || bytes[end - 1] !== GT || bytes[end - 2] !== GT) return null;
  let depth = 0;
  for (let i = end; i - 2 >= floor;) {
    if (bytes[i - 1] === GT && bytes[i - 2] === GT) {
      depth++;
      i -= 2;
    } else if (bytes[i - 1] === LT && bytes[i - 2] === LT) {
      depth--;
      i -= 2;
      if (depth === 0) return { start: i, end };
    } else i--;
  }
  return null;
}

/**
 * Потоки файла по порядку. Следующий ищется после `endstream` найденного: данные потока как синтаксис не читаются,
 * области поиска словаря назад не пересекаются — каждый байт файла просматривается ограниченное число раз.
 */
function* streams(bytes: Buffer): Generator<StreamPart> {
  let from = 0;
  let floor = 0;
  while (from < bytes.length) {
    const at = bytes.indexOf(STREAM, from);
    if (at === -1) return;
    const keywordEnd = at + STREAM.length;
    const dataStart = dataStartAfter(bytes, keywordEnd);
    if (dataStart === -1) {
      from = keywordEnd;
      continue;
    }
    const dict = dictionaryBefore(bytes, at, floor);
    if (!dict) {
      from = floor = keywordEnd;
      continue;
    }
    const endstream = bytes.indexOf(ENDSTREAM, dataStart);
    yield { dictStart: dict.start, dictEnd: dict.end, dataStart, dataEnd: endstream === -1 ? bytes.length : endstream };
    from = floor = endstream === -1 ? bytes.length : endstream + ENDSTREAM.length;
  }
}

/** Элементы словаря потока, кроме имён: прочее (−1, как имя не из списка), `[` и `]`. */
const OTHER = -1;
const OPEN_ARRAY = -2;
const CLOSE_ARRAY = -3;

/** Конец строки PDF `(…)` с вложенными скобками и `\`-экранированием, начатой в позиции `at`. */
function literalStringEnd(bytes: Buffer, at: number, end: number): number {
  let depth = 0;
  for (let i = at; i < end; i++) {
    const b = bytes[i];
    if (b === BACKSLASH) i++;
    else if (b === LPAREN) depth++;
    else if (b === RPAREN && --depth === 0) return i + 1;
  }
  return end;
}

/**
 * Словарь потока `[start, end)` — поток объектов со сжатием FlateDecode: на верхнем уровне словаря `/Type /ObjStm` и
 * `/Filter /FlateDecode` или `/Filter [ /FlateDecode ]`. Строки, шестнадцатеричные строки и комментарии
 * пропускаются, вложенные словари не смотрятся; ключи сравниваются после раскрытия `#xx`.
 */
function isFlateObjectStream(bytes: Buffer, start: number, end: number): boolean {
  let depth = 0;
  let objStm = false;
  let flate = false;
  // Три предыдущих элемента верхнего уровня: код имени (`DICT_NAMES`), `[`, `]` или прочее.
  let back3 = OTHER;
  let back2 = OTHER;
  let back1 = OTHER;
  for (let i = start; i < end;) {
    const b = bytes[i]!;
    // Глубина, на которой стоит элемент: вложенный словарь — элемент того уровня, где он открыт.
    const level = depth;
    let token: number;
    if (WHITESPACE[b]) {
      i++;
      continue;
    } else if (b === PERCENT) {
      while (i < end && bytes[i] !== CR && bytes[i] !== LF) i++;
      continue;
    } else if (b === LT && bytes[i + 1] === LT) {
      token = OTHER;
      depth++;
      i += 2;
    } else if (b === GT && bytes[i + 1] === GT) {
      depth--;
      i += 2;
      if (depth === 0) break;
      continue;
    } else if (b === LT) {
      token = OTHER;
      i++;
      while (i < end && bytes[i] !== GT) i++;
      i++;
    } else if (b === LPAREN) {
      token = OTHER;
      i = literalStringEnd(bytes, i, end);
    } else if (b === SLASH) {
      const { end: to, hash } = readName(bytes, i, end);
      token = nameCode(bytes, i + 1, to, hash, DICT_NAMES);
      i = to;
    } else if (b === LBRACKET || b === RBRACKET) {
      token = b === LBRACKET ? OPEN_ARRAY : CLOSE_ARRAY;
      i++;
    } else {
      // Число, ключевое слово (`R`, `true`) или одиночный разделитель.
      token = OTHER;
      i++;
      if (!NOT_REGULAR[b]) {
        while (i < end && !NOT_REGULAR[bytes[i]!]) i++;
      }
    }
    if (level !== 1) continue;
    if (back1 === TYPE && token === OBJSTM) objStm = true;
    if (back1 === FILTER && token === FLATE_DECODE) flate = true;
    if (back3 === FILTER && back2 === OPEN_ARRAY && back1 === FLATE_DECODE && token === CLOSE_ARRAY) flate = true;
    back3 = back2;
    back2 = back1;
    back1 = token;
  }
  return objStm && flate;
}

/** Заголовок zlib (RFC 1950): метод deflate, окно до 32 КиБ, верные контрольные биты, без словаря. */
function zlibHeader(bytes: Buffer, at: number, end: number): boolean {
  if (at + 2 > end) return false;
  const cmf = bytes[at]!;
  const flg = bytes[at + 1]!;
  return (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && ((cmf << 8) | flg) % 31 === 0 && (flg & 0x20) === 0;
}

/** Верхняя граница вывода deflate: 1032 байта на байт сжатых данных (предел сжатия zlib) и одно совпадение 258 байт. */
const MAX_DEFLATE_RATIO = 1032;
const MAX_DEFLATE_MATCH = 258;

/** Предел вывода `maxOutputLength` превышен (`ERR_BUFFER_TOO_LARGE`). */
const isOutputLimit = (error: unknown) =>
  error instanceof RangeError && (error as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE';

/**
 * Данные потока объектов, распакованные с пределом вывода — остатком бюджета, который уменьшается на распакованное.
 * Данные deflate идут за двухбайтовым заголовком zlib; контрольная сумма Adler-32 не проверяется, оборванный поток
 * даёт распакованное начало (`Z_SYNC_FLUSH`) — как читают PDF Acrobat и pdf.js. Остатка нет или вывод больше него —
 * `inflate_limit`; заголовок не zlib — null; данные испорчены — null и списана верхняя граница вывода.
 */
function inflateObjectStream(bytes: Buffer, part: StreamPart, budget: InflateBudget): Buffer | 'inflate_limit' | null {
  if (budget.remainingBytes < 1) return 'inflate_limit';
  if (!zlibHeader(bytes, part.dataStart, part.dataEnd)) return null;
  try {
    const data = inflateRawSync(bytes.subarray(part.dataStart + 2, part.dataEnd), {
      finishFlush: zlib.Z_SYNC_FLUSH,
      maxOutputLength: budget.remainingBytes,
    });
    budget.remainingBytes -= data.length;
    return data;
  } catch (error) {
    if (isOutputLimit(error)) return 'inflate_limit';
    // Сколько распаковано до ошибки, синхронный zlib не сообщает: списывается верхняя граница вывода deflate — иначе
    // файл из многих таких потоков распаковывал бы по остатку бюджета на каждый.
    const compressed = part.dataEnd - part.dataStart - 2;
    budget.remainingBytes -= Math.min(budget.remainingBytes, MAX_DEFLATE_RATIO * compressed + MAX_DEFLATE_MATCH);
    return null;
  }
}

/**
 * Зашифрованный PDF и вложения (DATA-06, DATA-07): имя `Encrypt` в байтах файла — `encrypted` (первым); имя вложения в
 * байтах файла или в распакованном потоке объектов — `attachments`; распакованные потоки объектов сверх остатка
 * `budget.remainingBytes` или больше `MAX_OBJECT_STREAMS` потоков — `inflate_limit`; иначе null. Бюджет — на файл
 * (`createInflateBudget`), уменьшается.
 */
export function pdfStructureIssue(bytes: Buffer, budget: InflateBudget): PdfStructureIssue | null {
  const named = scanNames(bytes);
  if (named) return named;
  let objectStreams = 0;
  for (const part of streams(bytes)) {
    if (!isFlateObjectStream(bytes, part.dictStart, part.dictEnd)) continue;
    if (++objectStreams > MAX_OBJECT_STREAMS) return 'inflate_limit';
    const data = inflateObjectStream(bytes, part, budget);
    if (data === 'inflate_limit') return data;
    // В распакованном потоке объектов ищутся только вложения: словарь шифрования в поток объектов не кладут.
    if (data && scanNames(data, false) === 'attachments') return 'attachments';
  }
  return null;
}

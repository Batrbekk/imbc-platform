/**
 * Составной файл OLE (CFB, MS-CFB) до хранилища (DATA-06, DATA-07). В нём хранятся старые `.doc` и `.xls` (их
 * платформа не принимает) и документы Word и Excel под паролем на открытие (MS-OFFCRYPTO): пакет OOXML зашифрован
 * и лежит в потоке `EncryptedPackage`, параметры шифрования — в потоке `EncryptionInfo`. Содержимое такого
 * документа антивирус не видит, поэтому он отклоняется с отдельным кодом — пользователю нужно снять пароль.
 */

/** Сигнатура CFB — первые 8 байт файла. */
const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
/** Имена потоков документа под паролем; в каталоге CFB имена записаны в UTF-16LE. */
const ENCRYPTION_STREAMS = ['EncryptionInfo', 'EncryptedPackage'].map((name) => Buffer.from(name, 'utf16le'));

/** Файл — составной файл OLE (по сигнатуре в начале). */
export function isCfb(bytes: Buffer): boolean {
  return bytes.length >= CFB_SIGNATURE.length && bytes.subarray(0, CFB_SIGNATURE.length).equals(CFB_SIGNATURE);
}

/**
 * Документ Office под паролем: CFB, и в байтах есть имя потока `EncryptionInfo` или `EncryptedPackage` в UTF-16LE.
 * Каталог CFB не разбирается: имя ищется по всему файлу. Ложное совпадение (такой текст в теле старого `.doc`)
 * меняет только код отказа — CFB не принимается в любом случае.
 */
export function isEncryptedOfficeDocument(bytes: Buffer): boolean {
  return isCfb(bytes) && ENCRYPTION_STREAMS.some((name) => bytes.includes(name));
}

/**
 * Запись каталога CFB — 128 байт. Записи всегда лежат по смещениям, кратным 128 (заголовок — 512 байт, сектор —
 * 512 или 4096), и имя записи непрерывно: разбить его по секторам нельзя.
 */
const DIRECTORY_ENTRY = 128;
/** Поле имени — первые 64 байта записи (UTF-16LE, до 31 символа и терминатор); за ним — длина имени `cb` в байтах. */
const NAME_FIELD = 64;

/** Латинская буква — в верхний регистр; прочие кодовые единицы UTF-16 — как есть. */
const fold = (unit: number) => (unit >= 0x61 && unit <= 0x7a ? unit - 0x20 : unit);
const folded = (name: string) => Array.from(name, (char) => fold(char.charCodeAt(0)));

/** Потоки документа под паролем (MS-OFFCRYPTO): внедрённый документ под паролем антивирус не проверит. */
const ENCRYPTED_NAMES = ['EncryptionInfo', 'EncryptedPackage'].map(folded);
/**
 * Потоки внедрённого файла: `\x01Ole10Native` — «Пакет» с произвольным файлом, `Package` — документ OOXML,
 * `CONTENTS` — содержимое объекта (например, PDF). Архив в них clamd проверяет не так, как Office его откроет
 * (ZIP64 внутри объекта — «OK» на живом clamd), а платформа потоки CFB не разбирает.
 */
const EMBEDDED_FILE_NAMES = ['\x01Ole10Native', 'Package', 'CONTENTS'].map(folded);

/**
 * В записи каталога по смещению `at` — имя `name`: поле имени начинается с него (латиница без учёта регистра) и
 * имя здесь кончается — следующая кодовая единица `0x0000`, либо `cb` равно `2n` или `2(n + 1)` (`n` — длина имени).
 * Условие на конец имени отсекает текст в данных потоков («Contents of …» в UTF-16LE). Чтения — в пределах записи:
 * имена короче 31 символа, `at + 128 <= length`.
 */
function nameAt(bytes: Buffer, at: number, name: readonly number[]): boolean {
  for (let index = 0; index < name.length; index++)
    if (fold(bytes.readUInt16LE(at + 2 * index)) !== name[index]) return false;
  const cb = bytes.readUInt16LE(at + NAME_FIELD);
  return bytes.readUInt16LE(at + 2 * name.length) === 0 || cb === 2 * name.length || cb === 2 * (name.length + 1);
}

/** Заголовок CFB — 512 байт; степень двойки размера сектора — `uint16` по смещению `0x1E`. */
const HEADER = 512;
const SECTOR_SHIFT = 0x1e;
/** MS-CFB: сектор 512 байт (версия 3) или 4096 (версия 4); другого Office не открывает. */
const SECTOR_SHIFTS: ReadonlySet<number> = new Set([9, 12]);

/**
 * Часть CFB внутри пакета Office (объект OLE, `word/embeddings/oleObject1.bin`; сигнатуру проверил вызывающий) —
 * обход записей каталога по форме, без чтения цепочек FAT: каждое смещение, кратное 128. Поток `EncryptionInfo` или
 * `EncryptedPackage` — `encrypted`; иначе `\x01Ole10Native`, `Package` или `CONTENTS` — `embedded_file`; иначе
 * null (формула `Equation Native`, рисунок `VisioDocument`, старая книга `Workbook`: потоки OLE2 clamd проверяет сам).
 * Часть короче заголовка или с сектором не 512 и не 4096 байт — `malformed`: записи каталога могли бы лежать не по
 * смещениям, кратным 128, и обход по форме их бы не увидел.
 */
export function cfbPartIssue(bytes: Buffer): 'encrypted' | 'embedded_file' | 'malformed' | null {
  if (bytes.length < HEADER || !SECTOR_SHIFTS.has(bytes.readUInt16LE(SECTOR_SHIFT))) return 'malformed';
  let embedded = false;
  for (let at = 0; at + DIRECTORY_ENTRY <= bytes.length; at += DIRECTORY_ENTRY) {
    if (ENCRYPTED_NAMES.some((name) => nameAt(bytes, at, name))) return 'encrypted';
    if (!embedded) embedded = EMBEDDED_FILE_NAMES.some((name) => nameAt(bytes, at, name));
  }
  return embedded ? 'embedded_file' : null;
}

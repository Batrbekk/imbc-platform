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

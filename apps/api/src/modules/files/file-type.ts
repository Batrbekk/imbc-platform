import { type AllowedMediaType, isAllowedMediaType } from '@imbc/contracts';
import { fileTypeFromBuffer } from 'file-type';

/**
 * Тип файла по содержимому (DATA-06): сигнатура PDF, JPEG, PNG; DOCX и XLSX — по `[Content_Types].xml` архива
 * OOXML. Всё прочее — null: ZIP без `word/` и `xl/`, исполняемые файлы, текст, DOCM и XLSM с макросами.
 * Имя и объявленный клиентом тип не участвуют.
 */
export async function detectMediaType(bytes: Buffer): Promise<AllowedMediaType | null> {
  if (bytes.length === 0) return null;
  try {
    const detected = await fileTypeFromBuffer(bytes);
    return detected && isAllowedMediaType(detected.mime) ? detected.mime : null;
  } catch {
    // Испорченный архив или неполный заголовок: тип не определён.
    return null;
  }
}

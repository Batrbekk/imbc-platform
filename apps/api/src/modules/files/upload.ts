import { createHash } from 'node:crypto';
import { type AllowedMediaType, fileExtensionMatches, MAX_FILE_BYTES } from '@imbc/contracts';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  mixin,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Observable } from 'rxjs';
import { ProblemException } from '../../common/problem.js';
import { detectMediaType } from './file-type.js';

/** Длина имени файла в символах (кодовых точках), как её хранит `file_version.original_name`. */
export const MAX_FILE_NAME_LENGTH = 255;
/** Расширение длиннее — не расширение: при укорачивании имени не сохраняется. */
const MAX_KEPT_EXTENSION = 16;

const fileMissing = () => new ProblemException(400, 'file_missing', 'Файл не передан', 'Ожидается поле file');
const fileEmpty = () => new ProblemException(400, 'file_empty', 'Файл пустой');
const fileTooLarge = () => new ProblemException(413, 'file_too_large', 'Файл больше 25 МБ');
const typeNotAllowed = () =>
  new ProblemException(415, 'file_type_not_allowed', 'Тип файла не допускается', 'Допустимы PDF, JPG, PNG, DOCX, XLSX');
const typeMismatch = () =>
  new ProblemException(415, 'file_type_mismatch', 'Расширение имени не соответствует содержимому файла');
const malformedUpload = () =>
  new ProblemException(400, 'validation', 'Запрос с файлом не разобран', 'Ожидается один файл в поле file');

/** Код MulterError по цепочке `cause` (FileInterceptor оборачивает её в HttpException). */
function isFileSizeLimit(error: unknown): boolean {
  let link = error;
  for (let depth = 0; link && typeof link === 'object' && depth < 4; depth++) {
    if ((link as { code?: unknown }).code === 'LIMIT_FILE_SIZE') return true;
    link = (link as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Перехватчик загрузки одного файла в поле `file` (DATA-06): байты — в памяти (до 25 МБ, `MAX_FILE_BYTES`),
 * не больше одного файла и четырёх полей. Ошибки multer — problem+json без имени файла (MulterError несёт его
 * в `filename`, исходная ошибка не уходит ни в ответ, ни в журнал): предел размера — 413 `file_too_large`,
 * лишний файл, чужое поле и испорченный multipart — 400 `validation`. Имя части заголовка читается как UTF-8:
 * иначе busboy читает его как latin1 и портит кириллицу.
 */
export function uploadInterceptor(): Type<NestInterceptor> {
  const Multer = FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4 },
    defParamCharset: 'utf8',
  });

  @Injectable()
  class UploadInterceptor implements NestInterceptor {
    private readonly multer = new Multer();

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
      try {
        // Ошибки самого маршрута идут через Observable и сюда не попадают.
        return await this.multer.intercept(context, next);
      } catch (error) {
        if (error instanceof ProblemException) throw error;
        throw isFileSizeLimit(error) ? fileTooLarge() : malformedUpload();
      }
    }
  }
  return mixin(UploadInterceptor);
}

/** Принятый файл: имя и объявленный тип — для записи версии (DATA-05), тип по содержимому — для ответа и проверки. */
export interface AcceptedUpload {
  originalName: string;
  declaredMediaType: string;
  mediaType: AllowedMediaType;
  bytes: Buffer;
  /** sha256, hex. */
  checksum: string;
}

/** Управляющие символы, разделители строк и символы направления текста (подмена расширения при показе имени). */
const UNSAFE_NAME_CHARS = /[\p{Cc}\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Имя файла для записи: базовое (после последнего `/` или `\`), в NFC, без управляющих символов, без пробелов
 * по краям, не длиннее 255 символов — длинное укорачивается, расширение сохраняется.
 */
export function cleanFileName(name: string): string {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const clean = base.normalize('NFC').replace(UNSAFE_NAME_CHARS, '').trim();
  const chars = Array.from(clean);
  if (chars.length <= MAX_FILE_NAME_LENGTH) return clean;
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 ? Array.from(clean.slice(dot)) : [];
  const kept = extension.length <= MAX_KEPT_EXTENSION ? extension : [];
  return (
    chars
      .slice(0, MAX_FILE_NAME_LENGTH - kept.length)
      .join('')
      .trimEnd() + kept.join('')
  );
}

/** Объявленный клиентом тип — только для записи (DATA-05): без управляющих символов, до 255 символов. */
const cleanDeclaredType = (value: string | undefined) =>
  (value ?? '').replace(UNSAFE_NAME_CHARS, '').trim().slice(0, 255) || 'application/octet-stream';

/**
 * Проверка загруженного файла до хранилища и БД (DATA-06): нет файла — 400 `file_missing`; 0 байт — 400
 * `file_empty`; тип по содержимому не из пяти допустимых — 415 `file_type_not_allowed`; расширение имени не
 * соответствует содержимому — 415 `file_type_mismatch`. Имени файла нет в тексте ни одной ошибки.
 */
export async function acceptUpload(file: Express.Multer.File | undefined): Promise<AcceptedUpload> {
  if (!file || !Buffer.isBuffer(file.buffer)) throw fileMissing();
  const bytes = file.buffer;
  if (bytes.length === 0) throw fileEmpty();
  // Предел держит multer; проверка повторена на случай другого пути к acceptUpload.
  if (bytes.length > MAX_FILE_BYTES) throw fileTooLarge();
  const originalName = cleanFileName(file.originalname ?? '');
  const mediaType = await detectMediaType(bytes);
  if (!mediaType) throw typeNotAllowed();
  if (!fileExtensionMatches(originalName, mediaType)) throw typeMismatch();
  return {
    originalName,
    declaredMediaType: cleanDeclaredType(file.mimetype),
    mediaType,
    bytes,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };
}

import { createHash } from 'node:crypto';
import { type AllowedMediaType, fileExtensionMatches, MAX_FILE_BYTES } from '@imbc/contracts';
import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  mixin,
  type NestInterceptor,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { ProblemException } from '../../common/problem.js';
import { detectMediaType } from './file-type.js';
import { zipStructureIssue } from './zip-structure.js';

/** Длина имени файла в символах (кодовых точках), как её хранит `file_version.original_name`. */
export const MAX_FILE_NAME_LENGTH = 255;
/** Расширение длиннее — не расширение: при укорачивании имени не сохраняется. */
const MAX_KEPT_EXTENSION = 16;

const fileMissing = () => new ProblemException(400, 'file_missing', 'Файл не передан', 'Ожидается поле file');
const fileEmpty = () => new ProblemException(400, 'file_empty', 'Файл пустой');
const fileTooLarge = () => new ProblemException(413, 'file_too_large', 'Файл больше 25 МБ');
const typeNotAllowed = () =>
  new ProblemException(415, 'file_type_not_allowed', 'Тип файла не допускается', 'Допустимы PDF, JPG, PNG, DOCX, XLSX');
const structureUnsupported = () =>
  new ProblemException(
    415,
    'file_structure_unsupported',
    'Структура файла не поддерживается',
    'Сохраните документ заново в Word или Excel и загрузите снова',
  );
const typeMismatch = () =>
  new ProblemException(415, 'file_type_mismatch', 'Расширение имени не соответствует содержимому файла');
const malformedUpload = () =>
  new ProblemException(400, 'validation', 'Запрос с файлом не разобран', 'Ожидается один файл в поле file');

const logger = new Logger('FileUpload');

/** Код MulterError по цепочке `cause` (FileInterceptor оборачивает её в HttpException). */
function isFileSizeLimit(error: unknown): boolean {
  let link = error;
  for (let depth = 0; link && typeof link === 'object' && depth < 4; depth++) {
    if ((link as { code?: unknown }).code === 'LIMIT_FILE_SIZE') return true;
    link = (link as { cause?: unknown }).cause;
  }
  return false;
}

/** Код и класс ошибки без текста: в тексте и полях MulterError — имя файла клиента. */
const errorShape = (error: unknown) => ({
  code: typeof (error as { code?: unknown } | null)?.code === 'string' ? (error as { code: string }).code : undefined,
  name: error instanceof Error ? error.name : typeof error,
});

/**
 * Ошибка разбора multipart → ответ. Ошибки клиента FileInterceptor уже перевёл в HttpException 4xx (коды
 * MulterError `LIMIT_*`, `MISSING_FIELD_NAME`, `INVALID_FIELD_NAME`, ошибки разметки busboy, неподдерживаемый
 * тип тела): предел размера — 413 `file_too_large`, прочие — 400 `validation`. Клиент оборвал запрос — тоже
 * 400 (ответ ему уже не нужен, сбоем сервера это не считается). Всё остальное — строка журнала `{ code, name }`
 * без имени файла и текста и ошибка без данных, которую общий фильтр отдаёт как 500 `internal`.
 */
export function uploadFailure(error: unknown, clientAborted = false): Error {
  if (error instanceof ProblemException) return error;
  if (error instanceof HttpException && error.getStatus() < 500)
    return error.getStatus() === 413 || isFileSizeLimit(error) ? fileTooLarge() : malformedUpload();
  if (clientAborted) return malformedUpload();
  logger.error(errorShape(error), 'File upload: multipart parsing failed');
  return new Error('File upload failed');
}

/**
 * Перехватчик загрузки одного файла в поле `file` (DATA-06): байты — в памяти (до 25 МБ, `MAX_FILE_BYTES`),
 * не больше одного файла и четырёх полей. Ошибки multer — `uploadFailure`: problem+json без имени файла
 * (MulterError несёт его в `filename`, исходная ошибка не уходит ни в ответ, ни в журнал). Имя части заголовка
 * читается как UTF-8: иначе busboy читает его как latin1 и портит кириллицу.
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
        throw uploadFailure(error, context.switchToHttp().getRequest<Request>().readableAborted === true);
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

/** DOCX и XLSX — архивы ZIP: их структура проверяется до хранилища. */
const OOXML_TYPES: ReadonlySet<AllowedMediaType> = new Set<AllowedMediaType>([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** Объявленный клиентом тип — только для записи (DATA-05): без управляющих символов, до 255 символов. */
const cleanDeclaredType = (value: string | undefined) =>
  (value ?? '').replace(UNSAFE_NAME_CHARS, '').trim().slice(0, 255) || 'application/octet-stream';

/**
 * Проверка загруженного файла до хранилища и БД (DATA-06): нет файла — 400 `file_missing`; 0 байт — 400
 * `file_empty`; тип по содержимому не из пяти допустимых — 415 `file_type_not_allowed`; расширение имени не
 * соответствует содержимому — 415 `file_type_mismatch`; DOCX или XLSX с признаками ZIP64 или повреждённой
 * структурой ZIP (`zipStructureIssue`) — 415 `file_structure_unsupported`: антивирус проверил бы его не целиком
 * (DATA-07). Имени файла нет в тексте ни одной ошибки.
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
  if (OOXML_TYPES.has(mediaType) && zipStructureIssue(bytes) !== null) throw structureUnsupported();
  return {
    originalName,
    declaredMediaType: cleanDeclaredType(file.mimetype),
    mediaType,
    bytes,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };
}

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
import { isEncryptedOfficeDocument } from './cfb.js';
import { detectMediaType } from './file-type.js';
import { createInflateBudget, type ZipStructureIssue, zipStructureIssue } from './zip-structure.js';

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
const fileEncrypted = () =>
  new ProblemException(415, 'file_encrypted', 'Документ защищён паролем', 'Снимите пароль и загрузите документ снова');
const tooComplex = () =>
  new ProblemException(
    415,
    'file_too_complex',
    'Файл слишком сложен для проверки',
    'Сохраните документ без внедрённых объектов или разделите его',
  );
const hasAttachments = () =>
  new ProblemException(
    415,
    'file_has_attachments',
    'В файле есть внедрённые файлы',
    'Удалите внедрённые файлы из документа и загрузите их отдельно',
  );
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
const OOXML_TYPES: readonly AllowedMediaType[] = [
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** Почему файл не принят — код ответа 415 (DATA-06, DATA-07). `file_has_attachments` — и для PDF с вложениями. */
export type InspectRefusal =
  | 'file_type_not_allowed'
  | 'file_type_mismatch'
  | 'file_structure_unsupported'
  | 'file_encrypted'
  | 'file_too_complex'
  | 'file_has_attachments';

/**
 * Итог проверки содержимого: тип по содержимому или код отказа. `reason` — причина структуры (`ZipStructureIssue`)
 * для журнала и инструмента проверки папки; у отказов по типу и у документа CFB под паролем — null.
 */
export type InspectResult =
  { ok: true; mediaType: AllowedMediaType } | { ok: false; code: InspectRefusal; reason: string | null };

/** Пределы проверки вложенных пакетов исчерпаны — файл слишком сложен, чтобы проверить его целиком. */
const TOO_COMPLEX: ReadonlySet<ZipStructureIssue> = new Set<ZipStructureIssue>([
  'nested_too_deep',
  'nested_too_many',
  'inflate_limit',
  'entries_too_many',
]);

const refusalFor = (issue: ZipStructureIssue): InspectRefusal =>
  issue === 'encrypted'
    ? 'file_encrypted'
    : issue === 'embedded_file'
      ? 'file_has_attachments'
      : TOO_COMPLEX.has(issue)
        ? 'file_too_complex'
        : 'file_structure_unsupported';

/**
 * Проверка содержимого файла (DATA-06, DATA-07) — без хранилища, базы и сети; её же вызывает инструмент проверки
 * папки (`tools/check-upload.ts`). Порядок: тип по содержимому; типа нет, а это документ Office под паролем (CFB с
 * потоком `EncryptionInfo` или `EncryptedPackage`) с расширением имени `docx` или `xlsx` — `file_encrypted`; прочее
 * без типа — `file_type_not_allowed`; расширение не соответствует типу — `file_type_mismatch`; DOCX и XLSX —
 * структура ZIP с новым бюджетом на файл (`zipStructureIssue`): шифрование записей или внедрённый документ под
 * паролем — `file_encrypted`, объект OLE с внедрённым файлом — `file_has_attachments`, пределы вложенных пакетов —
 * `file_too_complex`, прочее — `file_structure_unsupported`. `originalName` — для расширения.
 */
export async function inspectFile(bytes: Buffer, originalName: string): Promise<InspectResult> {
  const mediaType = await detectMediaType(bytes);
  if (!mediaType) {
    const officeName = OOXML_TYPES.some((type) => fileExtensionMatches(originalName, type));
    if (officeName && isEncryptedOfficeDocument(bytes)) return { ok: false, code: 'file_encrypted', reason: null };
    return { ok: false, code: 'file_type_not_allowed', reason: null };
  }
  if (!fileExtensionMatches(originalName, mediaType)) return { ok: false, code: 'file_type_mismatch', reason: null };
  if (!OOXML_TYPES.includes(mediaType)) return { ok: true, mediaType };
  const issue = zipStructureIssue(bytes, { budget: createInflateBudget() });
  return issue === null ? { ok: true, mediaType } : { ok: false, code: refusalFor(issue), reason: issue };
}

const REFUSALS: Record<InspectRefusal, () => ProblemException> = {
  file_type_not_allowed: typeNotAllowed,
  file_type_mismatch: typeMismatch,
  file_structure_unsupported: structureUnsupported,
  file_encrypted: fileEncrypted,
  file_too_complex: tooComplex,
  file_has_attachments: hasAttachments,
};

/** Объявленный клиентом тип — только для записи (DATA-05): без управляющих символов, до 255 символов. */
const cleanDeclaredType = (value: string | undefined) =>
  (value ?? '').replace(UNSAFE_NAME_CHARS, '').trim().slice(0, 255) || 'application/octet-stream';

/**
 * Проверка загруженного файла до хранилища и БД (DATA-06): нет файла — 400 `file_missing`; 0 байт — 400
 * `file_empty`; больше 25 МБ — 413 `file_too_large`; содержимое (`inspectFile`) — 415 с кодом отказа: тип не из
 * пяти допустимых, расширение не по типу, DOCX или XLSX под паролем (`file_encrypted`), со структурой ZIP, которую
 * антивирус проверил бы не целиком (`file_structure_unsupported`), со вложенными пакетами сверх пределов
 * (`file_too_complex`) или с внедрённым файлом в объекте OLE (`file_has_attachments`) (DATA-07). Причина
 * структуры — строка журнала `{ reason }`; имени файла нет ни в журнале, ни в тексте ошибки.
 */
export async function acceptUpload(file: Express.Multer.File | undefined): Promise<AcceptedUpload> {
  if (!file || !Buffer.isBuffer(file.buffer)) throw fileMissing();
  const bytes = file.buffer;
  if (bytes.length === 0) throw fileEmpty();
  // Предел держит multer; проверка повторена на случай другого пути к acceptUpload.
  if (bytes.length > MAX_FILE_BYTES) throw fileTooLarge();
  const originalName = cleanFileName(file.originalname ?? '');
  const inspected = await inspectFile(bytes, originalName);
  if (!inspected.ok) {
    // Причина — для разбора ложных отказов законным документам; имени файла в журнале нет.
    if (inspected.reason !== null) logger.log({ reason: inspected.reason }, 'File upload: ZIP structure not accepted');
    throw REFUSALS[inspected.code]();
  }
  return {
    originalName,
    declaredMediaType: cleanDeclaredType(file.mimetype),
    mediaType: inspected.mediaType,
    bytes,
    checksum: createHash('sha256').update(bytes).digest('hex'),
  };
}

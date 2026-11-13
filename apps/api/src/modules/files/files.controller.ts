import { Readable } from 'node:stream';
import { ALLOWED_FILE_TYPES, fileContentQuerySchema } from '@imbc/contracts';
import { Controller, Get, Logger, Param, Query, Req, StreamableFile } from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import { parseOrThrow } from '../../common/problem.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth } from '../auth/guards.js';
import { FilesService } from './files.service.js';
import { storageFailureSummary } from './object-storage.js';

/** RFC 5987 `ext-value`: всё, кроме attr-char, — %XX от UTF-8 (`encodeURIComponent` оставляет `'()*`). */
const rfc5987 = (value: string) =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * `Content-Disposition` скачивания (RFC 6266): `attachment` — браузер не открывает файл на нашем origin;
 * `filename*` — исходное имя в UTF-8; `filename` — запасное ASCII: печатные символы, кроме кавычки, `\` и `%`,
 * остальное — `_` (по символу на кодовую точку). Заголовок всегда одной строкой: управляющих символов в нём нет.
 */
export function contentDisposition(name: string): string {
  const ascii = Array.from(name, (c) => (/^[\x20-\x7e]$/.test(c) && !/["\\%]/.test(c) ? c : '_')).join('');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${rfc5987(name)}`;
}

const logger = new Logger('FilesController');

/**
 * Файлы (GEN-09, DATA-07, NFR-09): байты — только через этот маршрут, без presigned URL и публичных бакетов.
 * Действия матрицы у маршрута нет: вошедший пользователь, право решает `FILE_READ_RULES` по записи-владельцу.
 * Загрузок здесь нет — их маршруты принадлежат записям-владельцам (образец оргструктуры, секции профиля).
 */
@ApiTags('files')
@Controller('v1/files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /**
   * GET — байты версии и аудит `file.downloaded`. HEAD Express отдаёт этому же обработчику: те же проверки прав и
   * состояния (отказ — `file.read` `denied`) и те же заголовки, но объект из хранилища не читается и «скачано» не
   * пишется (`describe`). Ветка по методу, а не отдельный `@Head`: GET-маршрут Express перехватил бы HEAD раньше,
   * если бы он был объявлен первым.
   */
  @Get(':id/content')
  @ApiProduces(...Object.keys(ALLOWED_FILE_TYPES), 'application/problem+json')
  async content(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<StreamableFile> {
    const { version } = parseOrThrow(fileContentQuerySchema, query);
    const ip = auditIp(req);
    const file =
      req.method === 'HEAD'
        ? { ...(await this.files.describe(auth, id, version ?? null, ip)), stream: Readable.from([]) }
        : await this.files.open(auth, id, version ?? null, ip);
    return new StreamableFile(file.stream, {
      type: file.mediaType,
      length: file.byteSize,
      disposition: contentDisposition(file.originalName),
    }).setErrorLogger((error) => logger.warn(storageFailureSummary(error), 'File download stream failed'));
  }
}

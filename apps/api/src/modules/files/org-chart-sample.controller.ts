import { Readable } from 'node:stream';
import { ALLOWED_FILE_TYPES } from '@imbc/contracts';
import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { contentDisposition } from './files.controller.js';
import { storageFailureSummary } from './object-storage.js';
import { OrgChartSampleService } from './org-chart-sample.service.js';
import { acceptUpload, uploadInterceptor } from './upload.js';

const logger = new Logger('OrgChartSampleController');

/**
 * Образец оргструктуры (ADM-11, MAN-19): состояние — `reference.read` (администратор, директор), загрузка —
 * `reference.manage` (администратор). Права проверяет SessionGuard до разбора файла (GEN-08); файл проверяется
 * до хранилища (DATA-06); ответ загрузки — 202: образец станет текущим после скана (DATA-07). Текущий образец
 * для производителя — `current` и `current/content` без действия матрицы: доступ решает `orgChartSampleAccess`
 * в сервисе (SME, оператор, наблюдатель — 403). Все пути контроллера литеральные, параметров пути нет: маршруты
 * `current` ничего не перехватывают и не перехватываются (NFR-09).
 */
@ApiTags('reference')
@Controller('v1/org-chart-sample')
export class OrgChartSampleController {
  constructor(private readonly samples: OrgChartSampleService) {}

  @Get()
  @Can('reference.read')
  state() {
    return this.samples.state();
  }

  @Post()
  @HttpCode(202)
  @Can('reference.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(uploadInterceptor())
  async upload(@Auth() auth: AuthContext, @UploadedFile() file: Express.Multer.File | undefined, @Req() req: Request) {
    return this.samples.upload(auth.user, await acceptUpload(file), auditIp(req));
  }

  /** Описание текущего образца для ссылки «Скачать» (MAN-19). */
  @Get('current')
  current(@Auth() auth: AuthContext, @Req() req: Request) {
    return this.samples.current(auth.user, auditIp(req));
  }

  /**
   * Байты текущего образца — стабильная ссылка без id файла. Заголовки — как у `/api/v1/files/:id/content`
   * (`attachment`, `nosniff` и `no-store` — у всех ответов API). HEAD Express отдаёт этому же обработчику: те же
   * проверки и заголовки без чтения объекта и без записи «скачано» (`describeCurrent`).
   */
  @Get('current/content')
  @ApiProduces(...Object.keys(ALLOWED_FILE_TYPES), 'application/problem+json')
  async currentContent(@Auth() auth: AuthContext, @Req() req: Request): Promise<StreamableFile> {
    const ip = auditIp(req);
    const file =
      req.method === 'HEAD'
        ? { ...(await this.samples.describeCurrent(auth, ip)), stream: Readable.from([]) }
        : await this.samples.openCurrent(auth, ip);
    return new StreamableFile(file.stream, {
      type: file.mediaType,
      length: file.byteSize,
      disposition: contentDisposition(file.originalName),
    }).setErrorLogger((error) => logger.warn(storageFailureSummary(error), 'Sample download stream failed'));
  }
}

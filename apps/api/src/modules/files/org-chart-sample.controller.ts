import { Controller, Get, HttpCode, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { OrgChartSampleService } from './org-chart-sample.service.js';
import { acceptUpload, uploadInterceptor } from './upload.js';

/**
 * Образец оргструктуры (ADM-11, MAN-19): состояние — `reference.read` (администратор, директор), загрузка —
 * `reference.manage` (администратор). Права проверяет SessionGuard до разбора файла (GEN-08); файл проверяется
 * до хранилища (DATA-06); ответ загрузки — 202: образец станет текущим после скана (DATA-07). Скачивание —
 * `GET /api/v1/files/:id/content` (NFR-09).
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
}

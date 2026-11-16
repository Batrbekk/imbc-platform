import {
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import { ProblemException } from '../../common/problem.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { acceptUpload, uploadInterceptor } from '../files/upload.js';
import { SiteSurveyUploadService } from './site-survey-upload.service.js';

@Injectable()
export class SiteSurveyUploadGuard implements CanActivate {
  constructor(private readonly uploads: SiteSurveyUploadService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.auth) throw new ProblemException(401, 'unauthenticated', 'Требуется вход');
    await this.uploads.authorize(req.auth.user, String(req.params.profileId), auditIp(req));
    return true;
  }
}
@ApiTags('Site surveys')
@Controller('v1/profiles/:profileId/site-surveys/files')
export class SiteSurveyUploadController {
  constructor(private readonly uploads: SiteSurveyUploadService) {}
  @Get(':fileId/state')
  @Can('imbc_records.edit')
  metadata(
    @Auth() auth: AuthContext,
    @Param('profileId') profileId: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ) {
    return this.uploads.metadata(auth.user, profileId, fileId, auditIp(req));
  }
  @Post()
  @HttpCode(202)
  @Can('imbc_records.edit')
  @UseGuards(SiteSurveyUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(uploadInterceptor())
  upload(
    @Auth() auth: AuthContext,
    @Param('profileId') profileId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return acceptUpload(file).then((accepted) => this.uploads.upload(auth.user, profileId, accepted, auditIp(req)));
  }
}

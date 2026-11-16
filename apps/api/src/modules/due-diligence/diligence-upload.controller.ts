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
import { DiligenceUploadService } from './diligence-upload.service.js';

@Injectable()
export class DiligenceUploadGuard implements CanActivate {
  constructor(private readonly uploads: DiligenceUploadService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (!req.auth) throw new ProblemException(401, 'unauthenticated', 'Требуется вход');
    await this.uploads.authorize(req.auth.user, String(req.params.profileId), req.params.purpose, auditIp(req));
    return true;
  }
}
@ApiTags('Due diligence')
@Controller('v1/profiles/:profileId/due-diligence/files')
export class DiligenceUploadController {
  constructor(private readonly uploads: DiligenceUploadService) {}
  @Get(':purpose/:fileId')
  @Can('imbc_records.edit')
  metadata(
    @Auth() auth: AuthContext,
    @Param('profileId') profileId: string,
    @Param('purpose') purpose: string,
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ) {
    return this.uploads.metadata(auth.user, profileId, purpose, fileId, auditIp(req));
  }
  @Post(':purpose')
  @HttpCode(202)
  @Can('imbc_records.edit')
  @UseGuards(DiligenceUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(uploadInterceptor())
  upload(
    @Auth() auth: AuthContext,
    @Param('profileId') profileId: string,
    @Param('purpose') purpose: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request,
  ) {
    return acceptUpload(file).then((accepted) =>
      this.uploads.upload(auth.user, profileId, purpose, accepted, auditIp(req)),
    );
  }
}

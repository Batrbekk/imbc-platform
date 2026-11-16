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
import { ProfileUploadService } from './profile-upload.service.js';

/** Global SessionGuard runs first; profile state and target are checked before multipart consumes any bytes. */
@Injectable()
export class ProfileUploadGuard implements CanActivate {
  constructor(private readonly uploads: ProfileUploadService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.auth) throw new ProblemException(401, 'unauthenticated', 'Требуется вход');
    await this.uploads.authorize(request.auth.user, request.params.kind, request.params.purpose, auditIp(request));
    return true;
  }
}

@ApiTags('profiles')
@Controller('v1/profiles/own/sections')
export class ProfileUploadController {
  constructor(private readonly uploads: ProfileUploadService) {}

  @Get(':kind/files/:purpose/:fileId')
  @Can('profile.read')
  metadata(
    @Auth() auth: AuthContext,
    @Param('kind') kind: string,
    @Param('purpose') purpose: string,
    @Param('fileId') fileId: string,
    @Req() request: Request,
  ) {
    return this.uploads.metadata(auth.user, kind, purpose, fileId, auditIp(request));
  }

  @Post(':kind/files/:purpose')
  @HttpCode(202)
  @Can('profile.edit')
  @UseGuards(ProfileUploadGuard)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(uploadInterceptor())
  upload(
    @Auth() auth: AuthContext,
    @Param('kind') kind: string,
    @Param('purpose') purpose: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ) {
    return acceptUpload(file).then((accepted) =>
      this.uploads.upload(auth.user, kind, purpose, accepted, auditIp(request)),
    );
  }
}

import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { acceptCurrentNdaInputSchema } from '@imbc/contracts';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { CurrentNdaService } from './current-nda.service.js';

@ApiTags('NDA')
@Controller('v1/nda')
export class CurrentNdaController {
  constructor(private readonly nda: CurrentNdaService) {}
  @Get('current')
  @Can('profile.read')
  read(@Auth() auth: AuthContext, @Req() req: Request) {
    return this.nda.read(auth.user, auditIp(req));
  }
  @Post('current')
  @HttpCode(200)
  @Can('profile.read')
  accept(@Auth() auth: AuthContext, @Req() req: Request, @Body() body: unknown) {
    return this.nda.accept(auth.user, acceptCurrentNdaInputSchema.parse(body), auditIp(req));
  }
}

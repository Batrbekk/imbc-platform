import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { DiligenceRunService } from './diligence-run.service.js';
@ApiTags('Due diligence')
@Controller('v1/profiles/:profileId/due-diligence/runs')
export class DiligenceRunController {
  constructor(private readonly runs: DiligenceRunService) {}
  @Post()
  @HttpCode(202)
  @Can('external_checks.run')
  request(
    @Auth() auth: AuthContext,
    @Param('profileId') profileId: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.runs.request(auth.user, profileId, body, auditIp(req));
  }
}

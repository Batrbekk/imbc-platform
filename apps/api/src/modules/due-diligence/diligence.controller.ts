import { Body, Controller, Get, Param, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { DiligenceService } from './diligence.service.js';
const historyQuery = z.strictObject({ beforeId: z.uuid().optional() });

@ApiTags('Due diligence')
@Controller('v1/profiles/:profileId/due-diligence')
export class DiligenceController {
  constructor(private readonly diligence: DiligenceService) {}
  @Get()
  @Can('imbc_records.read')
  read(@Auth() auth: AuthContext, @Req() req: Request, @Param('profileId') profileId: string) {
    return this.diligence.read({ actor: auth.user, ip: auditIp(req) }, profileId);
  }
  @Get('history')
  @Can('imbc_records.read')
  history(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Param('profileId') profileId: string,
    @Query() query: unknown,
  ) {
    return this.diligence.history(
      { actor: auth.user, ip: auditIp(req) },
      profileId,
      historyQuery.parse(query).beforeId,
    );
  }
  @Put('override')
  @Can('imbc_records.edit')
  override(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Param('profileId') profileId: string,
    @Body() body: unknown,
  ) {
    return this.diligence.override({ actor: auth.user, ip: auditIp(req) }, profileId, body);
  }
  @Put('enhanced')
  @Can('imbc_records.edit')
  enhanced(
    @Auth() auth: AuthContext,
    @Req() req: Request,
    @Param('profileId') profileId: string,
    @Body() body: unknown,
  ) {
    return this.diligence.enhanced({ actor: auth.user, ip: auditIp(req) }, profileId, body);
  }
}

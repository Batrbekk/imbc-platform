import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ProfileSubmissionStateService } from './profile-submission-state.service.js';

@ApiTags('profiles')
@Controller('v1/profiles/own')
export class ProfileSubmissionStateController {
  constructor(private readonly profiles: ProfileSubmissionStateService) {}
  @Get('submission')
  @Can('profile.read')
  current(@Auth() auth: AuthContext, @Req() request: Request) {
    return this.profiles.current(auth.user, auditIp(request));
  }
}

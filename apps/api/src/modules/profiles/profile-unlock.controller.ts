import { profileUnlockInputSchema } from '@imbc/contracts';
import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ProfileUnlockService } from './profile-unlock.service.js';

@ApiTags('profiles')
@Controller('v1/profiles/own')
export class ProfileUnlockController {
  constructor(private readonly profiles: ProfileUnlockService) {}
  @Post('unlock')
  @Can('profile.edit')
  unlock(@Auth() auth: AuthContext, @Body() input: unknown, @Req() request: Request) {
    return this.profiles.unlock(auth.user, profileUnlockInputSchema.parse(input), auditIp(request));
  }
}

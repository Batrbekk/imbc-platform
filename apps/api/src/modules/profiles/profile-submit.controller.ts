import { profileSubmitInputSchema } from '@imbc/contracts';
import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ProfileSubmitService } from './profile-submit.service.js';
import { sectionValidationError } from './section-errors.js';

/** The persisted own manufacturer profile is the only target; the body selects no actor or reviewer. */
@ApiTags('profiles')
@Controller('v1/profiles/own')
export class ProfileSubmitController {
  constructor(private readonly profiles: ProfileSubmitService) {}

  @Post('submit')
  @Can('profile.edit')
  submit(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: Request) {
    const parsed = profileSubmitInputSchema.safeParse(body);
    if (!parsed.success) throw sectionValidationError(parsed.error);
    return this.profiles.submit(auth.user, parsed.data, auditIp(req));
  }
}

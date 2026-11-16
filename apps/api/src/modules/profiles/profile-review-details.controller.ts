import { Controller, Get, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ProfileReviewDetailsService } from './profile-review-details.service.js';

@ApiTags('profiles')
@Controller('v1/profiles/own')
export class ProfileReviewDetailsController {
  constructor(private readonly reviews: ProfileReviewDetailsService) {}
  @Get('review')
  @Can('profile.read')
  read(@Auth() auth: AuthContext, @Req() request: Request) {
    return this.reviews.read(auth.user, auditIp(request));
  }
}

import { reviewQueueFilterSchema, reviewAssignmentQueueFilterSchema } from '@imbc/contracts';
import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import { parseOrThrow } from '../../common/problem.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('reviews')
@Controller('v1/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}
  @Get('queue')
  @Can('review.take')
  queue(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Req() req: Request) {
    return this.reviews.queue(auth.user, parseOrThrow(reviewQueueFilterSchema, query), auditIp(req));
  }
  @Get('assignment-queue')
  @Can('review.assign')
  assignmentQueue(@Auth() auth: AuthContext, @Query() query: Record<string, unknown>, @Req() req: Request) {
    return this.reviews.assignmentQueue(
      auth.user,
      parseOrThrow(reviewAssignmentQueueFilterSchema, query),
      auditIp(req),
    );
  }
  @Get('experts')
  @Can('review.assign')
  experts(@Auth() auth: AuthContext, @Req() req: Request) {
    return this.reviews.experts(auth.user, auditIp(req));
  }
  @Get('queue/experts')
  @Can('review.take')
  queueExperts(@Auth() auth: AuthContext, @Req() req: Request) {
    return this.reviews.queueExperts(auth.user, auditIp(req));
  }
}

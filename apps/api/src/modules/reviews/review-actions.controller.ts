import { reviewTakeInputSchema, reviewSubmitResultInputSchema } from '@imbc/contracts';
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import { parseOrThrow } from '../../common/problem.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { ReviewAssignmentService } from './review-assignment.service.js';
import { ReviewWorkbenchService } from './review-workbench.service.js';

@ApiTags('reviews')
@Controller('v1/reviews/assignments/:id')
export class ReviewActionsController {
  constructor(
    private readonly assignments: ReviewAssignmentService,
    private readonly workbench: ReviewWorkbenchService,
  ) {}
  @Post('take')
  @Can('review.take')
  take(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    parseOrThrow(reviewTakeInputSchema, body);
    return this.assignments.take(auth.user, id, auditIp(req));
  }
  @Post('assign')
  @Can('review.assign')
  assign(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.assignments.assign(auth.user, id, body, auditIp(req));
  }
  @Get()
  @Can('profile.read')
  read(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.workbench.read(auth.user, id, auditIp(req));
  }
  @Post('open')
  @Can('profile.read')
  open(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    parseOrThrow(reviewTakeInputSchema, body);
    return this.workbench.open(auth.user, id, auditIp(req));
  }
  @Get('sections/:kind')
  @Can('profile.read')
  section(@Auth() auth: AuthContext, @Param('id') id: string, @Param('kind') kind: string, @Req() req: Request) {
    return this.workbench.section(auth.user, id, kind, auditIp(req));
  }
  @Post('section-decision')
  @Can('profile.verify')
  decideSection(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.workbench.decideSection(auth.user, id, body, auditIp(req));
  }
  @Post('submit-result')
  @Can('profile.verify')
  submitResult(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    parseOrThrow(reviewSubmitResultInputSchema, body);
    return this.workbench.submitResult(auth.user, id, auditIp(req));
  }
}

/** Exact administrative reload stays on the same metadata-only projection as its queue. */
@ApiTags('reviews')
@Controller('v1/reviews/assignment-queue')
export class ReviewAssignmentMetadataController {
  constructor(private readonly assignments: ReviewAssignmentService) {}
  @Get(':id')
  @Can('review.assign')
  read(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.assignments.readMetadata(auth.user, id, auditIp(req));
  }
}

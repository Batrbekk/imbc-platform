import { reviewQueueFilterSchema } from '@imbc/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseOrThrow } from '../../common/problem.js';
import { Can } from '../auth/guards.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('reviews')
@Controller('v1/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  /** Очередь проверки SME, только для чтения (REV-01, REV-04); фильтр по статусу — из адреса страницы. */
  @Get('queue')
  @Can('review.take')
  queue(@Query() query: Record<string, unknown>) {
    return this.reviews.queue(parseOrThrow(reviewQueueFilterSchema, query));
  }
}

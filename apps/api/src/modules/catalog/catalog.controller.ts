import { catalogFilterSchema } from '@imbc/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseOrThrow } from '../../common/problem.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { CatalogService } from './catalog.service.js';

@ApiTags('catalog')
@Controller('v1')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  /** Поиск по видимым верифицированным профилям; фильтры — те же, что в адресе страницы (OPR-01…08). */
  @Get('catalog/search')
  @Can('catalog.search')
  search(@Query() query: Record<string, unknown>, @Auth() auth: AuthContext) {
    return this.catalog.search(parseOrThrow(catalogFilterSchema, query), auth.scope!);
  }

  @Get('dashboard')
  @Can('dashboard.read')
  dashboard() {
    return this.catalog.dashboard();
  }
}

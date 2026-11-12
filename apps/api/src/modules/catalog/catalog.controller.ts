import { catalogFilterSchema } from '@imbc/contracts';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
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

  /**
   * Страница компании из каталога, только для чтения (OPR-09…12): строка проекции catalog_visible.
   * Профиль вне проекции — 404 для любой роли; focal point — только роли с focal_point.read (GEN-13).
   */
  @Get('catalog/companies/:profileId')
  @Can('catalog.search')
  company(@Param('profileId') profileId: string, @Auth() auth: AuthContext) {
    return this.catalog.company(parseOrThrow(z.uuid(), profileId), auth.user.role);
  }

  @Get('dashboard')
  @Can('dashboard.read')
  dashboard() {
    return this.catalog.dashboard();
  }
}

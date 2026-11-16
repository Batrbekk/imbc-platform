import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { LOCALES, lpsFiltersSchema } from '@imbc/contracts';
import { auditIp } from '../../common/audit-ip.js';
import type { AuthContext } from '../auth/auth.types.js';
import { Auth, Can } from '../auth/guards.js';
import { LpsService } from './lps.service.js';

const localeQuery = z.strictObject({ locale: z.enum(LOCALES).default('kk') });
const dashboardQuery = lpsFiltersSchema.safeExtend({ locale: z.enum(LOCALES).default('kk') });
@ApiTags('LPS')
@Controller('v1/lps')
export class LpsController {
  constructor(private readonly lps: LpsService) {}
  @Get('companies')
  @Can('lps.read')
  companies(@Auth() auth: AuthContext, @Req() req: Request, @Query() query: unknown) {
    return this.lps.listCompanies({ actor: auth.user, ip: auditIp(req) }, query);
  }
  @Post('companies')
  @Can('lps.edit')
  createCompany(@Auth() auth: AuthContext, @Req() req: Request, @Body() body: unknown) {
    return this.lps.createCompany({ actor: auth.user, ip: auditIp(req) }, body);
  }
  @Get('companies/:id')
  @Can('lps.read')
  company(@Auth() auth: AuthContext, @Req() req: Request, @Param('id') id: string, @Query() query: unknown) {
    return this.lps.readCompany({ actor: auth.user, ip: auditIp(req) }, id, localeQuery.parse(query).locale);
  }
  @Put('companies/:id')
  @Can('lps.edit')
  updateCompany(@Auth() auth: AuthContext, @Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.lps.updateCompany({ actor: auth.user, ip: auditIp(req) }, id, body);
  }
  @Delete('companies/:id')
  @HttpCode(204)
  @Can('lps.edit')
  deleteCompany(@Auth() auth: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.lps.deleteCompany({ actor: auth.user, ip: auditIp(req) }, id);
  }
  @Get('entries')
  @Can('lps.read')
  entries(@Auth() auth: AuthContext, @Req() req: Request, @Query() query: unknown) {
    return this.lps.list({ actor: auth.user, ip: auditIp(req) }, query);
  }
  @Post('entries')
  @Can('lps.edit')
  createEntry(@Auth() auth: AuthContext, @Req() req: Request, @Body() body: unknown) {
    return this.lps.createEntry({ actor: auth.user, ip: auditIp(req) }, body);
  }
  @Get('entries/:id')
  @Can('lps.read')
  entry(@Auth() auth: AuthContext, @Req() req: Request, @Param('id') id: string, @Query() query: unknown) {
    return this.lps.readEntry({ actor: auth.user, ip: auditIp(req) }, id, localeQuery.parse(query).locale);
  }
  @Put('entries/:id')
  @Can('lps.edit')
  updateEntry(@Auth() auth: AuthContext, @Req() req: Request, @Param('id') id: string, @Body() body: unknown) {
    return this.lps.updateEntry({ actor: auth.user, ip: auditIp(req) }, id, body);
  }
  @Delete('entries/:id')
  @HttpCode(204)
  @Can('lps.edit')
  deleteEntry(@Auth() auth: AuthContext, @Req() req: Request, @Param('id') id: string) {
    return this.lps.deleteEntry({ actor: auth.user, ip: auditIp(req) }, id);
  }
  @Get('dashboard')
  @Can('lps.dashboard')
  dashboard(@Auth() auth: AuthContext, @Req() req: Request, @Query() query: unknown) {
    const { locale, ...filters } = dashboardQuery.parse(query);
    return this.lps.dashboard({ actor: auth.user, ip: auditIp(req) }, filters, locale);
  }
}

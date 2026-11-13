import { createOrganizationSchema, imbcMailboxSchema, majorOperatorSchema } from '@imbc/contracts';
import { Body, Controller, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import { parseOrThrow } from '../../common/problem.js';
import { Auth, Can } from '../auth/guards.js';
import type { AuthContext } from '../auth/auth.types.js';
import { OrganizationsService } from './organizations.service.js';

/** Организации операторов и наблюдателей, отметка major operator, ящик IMBC (ADM-03, GEN-05, раздел 8.2). */
@ApiTags('admin')
@Controller('v1/admin')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Post('organizations')
  @HttpCode(201)
  @Can('accounts.manage')
  async create(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: Request) {
    return this.organizations.create(auth.user, parseOrThrow(createOrganizationSchema, body), auditIp(req));
  }

  @Put('organizations/:id/major-operator')
  @Can('accounts.manage')
  async setMajorOperator(
    @Auth() auth: AuthContext,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const { isMajorOperator } = parseOrThrow(majorOperatorSchema, body);
    return this.organizations.setMajorOperator(auth.user, id, isMajorOperator, auditIp(req));
  }

  @Put('imbc-mailbox')
  @Can('accounts.manage')
  async setImbcMailbox(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: Request) {
    const { email } = parseOrThrow(imbcMailboxSchema, body);
    return this.organizations.setImbcMailbox(auth.user, email, auditIp(req));
  }
}

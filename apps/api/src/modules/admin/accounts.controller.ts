import { inviteAccountSchema } from '@imbc/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { parseOrThrow } from '../../common/problem.js';
import { Auth, Can } from '../auth/guards.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AccountsService } from './accounts.service.js';
import { InvitationsService } from './invitations.service.js';
import { auditIp } from './organizations.controller.js';

@ApiTags('admin')
@Controller('v1/admin/accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly invitations: InvitationsService,
  ) {}

  /** Организации и аккаунты для администратора, только для чтения (ADM-02, ADM-06). */
  @Get()
  @Can('accounts.manage')
  list() {
    return this.accounts.list();
  }

  /** Приглашение сотрудника IMBC, оператора или наблюдателя (ADM-01, NOT-24). */
  @Post()
  @HttpCode(201)
  @Can('accounts.manage')
  async invite(@Auth() auth: AuthContext, @Body() body: unknown, @Req() req: Request) {
    return this.invitations.invite(auth.user, parseOrThrow(inviteAccountSchema, body), auditIp(req));
  }

  /** Повтор письма приглашения (NOT-24, AUTH-01). */
  @Post(':id/invitation')
  @HttpCode(202)
  @Can('accounts.manage')
  async resend(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.invitations.resend(auth.user, id, auditIp(req));
  }
}

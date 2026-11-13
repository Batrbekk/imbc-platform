import { changeEmailSchema, changeRoleSchema, inviteAccountSchema } from '@imbc/contracts';
import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { auditIp } from '../../common/audit-ip.js';
import { parseOrThrow } from '../../common/problem.js';
import { Auth, Can } from '../auth/guards.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AccountLifecycleService } from './account-lifecycle.service.js';
import { AccountsService } from './accounts.service.js';
import { InvitationsService } from './invitations.service.js';

@ApiTags('admin')
@Controller('v1/admin/accounts')
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly invitations: InvitationsService,
    private readonly lifecycle: AccountLifecycleService,
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

  /** Блокировка (ADM-02): открытые сеансы завершаются сразу (AUTH-06). */
  @Post(':id/block')
  @HttpCode(200)
  @Can('accounts.manage')
  async block(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.lifecycle.block(auth.user, id, auditIp(req));
  }

  /** Разблокировка (ADM-02). */
  @Post(':id/unblock')
  @HttpCode(200)
  @Can('accounts.manage')
  async unblock(@Auth() auth: AuthContext, @Param('id') id: string, @Req() req: Request) {
    return this.lifecycle.unblock(auth.user, id, auditIp(req));
  }

  /** Смена роли сотрудника IMBC (AUTH-06). */
  @Put(':id/role')
  @Can('accounts.manage')
  async changeRole(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.lifecycle.changeRole(auth.user, id, parseOrThrow(changeRoleSchema, body).role, auditIp(req));
  }

  /** Смена почты-логина производителя (ADM-05, MAN-05) — единственный маршрут, меняющий почту-логин. */
  @Put(':id/email')
  @Can('accounts.manage')
  async changeEmail(@Auth() auth: AuthContext, @Param('id') id: string, @Body() body: unknown, @Req() req: Request) {
    return this.lifecycle.changeEmail(auth.user, id, parseOrThrow(changeEmailSchema, body).email, auditIp(req));
  }
}

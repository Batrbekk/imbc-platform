import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Can } from '../auth/guards.js';
import { AccountsService } from './accounts.service.js';

@ApiTags('admin')
@Controller('v1/admin/accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** Организации и аккаунты для администратора, только для чтения (ADM-02, ADM-06). */
  @Get()
  @Can('accounts.manage')
  list() {
    return this.accounts.list();
  }
}

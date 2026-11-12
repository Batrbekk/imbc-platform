import { type AdminAccount, type AdminAccounts, adminAccountsSchema } from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { asc, sql } from 'drizzle-orm';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import { organizations, userAccounts } from '../../database/schema/index.js';

/** Порядок типов в списке: IMBC, операторы, наблюдатели, производители. */
const TYPE_ORDER = sql`case ${organizations.type} when 'imbc' then 0 when 'operator' then 1 when 'observer' then 2 else 3 end`;

/**
 * Организации и аккаунты для администратора (ADM-02). Читает только organizations и user_accounts:
 * профиль производителя и проекцию каталога администратор не видит, БИН не отдаётся (ADM-06).
 * Приглашение и блокировка — этап 1.
 */
@Injectable()
export class AccountsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<AdminAccounts> {
    const orgs = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        type: organizations.type,
        isMajorOperator: organizations.isMajorOperator,
      })
      .from(organizations)
      .orderBy(TYPE_ORDER, asc(organizations.name), asc(organizations.id));
    const rows = await this.db
      .select({
        organizationId: userAccounts.organizationId,
        id: userAccounts.id,
        email: userAccounts.email,
        fullName: userAccounts.fullName,
        role: userAccounts.role,
        state: userAccounts.state,
        lastSignInAt: userAccounts.lastSignInAt,
      })
      .from(userAccounts)
      .orderBy(asc(userAccounts.email), asc(userAccounts.id));

    const byOrganization = new Map<string, AdminAccount[]>();
    for (const { organizationId, lastSignInAt, ...account } of rows) {
      const list = byOrganization.get(organizationId) ?? [];
      list.push({ ...account, lastSignInAt: lastSignInAt?.toISOString() ?? null });
      byOrganization.set(organizationId, list);
    }
    const result = { organizations: orgs.map((o) => ({ ...o, accounts: byOrganization.get(o.id) ?? [] })) };
    return parseResponse(adminAccountsSchema, result, 'организации и аккаунты');
  }
}

import { and, asc, eq, ne } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import { manufacturerProfiles, organizations, userAccounts } from '../database/schema/index.js';
import type { NotifyJob } from './enqueue.js';
import type { RecipientPart } from './rules.js';

/**
 * Получатель письма. `source` решает, кто остаётся при совпадении адресов (account → contact → imbc_mailbox,
 * NOT-18); `languageAccountId` — аккаунт, чей язык у письма (NOT-19): у аккаунта — он сам, у контакта —
 * аккаунт производителя, у ящика IMBC — нет (казахский).
 */
export interface Recipient {
  email: string;
  source: 'account' | 'contact' | 'imbc_mailbox';
  accountId: string | null;
  languageAccountId: string | null;
}

export type RecipientResolver = (db: Database, job: NotifyJob) => Promise<Recipient[]>;

/** Часть получателей, данные которой появятся на своём этапе: письмо не уходит никому, задание падает. */
export class RecipientPartNotReady extends Error {
  constructor(
    readonly part: RecipientPart,
    readonly stage: '3' | '5',
  ) {
    super(`notification: часть получателей ${part} появится на этапе ${stage}`);
    this.name = 'RecipientPartNotReady';
  }
}

export const RECIPIENT_RESOLVERS = Symbol('RECIPIENT_RESOLVERS');

const accountRecipient = (account: { id: string; email: string }): Recipient => ({
  email: account.email,
  source: 'account',
  accountId: account.id,
  languageAccountId: account.id,
});

const accountColumns = { id: userAccounts.id, email: userAccounts.email };

const notReady =
  (part: RecipientPart, stage: '3' | '5'): RecipientResolver =>
  async () => {
    throw new RecipientPartNotReady(part, stage);
  };

/** Организация события: явно или через профиль производителя. */
async function eventOrganization(db: Database, job: NotifyJob): Promise<string | null> {
  if (job.organizationId) return job.organizationId;
  if (!job.profileId) throw new Error(`notification ${job.rule}: manufacturer_account без organizationId и profileId`);
  const [profile] = await db
    .select({ organizationId: manufacturerProfiles.organizationId })
    .from(manufacturerProfiles)
    .where(eq(manufacturerProfiles.id, job.profileId));
  return profile?.organizationId ?? null;
}

/** Части получателей правил раздела 8.2. Адреса читаются из БД при отправке, в задании их нет. */
export const DEFAULT_RECIPIENT_RESOLVERS: Record<RecipientPart, RecipientResolver> = {
  /** Аккаунт события: тот, кто вошёл, заблокирован, отправил запрос или подписан (NOT-02, NOT-03, NOT-08…). */
  person: async (db, job) => {
    if (!job.accountId) throw new Error(`notification ${job.rule}: person без accountId`);
    return (await db.select(accountColumns).from(userAccounts).where(eq(userAccounts.id, job.accountId))).map(
      accountRecipient,
    );
  },
  /** Единственный аккаунт организации-производителя (D-01). */
  manufacturer_account: async (db, job) => {
    const organizationId = await eventOrganization(db, job);
    if (!organizationId) return [];
    return (
      await db
        .select(accountColumns)
        .from(userAccounts)
        .where(and(eq(userAccounts.organizationId, organizationId), eq(userAccounts.role, 'manufacturer')))
    ).map(accountRecipient);
  },
  focal_point: notReady('focal_point', '3'),
  manufacturer_contacts: notReady('manufacturer_contacts', '3'),
  /** Ящик IMBC, который задаёт администратор (раздел 8.2); не задан — никого. */
  imbc_mailbox: async (db) => {
    const [imbc] = await db
      .select({ mailbox: organizations.notificationMailbox })
      .from(organizations)
      .where(eq(organizations.type, 'imbc'));
    const mailbox = imbc?.mailbox?.trim();
    return mailbox ? [{ email: mailbox, source: 'imbc_mailbox', accountId: null, languageAccountId: null }] : [];
  },
  assigned_sme_or_imbc_mailbox: notReady('assigned_sme_or_imbc_mailbox', '5'),
  /** Аккаунты организаций-операторов, кроме blocked: invited и inactive тоже (NOT-11). */
  operator_accounts_not_blocked: async (db) =>
    (
      await db
        .select(accountColumns)
        .from(userAccounts)
        .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
        .where(and(eq(organizations.type, 'operator'), ne(userAccounts.state, 'blocked')))
        .orderBy(asc(userAccounts.createdAt), asc(userAccounts.id))
    ).map(accountRecipient),
};

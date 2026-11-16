import { and, asc, eq, ne } from 'drizzle-orm';
import type { Database } from '../database/database.module.js';
import {
  contact,
  manufacturerProfile,
  organizations,
  reviewAssignment,
  userAccounts,
} from '../database/schema/index.js';
import { profileCandidateRevisions, profileSubmissionRevisions } from '../modules/profiles/profile-candidate.js';
import type { NotifyJob } from './enqueue.js';
import { PermanentNotificationError } from './errors.js';
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

export const RECIPIENT_RESOLVERS = Symbol('RECIPIENT_RESOLVERS');

const accountRecipient = (account: { id: string; email: string }): Recipient => ({
  email: account.email,
  source: 'account',
  accountId: account.id,
  languageAccountId: account.id,
});

const accountColumns = { id: userAccounts.id, email: userAccounts.email };

/** Организация события: явно или через профиль производителя. */
async function eventOrganization(db: Database, job: NotifyJob): Promise<string | null> {
  if (!job.profileId && job.organizationId) return job.organizationId;
  if (!job.profileId)
    throw new PermanentNotificationError(
      `notification ${job.rule}: manufacturer_account без organizationId и profileId`,
    );
  const [profile] = await db
    .select({ organizationId: manufacturerProfile.organizationId })
    .from(manufacturerProfile)
    .where(eq(manufacturerProfile.id, job.profileId));
  if (job.organizationId && profile?.organizationId !== job.organizationId)
    throw new PermanentNotificationError(`notification ${job.rule}: profile вне organization контекста`);
  return profile?.organizationId ?? null;
}

/** Контакты принадлежат каноническому профилю производителя, а не одному UUID организации. */
async function eventProfile(db: Database, job: NotifyJob) {
  if (!job.profileId && !job.organizationId)
    throw new PermanentNotificationError(`notification ${job.rule}: контакты без profileId и organizationId`);
  const [profile] = await db
    .select({ profileId: manufacturerProfile.id, organizationId: manufacturerProfile.organizationId })
    .from(manufacturerProfile)
    .innerJoin(organizations, eq(organizations.id, manufacturerProfile.organizationId))
    .where(
      and(
        job.profileId ? eq(manufacturerProfile.id, job.profileId) : undefined,
        job.organizationId ? eq(manufacturerProfile.organizationId, job.organizationId) : undefined,
        eq(organizations.type, 'manufacturer'),
      ),
    );
  if (!profile) throw new PermanentNotificationError(`notification ${job.rule}: profile вне organization контекста`);
  return profile;
}

/** Исторические события несут ID назначения: закрытие/новый цикл не меняют адресата этого события. */
function assignmentId(job: NotifyJob): string {
  if (job.related?.type !== 'review_assignment')
    throw new PermanentNotificationError(`notification ${job.rule}: review_assignment без related.id`);
  return job.related.id;
}

async function eventAssignment(db: Database, job: NotifyJob) {
  const id = assignmentId(job);
  const context = await eventProfile(db, job);
  const [assignment] = await db
    .select({ expertId: reviewAssignment.expertId })
    .from(reviewAssignment)
    .where(
      and(
        eq(reviewAssignment.id, id),
        eq(reviewAssignment.profileId, context.profileId),
        eq(reviewAssignment.organizationId, context.organizationId),
      ),
    );
  if (!assignment)
    throw new PermanentNotificationError(`notification ${job.rule}: review_assignment вне profile контекста`);
  return { ...context, assignmentId: id, expertId: assignment.expertId };
}

const contactRecipients =
  (focalPointOnly: boolean): RecipientResolver =>
  async (db, job) => {
    // NOT-05 cannot use an edited focal point after a later unlock or Send.
    const historical = job.rule === 'NOT-05' || job.related?.type === 'review_assignment';
    const assignment = historical ? await eventAssignment(db, job) : null;
    const context = assignment ?? (await eventProfile(db, job));
    const revisions = assignment
      ? await profileSubmissionRevisions(db, assignment)
      : await profileCandidateRevisions(db, context);
    const revisionId = revisions.find((section) => section.kind === 'contacts')?.revisionId;
    if (!revisionId)
      throw new PermanentNotificationError(`notification ${job.rule}: отсутствует точная редакция contacts`);
    const [manufacturer] = await db
      .select({ id: userAccounts.id })
      .from(userAccounts)
      .where(and(eq(userAccounts.organizationId, context.organizationId), eq(userAccounts.role, 'manufacturer')));
    const rows = await db
      .select({ email: contact.email })
      .from(contact)
      .where(
        and(
          eq(contact.sectionRevisionId, revisionId),
          eq(contact.organizationId, context.organizationId),
          focalPointOnly ? eq(contact.isFocalPoint, true) : undefined,
        ),
      )
      .orderBy(asc(contact.positionInList), asc(contact.id));
    return rows.flatMap(({ email }) => {
      const address = email?.trim();
      return address
        ? [{ email: address, source: 'contact' as const, accountId: null, languageAccountId: manufacturer?.id ?? null }]
        : [];
    });
  };

const imbcMailbox: RecipientResolver = async (db) => {
  const [imbc] = await db
    .select({ mailbox: organizations.notificationMailbox })
    .from(organizations)
    .where(eq(organizations.type, 'imbc'));
  const mailbox = imbc?.mailbox?.trim();
  return mailbox ? [{ email: mailbox, source: 'imbc_mailbox', accountId: null, languageAccountId: null }] : [];
};

/** Части получателей правил раздела 8.2. Адреса читаются из БД при отправке, в задании их нет. */
export const DEFAULT_RECIPIENT_RESOLVERS: Record<RecipientPart, RecipientResolver> = {
  /** Аккаунт события: тот, кто вошёл, заблокирован, отправил запрос или подписан (NOT-02, NOT-03, NOT-08…). */
  person: async (db, job) => {
    if (!job.accountId) throw new PermanentNotificationError(`notification ${job.rule}: person без accountId`);
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
  focal_point: contactRecipients(true),
  manufacturer_contacts: contactRecipients(false),
  /** Ящик IMBC, который задаёт администратор (раздел 8.2); не задан — никого. */
  imbc_mailbox: imbcMailbox,
  assigned_sme_or_imbc_mailbox: async (db, job) => {
    const { expertId } = await eventAssignment(db, job);
    if (!expertId) return imbcMailbox(db, job);
    const [expert] = await db
      .select(accountColumns)
      .from(userAccounts)
      .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
      .where(and(eq(userAccounts.id, expertId), eq(userAccounts.role, 'expert'), eq(organizations.type, 'imbc')));
    if (!expert) throw new PermanentNotificationError(`notification ${job.rule}: назначенный SME вне IMBC контекста`);
    return [accountRecipient(expert)];
  },
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

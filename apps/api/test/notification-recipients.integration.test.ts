import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { applyAppRoleGrants } from '../src/database/app-role.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { MailService } from '../src/mail/mail.service.js';
import { copyRevisionContent } from '../src/modules/profiles/revision-copy.js';
import { NotificationDispatcher } from '../src/notifications/dispatcher.js';
import { notifyJobSchema, type NotifyJob } from '../src/notifications/enqueue.js';
import { PermanentNotificationError } from '../src/notifications/errors.js';
import { DEFAULT_RECIPIENT_RESOLVERS as resolvers } from '../src/notifications/recipients.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { fakeTransport } from './support/mail.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('scoped current and immutable notification recipients', () => {
  vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let rolePool: pg.Pool;
  let app: Database;
  let imbcId: string;
  let expertId: string;
  let otherExpertId: string;
  const role = `notify_scope_${randomUUID().replaceAll('-', '')}`;
  const mailbox = 'review-mailbox@recipient.local';
  const expertEmail = 'assigned-expert@recipient.local';
  const otherExpertEmail = 'next-expert@recipient.local';

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    imbcId = (await db.select().from(schema.organizations).where(eq(schema.organizations.type, 'imbc')))[0]!.id;
    await db
      .update(schema.organizations)
      .set({ notificationMailbox: mailbox })
      .where(eq(schema.organizations.id, imbcId));
    const accounts = await db
      .insert(schema.userAccounts)
      .values([
        { organizationId: imbcId, email: expertEmail, role: 'expert', state: 'active', locale: 'ru' },
        { organizationId: imbcId, email: otherExpertEmail, role: 'expert', state: 'active', locale: 'en' },
      ])
      .returning();
    expertId = accounts[0]!.id;
    otherExpertId = accounts[1]!.id;
    await pool.query(`CREATE ROLE "${role}" NOLOGIN`);
    await pool.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    await applyAppRoleGrants(pool, role);
    rolePool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 3, options: `-c role=${role}` });
    app = drizzle(rolePool, { schema, casing: 'snake_case' });
  });
  afterAll(async () => {
    await rolePool?.end();
    if (pool) await pool.query(`DROP OWNED BY "${role}"; DROP ROLE "${role}"`);
    await pool?.end();
  });

  async function profile() {
    const [org] = await db
      .insert(schema.organizations)
      .values({ type: 'manufacturer', name: `Recipient ${randomUUID()}` })
      .returning();
    const [account] = await db
      .insert(schema.userAccounts)
      .values({
        organizationId: org!.id,
        email: `${randomUUID()}@recipient.local`,
        role: 'manufacturer',
        state: 'active',
        locale: 'en',
      })
      .returning();
    const [p] = await db.insert(schema.manufacturerProfile).values({ organizationId: org!.id }).returning();
    const sections = await db.select().from(schema.profileSection).where(eq(schema.profileSection.profileId, p!.id));
    const contactsRevision = sections.find((s) => s.kind === 'contacts')!.workingRevisionId!;
    return {
      profileId: p!.id,
      organizationId: org!.id,
      accountId: account!.id,
      accountEmail: account!.email,
      contactsRevision,
      sections,
    };
  }
  type Profile = Awaited<ReturnType<typeof profile>>;
  async function contacts(
    p: Profile,
    revision = p.contactsRevision,
    emails = ['focal@recipient.local', 'other@recipient.local', null],
  ) {
    await db.insert(schema.contact).values(
      emails.map((email, index) => ({
        sectionRevisionId: revision,
        organizationId: p.organizationId,
        email,
        isFocalPoint: index === 0,
        positionInList: index,
      })),
    );
  }
  const currentJob = (p: Profile, rule: NotifyJob['rule'] = 'NOT-12'): NotifyJob => ({
    rule,
    eventKey: `${rule}:${randomUUID()}`,
    profileId: p.profileId,
    organizationId: p.organizationId,
    params: {},
  });
  const reviewJob = (p: Profile, assignment: string, rule: NotifyJob['rule'] = 'NOT-05'): NotifyJob => ({
    ...currentJob(p, rule),
    related: { type: 'review_assignment', id: assignment },
  });
  async function submit(p: Profile, expert: string | null = expertId) {
    return db.transaction(async (tx) => {
      const sections = await tx
        .select()
        .from(schema.profileSection)
        .where(eq(schema.profileSection.profileId, p.profileId));
      const selected = sections.map((s) => ({
        section: s,
        revisionId:
          s.workingRevisionId ??
          s.pendingRevisionId ??
          s.verifiedRevisionId ??
          p.sections.find((old) => old.id === s.id)!.workingRevisionId!,
      }));
      await tx
        .update(schema.profileSection)
        .set({ workingRevisionId: null })
        .where(eq(schema.profileSection.profileId, p.profileId));
      for (const { revisionId } of selected) {
        const [revision] = await tx
          .select()
          .from(schema.sectionRevision)
          .where(eq(schema.sectionRevision.id, revisionId));
        if (revision!.state === 'working')
          await tx
            .update(schema.sectionRevision)
            .set({ state: 'submitted', submittedAt: new Date('2026-11-16T00:00:00Z') })
            .where(eq(schema.sectionRevision.id, revisionId));
      }
      const [assignment] = await tx
        .insert(schema.reviewAssignment)
        .values({
          profileId: p.profileId,
          organizationId: p.organizationId,
          receivedAt: new Date('2026-11-16T00:00:00Z'),
          accuracyConfirmedAt: new Date('2026-11-16T00:00:00Z'),
          submittedBy: p.accountId,
          submissionMode: 'initial',
          operationKey: randomUUID(),
          requestFingerprint: 'a'.repeat(64),
          ...(expert ? { expertId: expert, assignedBy: expert, assignedAt: new Date('2026-11-16T00:00:00Z') } : {}),
        })
        .returning();
      await tx.insert(schema.reviewAssignmentSection).values(
        selected.map(({ section, revisionId }) => ({
          reviewAssignmentId: assignment!.id,
          profileId: p.profileId,
          organizationId: p.organizationId,
          profileSectionId: section.id,
          sectionRevisionId: revisionId,
          reviewRequired: true,
        })),
      );
      for (const { section, revisionId } of selected) {
        await tx
          .insert(schema.profileSectionCandidate)
          .values({
            profileSectionId: section.id,
            organizationId: p.organizationId,
            reviewAssignmentId: assignment!.id,
            sectionRevisionId: revisionId,
          })
          .onConflictDoUpdate({
            target: schema.profileSectionCandidate.profileSectionId,
            set: { reviewAssignmentId: assignment!.id, sectionRevisionId: revisionId, acceptedDecisionId: null },
          });
      }
      return assignment!.id;
    });
  }
  async function unlock(p: Profile, assignment: string) {
    await db
      .update(schema.reviewAssignment)
      .set({
        closedAt: new Date('2026-11-16T00:02:00Z'),
        closeReason: 'manufacturer_unlock',
        closedBy: p.accountId,
        closeOperationKey: randomUUID(),
      })
      .where(eq(schema.reviewAssignment.id, assignment));
  }
  async function cowContacts(p: Profile, email = 'new-focal@recipient.local') {
    return db.transaction(async (tx) => {
      const s = p.sections.find((section) => section.kind === 'contacts')!;
      const [revision] = await tx
        .insert(schema.sectionRevision)
        .values({ profileSectionId: s.id, organizationId: p.organizationId, revisionNumber: 2, authorId: p.accountId })
        .returning();
      await copyRevisionContent(tx, 'contacts', p.contactsRevision, revision!.id, p.organizationId);
      await tx
        .update(schema.contact)
        .set({ email })
        .where(and(eq(schema.contact.sectionRevisionId, revision!.id), eq(schema.contact.isFocalPoint, true)));
      await tx
        .update(schema.profileSection)
        .set({ workingRevisionId: revision!.id })
        .where(eq(schema.profileSection.id, s.id));
      return revision!.id;
    });
  }
  const contactRecipient = (email: string, p: Profile) => ({
    email,
    source: 'contact',
    accountId: null,
    languageAccountId: p.accountId,
  });
  const mailboxRecipient = { email: mailbox, source: 'imbc_mailbox', accountId: null, languageAccountId: null };

  it('resolves focal point only and all nonblank ordered contacts from current tenant graph', async () => {
    const p = await profile();
    await contacts(p, p.contactsRevision, [' focal@recipient.local ', 'other@recipient.local', null, '   ']);
    expect(await resolvers.focal_point(app, currentJob(p))).toEqual([contactRecipient('focal@recipient.local', p)]);
    expect(await resolvers.manufacturer_contacts(app, currentJob(p, 'NOT-13'))).toEqual([
      contactRecipient('focal@recipient.local', p),
      contactRecipient('other@recipient.local', p),
    ]);
  });
  it('resolves current contacts by organization with the same manufacturer language account', async () => {
    const p = await profile();
    await contacts(p);
    const job = currentJob(p);
    delete job.profileId;
    expect(await resolvers.focal_point(app, job)).toEqual([contactRecipient('focal@recipient.local', p)]);
  });
  it('rejects cross-tenant profile/org pairs before any ready part is mailed', async () => {
    const p = await profile();
    const other = await profile();
    await contacts(p);
    const job = { ...currentJob(p), organizationId: other.organizationId };
    for (const part of ['manufacturer_account', 'focal_point', 'manufacturer_contacts'] as const)
      await expect(resolvers[part](app, job)).rejects.toBeInstanceOf(PermanentNotificationError);
    const transport = fakeTransport();
    const dispatcher = new NotificationDispatcher(
      app,
      new MailService(transport.transporter, { MAIL_FROM: 'no-reply@recipient.local' } as Env, app),
      resolvers,
      () => ({ subject: 'test', text: 'test', html: '<p>test</p>' }),
    );
    await expect(dispatcher.dispatch(job)).rejects.toBeInstanceOf(PermanentNotificationError);
    expect(transport.sent).toEqual([]);
  });
  it('current contacts select durable candidate after pending is cleared and then a new working COW', async () => {
    const p = await profile();
    await contacts(p);
    const a = await submit(p);
    await unlock(p, a);
    expect(await resolvers.focal_point(app, currentJob(p))).toEqual([contactRecipient('focal@recipient.local', p)]);
    await cowContacts(p);
    expect(await resolvers.focal_point(app, currentJob(p))).toEqual([contactRecipient('new-focal@recipient.local', p)]);
  });
  it('late NOT05 retains submitted focal point through unlock, a Contacts COW and a second submission', async () => {
    const p = await profile();
    await contacts(p);
    const first = await submit(p);
    await unlock(p, first);
    await cowContacts(p);
    const second = await submit(p, otherExpertId);
    expect(await resolvers.focal_point(app, reviewJob(p, first))).toEqual([
      contactRecipient('focal@recipient.local', p),
    ]);
    expect(await resolvers.focal_point(app, reviewJob(p, second))).toEqual([
      contactRecipient('new-focal@recipient.local', p),
    ]);
    expect(await resolvers.manufacturer_contacts(app, reviewJob(p, first))).toEqual([
      contactRecipient('focal@recipient.local', p),
      contactRecipient('other@recipient.local', p),
    ]);
  });
  it('an explicitly historical non-review contact event also uses its exact assignment map', async () => {
    const p = await profile();
    await contacts(p);
    const a = await submit(p);
    await unlock(p, a);
    await cowContacts(p);
    expect(await resolvers.manufacturer_contacts(app, reviewJob(p, a, 'NOT-13'))).toEqual([
      contactRecipient('focal@recipient.local', p),
      contactRecipient('other@recipient.local', p),
    ]);
  });
  it('NOT05 and NOT10 reject missing assignment reference without current fallback', async () => {
    const p = await profile();
    await contacts(p);
    await expect(resolvers.focal_point(app, currentJob(p, 'NOT-05'))).rejects.toThrow(
      'review_assignment без related.id',
    );
    await expect(resolvers.assigned_sme_or_imbc_mailbox(app, currentJob(p, 'NOT-10'))).rejects.toThrow(
      'review_assignment без related.id',
    );
    await expect(
      resolvers.focal_point(app, { ...currentJob(p, 'NOT-05'), related: { type: 'profile', id: p.profileId } }),
    ).rejects.toThrow('review_assignment без related.id');
  });
  it('historical events reject missing or another profile assignment rather than using Contacts or IMBC fallback', async () => {
    const p = await profile();
    const other = await profile();
    await contacts(p);
    await contacts(other);
    const foreign = await submit(other);
    for (const part of ['focal_point', 'manufacturer_contacts', 'assigned_sme_or_imbc_mailbox'] as const) {
      await expect(resolvers[part](app, reviewJob(p, foreign))).rejects.toThrow(
        'review_assignment вне profile контекста',
      );
      await expect(resolvers[part](app, reviewJob(p, randomUUID()))).rejects.toThrow(
        'review_assignment вне profile контекста',
      );
    }
  });
  it('NOT10 retains exact assigned SME before/after close and ignores the next-cycle SME', async () => {
    const p = await profile();
    await contacts(p);
    const first = await submit(p);
    const expected = [{ email: expertEmail, source: 'account', accountId: expertId, languageAccountId: expertId }];
    expect(await resolvers.assigned_sme_or_imbc_mailbox(app, reviewJob(p, first, 'NOT-10'))).toEqual(expected);
    await unlock(p, first);
    await submit(p, otherExpertId);
    expect(await resolvers.assigned_sme_or_imbc_mailbox(app, reviewJob(p, first, 'NOT-10'))).toEqual(expected);
  });
  it('NOT10 uses only IMBC mailbox when that exact assignment has no expert, even after a new assigned cycle', async () => {
    const p = await profile();
    await contacts(p);
    const first = await submit(p, null);
    await unlock(p, first);
    await submit(p, otherExpertId);
    expect(await resolvers.assigned_sme_or_imbc_mailbox(app, reviewJob(p, first, 'NOT-10'))).toEqual([
      mailboxRecipient,
    ]);
  });
  it('an absent IMBC mailbox yields no recipient for an unassigned immutable event', async () => {
    const p = await profile();
    await contacts(p);
    const a = await submit(p, null);
    await db.update(schema.organizations).set({ notificationMailbox: null }).where(eq(schema.organizations.id, imbcId));
    try {
      expect(await resolvers.assigned_sme_or_imbc_mailbox(app, reviewJob(p, a, 'NOT-10'))).toEqual([]);
    } finally {
      await db
        .update(schema.organizations)
        .set({ notificationMailbox: mailbox })
        .where(eq(schema.organizations.id, imbcId));
    }
  });
  it('real dispatcher deduplicates account/focal point and uses manufacturer language from exact graph', async () => {
    const p = await profile();
    await contacts(p, p.contactsRevision, [p.accountEmail.toUpperCase(), 'other@recipient.local']);
    const a = await submit(p);
    const transport = fakeTransport();
    const render = vi.fn((_rule: string, language: string) => ({
      subject: language,
      text: language,
      html: `<p>${language}</p>`,
    }));
    const dispatcher = new NotificationDispatcher(
      app,
      new MailService(transport.transporter, { MAIL_FROM: 'no-reply@recipient.local' } as Env, app),
      resolvers,
      render,
    );
    const job = reviewJob(p, a);
    expect((await dispatcher.dispatch(job)).sent).toBe(1);
    expect(transport.sent.map((m) => m.to)).toEqual([p.accountEmail]);
    expect(render).toHaveBeenCalledWith('NOT-05', 'en', {}, job);
    expect((await dispatcher.dispatch(job)).duplicates).toBe(1);
    expect(transport.sent).toHaveLength(1);
    const jobData = notifyJobSchema.parse(job);
    expect(JSON.stringify(jobData)).not.toContain('@');
    expect(jobData.related).toEqual({ type: 'review_assignment', id: a });
  });
  it('real dispatcher uses manufacturer language for focal point and assigned expert language for NOT10', async () => {
    const p = await profile();
    await contacts(p);
    const a = await submit(p);
    await unlock(p, a);
    const transport = fakeTransport();
    const render = vi.fn((_rule: string, language: string) => ({
      subject: language,
      text: language,
      html: `<p>${language}</p>`,
    }));
    const dispatcher = new NotificationDispatcher(
      app,
      new MailService(transport.transporter, { MAIL_FROM: 'no-reply@recipient.local' } as Env, app),
      resolvers,
      render,
    );
    expect((await dispatcher.dispatch(reviewJob(p, a))).sent).toBe(2);
    expect(render.mock.calls.map((args) => args[1])).toEqual(['en', 'en']);
    render.mockClear();
    expect((await dispatcher.dispatch(reviewJob(p, a, 'NOT-10'))).sent).toBe(1);
    expect(render.mock.calls.map((args) => args[1])).toEqual(['ru']);
    expect(transport.sent.map((m) => m.to)).not.toContain(otherExpertEmail);
  });
});

import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { profileReviewDecisionInputSchema, type ProfileReviewDecisionInput } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { AuditService } from '../common/audit.service.js';
import { ProblemException } from '../common/problem.js';
import type { Database } from './database.module.js';
import * as schema from './schema/index.js';
import { NOTIFY_QUEUE_OPTIONS, QUEUES } from '../jobs/queues.js';
import type { AuthUser } from '../modules/auth/auth.types.js';
import { profileSubmissionRevisions } from '../modules/profiles/profile-candidate.js';
import { ProfileReviewService, type LockedProfileReview } from '../modules/profiles/profile-review.service.js';

type DemoCommand =
  | { action: 'take' | 'submit-result'; expertId: string; assignmentId: string }
  | { action: 'decide'; expertId: string; assignmentId: string; input: ProfileReviewDecisionInput };
const denyDemo = () => new ProblemException(403, 'demo_review_forbidden', 'Демонстрационное рассмотрение недоступно.');
const local = (value: string | null) => !!value && /^[^\s@]+@[^\s@]+\.local$/i.test(value.trim());

/** Explicit single action only: no bulk-approval switch and no inferred target assignment. */
export function parseDemoReviewCommand(args: string[], enabled: string | undefined): DemoCommand {
  if (enabled !== 'true') throw denyDemo();
  const [action, expertId, assignmentId, subjectKind, subjectId, outcome, comment] = args;
  if (!z.uuid().safeParse(expertId).success || !z.uuid().safeParse(assignmentId).success) throw denyDemo();
  if ((action === 'take' || action === 'submit-result') && args.length === 3)
    return { action, expertId: expertId!, assignmentId: assignmentId! };
  if (action !== 'decide' || (args.length !== 6 && args.length !== 7)) throw denyDemo();
  const subject =
    subjectKind === 'section'
      ? { kind: subjectKind, sectionRevisionId: subjectId }
      : subjectKind === 'document'
        ? { kind: subjectKind, documentId: subjectId }
        : subjectKind === 'certificate'
          ? { kind: subjectKind, certificateId: subjectId }
          : subjectKind === 'file'
            ? { kind: subjectKind, fileVersionId: subjectId }
            : null;
  const parsed = profileReviewDecisionInputSchema.safeParse({ subject, outcome, comment: comment ?? null });
  if (!parsed.success) throw denyDemo();
  return { action, expertId: expertId!, assignmentId: assignmentId!, input: parsed.data };
}

/** Called again inside the locked service transaction, before any business/audit/queue mutation. */
export async function assertDemoReviewTarget(
  tx: Database,
  actor: AuthUser,
  graph: Pick<LockedProfileReview, 'profile' | 'assignment' | 'map'>,
  enabled: string | undefined,
): Promise<void> {
  if (enabled !== 'true') throw denyDemo();
  const users = (
    await tx.execute<{ id: string; email: string; role: string; state: string; org: string; type: string }>(sql`
    select a.id,a.email,a.role,a.state,a.organization_id as org,o.type from user_accounts a join organizations o on o.id=a.organization_id
    where a.id=any(${sql.param([actor.id, graph.assignment.submittedBy])}::uuid[])`)
  ).rows;
  const expert = users.find((user) => user.id === actor.id);
  const producer = users.find((user) => user.id === graph.assignment.submittedBy);
  if (
    !expert ||
    expert.role !== 'expert' ||
    expert.state !== 'active' ||
    expert.type !== 'imbc' ||
    expert.org !== actor.organizationId ||
    !local(expert.email) ||
    !producer ||
    producer.role !== 'manufacturer' ||
    producer.state !== 'active' ||
    producer.type !== 'manufacturer' ||
    producer.org !== graph.profile.organizationId ||
    !local(producer.email)
  )
    throw denyDemo();
  const contactsRevision = graph.map.find((section) => section.kind === 'contacts')?.revisionId;
  if (!contactsRevision) throw denyDemo();
  // NOT-05 resolves these immutable contacts, so even a running real worker cannot relay a demo to a real address.
  const contacts = (
    await tx.execute<{ email: string | null; focal: boolean }>(sql`select email,is_focal_point as focal from contact
    where section_revision_id=${contactsRevision} and organization_id=${graph.profile.organizationId}`)
  ).rows;
  if (
    !contacts.some((contact) => contact.focal && local(contact.email)) ||
    contacts.some((contact) => contact.email?.trim() && !local(contact.email))
  )
    throw denyDemo();
}

/** Standalone closed entry point: no Nest application, workers, SMTP client or automatic decision generation. */
export async function runDemoReview(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ assignmentId: string; decisionId?: string; count: number }> {
  const command = parseDemoReviewCommand(args, env.SEED_DEMO);
  if (!env.DATABASE_URL) throw denyDemo();
  const pool = new pg.Pool({ connectionString: env.DATABASE_URL, application_name: 'imbc-closed-review-demo', max: 2 });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  let boss: PgBoss | undefined;
  try {
    // Read-only preflight precedes even queue initialization. The service repeats scope under its locks.
    const [actor] = await db
      .select()
      .from(schema.userAccounts)
      .where(sql`id=${command.expertId}`);
    const [organization] = actor
      ? await db
          .select()
          .from(schema.organizations)
          .where(sql`id=${actor.organizationId}`)
      : [];
    const [assignment] = await db
      .select()
      .from(schema.reviewAssignment)
      .where(sql`id=${command.assignmentId}`);
    const [profile] = assignment
      ? await db
          .select()
          .from(schema.manufacturerProfile)
          .where(sql`id=${assignment.profileId} and organization_id=${assignment.organizationId}`)
      : [];
    if (
      !actor ||
      !organization ||
      !assignment ||
      !profile ||
      assignment.closedAt !== null ||
      (assignment.expertId !== null && assignment.expertId !== actor.id)
    )
      throw denyDemo();
    const auth: AuthUser = {
      id: actor.id,
      email: actor.email,
      fullName: actor.fullName,
      role: actor.role,
      organizationId: actor.organizationId,
      organizationType: organization.type,
      locale: actor.locale,
    };
    const map = await profileSubmissionRevisions(db, {
      assignmentId: assignment.id,
      profileId: profile.id,
      organizationId: profile.organizationId,
    });
    await assertDemoReviewTarget(db, auth, { profile, assignment, map }, env.SEED_DEMO);
    boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: env.PGBOSS_SCHEMA ?? 'pgboss',
      supervise: false,
      schedule: false,
    });
    boss.on('error', () => {
      /* The CLI reports only safe outcome codes below. */
    });
    await boss.start();
    await boss.createQueue(QUEUES.notify, NOTIFY_QUEUE_OPTIONS);
    const service = new ProfileReviewService(pool, new AuditService(db), boss);
    const options = {
      beforeMutation: (tx: Database, user: AuthUser, graph: LockedProfileReview) =>
        assertDemoReviewTarget(tx, user, graph, env.SEED_DEMO),
    };
    if (command.action === 'take') {
      await service.take(auth, assignment.id, options);
      return { assignmentId: assignment.id, count: 1 };
    }
    if (command.action === 'decide') {
      const decision = await service.decide(auth, assignment.id, command.input, options);
      return { assignmentId: assignment.id, decisionId: decision.id, count: 1 };
    }
    const result = await service.submitResult(auth, assignment.id, options);
    return { assignmentId: assignment.id, count: result.publishKinds.length };
  } finally {
    await boss?.stop();
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runDemoReview(process.argv.slice(2))
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof ProblemException ? error.code : 'demo_review_failed'}\n`);
      process.exitCode = 1;
    });
}

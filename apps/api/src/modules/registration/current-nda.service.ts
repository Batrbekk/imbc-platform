import { isIP } from 'node:net';
import {
  acceptCurrentNdaInputSchema,
  currentNdaStateSchema,
  type AcceptCurrentNdaInput,
  type CurrentNdaState,
} from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { actorTransaction } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { databaseErrorSummary } from '../../database/pg-errors.js';
import { manufacturerProfile, ndaVersion, organizations, userAccounts } from '../../database/schema/index.js';
import type { AuthUser } from '../auth/auth.types.js';
import { accountNdaLinksInsert, currentAccountNdaEvidence, recordAccountNdaAcceptance } from './nda-evidence.js';

class NdaScopeDenied extends ProblemException {
  constructor(readonly trustedOrganizationId: string | null) {
    super(403, 'forbidden', 'Согласие доступно только изготовителю этой организации.');
  }
}
const logger = new Logger('CurrentNda');
@Injectable()
export class CurrentNdaService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}
  private async run<T>(actor: AuthUser, ip: string | null, run: (tx: Database) => Promise<T>) {
    try {
      return await actorTransaction(
        this.pool,
        this.audit,
        actor,
        { action: 'profile.read', route: '/api/v1/nda/current', ip },
        async (tx) => {
          const [account] = await tx
            .select({ org: userAccounts.organizationId, role: userAccounts.role, type: organizations.type })
            .from(userAccounts)
            .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
            .where(eq(userAccounts.id, actor.id));
          if (
            !account ||
            account.role !== 'manufacturer' ||
            account.type !== 'manufacturer' ||
            account.org !== actor.organizationId
          )
            throw new NdaScopeDenied(account?.org ?? null);
          return run(tx);
        },
      );
    } catch (error) {
      if (error instanceof NdaScopeDenied)
        try {
          await this.audit.record({
            userId: actor.id,
            organizationId: error.trustedOrganizationId ?? actor.organizationId,
            action: 'profile.read',
            objectType: 'route',
            objectId: '/api/v1/nda/current',
            outcome: 'denied',
            ip,
          });
        } catch (auditError) {
          logger.error(
            databaseErrorSummary(auditError) ?? { name: auditError instanceof Error ? auditError.name : 'unknown' },
            'NDA scope denial audit failed',
          );
        }
      throw error;
    }
  }
  private async current(tx: Database) {
    await tx.select({ id: ndaVersion.id }).from(ndaVersion).where(eq(ndaVersion.isCurrent, true)).for('share');
    // Fresh read after any row-lock wait sees a newly published current version.
    const [current] = await tx.select().from(ndaVersion).where(eq(ndaVersion.isCurrent, true)).for('share');
    if (!current || !current.body.trim())
      throw new ProblemException(503, 'nda_unavailable', 'Текущая версия NDA недоступна.');
    return current;
  }
  private async dto(tx: Database, actor: AuthUser, current: typeof ndaVersion.$inferSelect): Promise<CurrentNdaState> {
    const evidence = await currentAccountNdaEvidence(tx, {
      accountId: actor.id,
      organizationId: actor.organizationId,
      ndaVersionId: current.id,
    });
    return parseResponse(
      currentNdaStateSchema,
      {
        nda: { version: current.versionNumber, body: current.body },
        accepted: evidence !== null,
        acceptedAt: evidence?.acceptedAt.toISOString() ?? null,
        profileLinked: evidence?.profileLinked ?? false,
      },
      'согласие с текущей NDA',
    );
  }
  async read(actor: AuthUser, ip: string | null = null) {
    return this.run(actor, ip, async (tx) => this.dto(tx, actor, await this.current(tx)));
  }
  async accept(actor: AuthUser, input: AcceptCurrentNdaInput, ip: string | null): Promise<CurrentNdaState> {
    const normalized = acceptCurrentNdaInputSchema.parse(input);
    if (!ip || !isIP(ip) || ip.includes('%'))
      throw new ProblemException(400, 'nda_evidence_invalid', 'Адрес принятия согласия недоступен.');
    return this.run(actor, ip, async (tx) => {
      const current = await this.current(tx);
      if (current.versionNumber !== normalized.versionNumber)
        throw new ProblemException(409, 'nda_version_changed', 'Прочитайте новую версию NDA.');
      const saved = await recordAccountNdaAcceptance(tx, {
        accountId: actor.id,
        organizationId: actor.organizationId,
        ndaVersionId: current.id,
        acceptedAt: new Date(),
        ip,
      });
      const [profile] = await tx
        .select({ id: manufacturerProfile.id })
        .from(manufacturerProfile)
        .where(eq(manufacturerProfile.organizationId, actor.organizationId))
        .for('no key update');
      if (profile) {
        const { rows } = await tx.execute<{ id: string }>(accountNdaLinksInsert(profile.id, actor.id));
        for (const link of rows)
          await this.audit.record(
            {
              userId: actor.id,
              organizationId: actor.organizationId,
              action: 'nda.linked',
              objectType: 'nda_acceptance',
              objectId: link.id,
            },
            tx,
          );
      }
      if (saved.created)
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: actor.organizationId,
            action: 'nda.accepted',
            objectType: 'account_nda_acceptance',
            objectId: saved.acceptance.id,
            diff: { version: current.versionNumber },
            ip,
            isAccountEvent: true,
          },
          tx,
        );
      return this.dto(tx, actor, current);
    });
  }
}

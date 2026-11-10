import { checkBin, LOCALES } from '@imbc/contracts';
import { Body, Controller, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { DB, PG_POOL, type Database } from '../../database/database.module.js';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { withQueueTransaction } from '../../database/transaction.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES } from '../../jobs/queues.js';
import { organizations, userAccounts } from '../../database/schema/index.js';
import { Public } from '../auth/guards.js';
import { KeycloakAdminService, KeycloakRequestError } from '../auth/keycloak-admin.service.js';
import { AuthRateLimitService } from '../auth/rate-limit.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';

const registrationSchema = z.object({
  companyName: z.string().trim().min(2).max(300),
  bin: z.string().trim(),
  email: z
    .string()
    .trim()
    .pipe(z.email().max(254))
    .transform((value) => value.toLowerCase()),
  acceptTerms: z.literal(true),
  heardAboutUs: z.string().trim().max(500).nullish(),
  locale: z.enum(LOCALES).default('kk'),
});

/**
 * Саморегистрация производителя (MAN-01…05, D-01, D-09).
 * Поля: название, БИН, корпоративный email, согласие, «как узнали о нас». Пароля в форме нет.
 * Существующий БИН отклоняется с предложением обратиться в IMBC.
 */
@ApiTags('registration')
@Controller('v1/registrations')
export class RegistrationController {
  private readonly logger = new Logger(RegistrationController.name);
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly keycloak: KeycloakAdminService,
    private readonly audit: AuditService,
    private readonly profiles: ProfilesService,
    private readonly rates: AuthRateLimitService,
  ) {}

  @Public()
  @Post()
  @HttpCode(202)
  async register(@Body() body: unknown, @Req() req: Request) {
    const input = parseOrThrow(registrationSchema, body);
    await this.rates.enforce('registration-ip', req.ip ?? 'unknown', 20, 3600);
    const bin = checkBin(input.bin);
    if (!bin.valid) {
      throw new ProblemException(
        400,
        `bin_${bin.reason}`,
        'БИН указан неверно',
        'БИН — 12 цифр с верным контрольным разрядом',
      );
    }

    const [binTaken, emailTaken] = await Promise.all([
      this.db.query.organizations.findFirst({ where: sql`${organizations.bin} = ${bin.bin}` }),
      this.db.query.userAccounts.findFirst({ where: sql`lower(${userAccounts.email}) = lower(${input.email})` }),
    ]);
    if (binTaken) {
      throw new ProblemException(409, 'bin_exists', 'Компания с этим БИН уже зарегистрирована', 'Обратитесь в IMBC');
    }
    if (emailTaken) throw new ProblemException(409, 'email_exists', 'Этот email уже используется');

    // Сначала IdP, затем БД; при сбое БД пользователь в IdP удаляется.
    let subject: string;
    try {
      subject = await this.keycloak.createUser({ email: input.email, locale: input.locale });
    } catch (error) {
      if (error instanceof KeycloakRequestError && error.status === 409) {
        throw new ProblemException(409, 'email_exists', 'Этот email уже используется');
      }
      throw new ProblemException(503, 'identity_unavailable', 'Регистрация временно недоступна. Попробуйте снова.');
    }
    try {
      await withQueueTransaction(this.pool, async (tx, queueDb) => {
        const [org] = await tx
          .insert(organizations)
          .values({ type: 'manufacturer', name: input.companyName, bin: bin.bin })
          .returning({ id: organizations.id });
        const [account] = await tx
          .insert(userAccounts)
          .values({
            organizationId: org!.id,
            email: input.email.toLowerCase(),
            role: 'manufacturer',
            idpSubject: subject,
            locale: input.locale,
          })
          .returning({ id: userAccounts.id });
        await this.profiles.ensureDraft(org!.id, account!.id, {
          heardAboutUs: input.heardAboutUs ?? null,
          outer: tx,
        });
        await this.audit.record(
          {
            userId: account!.id,
            organizationId: org!.id,
            action: 'registration.created',
            objectType: 'organization',
            objectId: org!.id,
            isAccountEvent: true,
            ip: req.ip ?? null,
          },
          tx,
        );
        // Mail delivery is retried durably; an SMTP failure cannot strand a committed registration.
        await this.queue.send(
          QUEUES.sendPasswordEmail,
          { subject },
          { db: queueDb, singletonKey: subject, singletonSeconds: 60 },
        );
      });
    } catch (error) {
      try {
        await this.keycloak.deleteUser(subject);
      } catch {
        await this.queue.send(QUEUES.cleanupIdentity, { subject }).catch(() => {
          this.logger.error('Failed to enqueue registration identity cleanup');
        });
      }
      const conflict = registrationConflict(error);
      if (conflict)
        throw new ProblemException(
          409,
          conflict,
          conflict === 'email_exists' ? 'Этот email уже используется' : 'Компания с этим БИН уже зарегистрирована',
        );
      throw error;
    }

    return { status: 'password_email_queued' };
  }

  @Public()
  @Post('resend')
  @HttpCode(202)
  async resend(@Body() body: unknown, @Req() req: Request) {
    const { email } = parseOrThrow(z.object({ email: registrationSchema.shape.email }), body);
    await this.rates.enforce('invitation-resend-ip', req.ip ?? 'unknown', 20, 3600);
    if (await this.rates.allow('invitation-resend-email', email, 1, 60)) {
      const account = await this.db.query.userAccounts.findFirst({
        where: and(sql`lower(${userAccounts.email}) = ${email}`, eq(userAccounts.state, 'invited')),
      });
      if (account?.idpSubject)
        await this.queue.send(
          QUEUES.sendPasswordEmail,
          { subject: account.idpSubject },
          { singletonKey: account.idpSubject, singletonSeconds: 60 },
        );
    }
    // Same status and body for existing, unknown, active and throttled addresses.
    return { status: 'password_email_queued' };
  }
}

export function registrationConflict(error: unknown): 'email_exists' | 'bin_exists' | null {
  let cause: unknown = error;
  for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
    const item = cause as { code?: string; constraint?: string; cause?: unknown };
    if (item.code === '23505') {
      if (item.constraint === 'user_accounts_email_uq' || item.constraint === 'user_accounts_idp_subject_uq')
        return 'email_exists';
      if (item.constraint === 'organizations_bin_uq') return 'bin_exists';
    }
    cause = item.cause;
  }
  return null;
}

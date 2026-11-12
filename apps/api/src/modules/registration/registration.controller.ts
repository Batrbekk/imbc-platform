import {
  checkBin,
  loginEmailSchema,
  registrationRequestSchema,
  registrationTermsSchema,
  type RegistrationTerms,
} from '@imbc/contracts';
import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { isIP } from 'node:net';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database } from '../../database/database.module.js';
import { ndaVersion, organizations, userAccounts } from '../../database/schema/index.js';
import { QUEUE } from '../../infra/infra.module.js';
import { QUEUES } from '../../jobs/queues.js';
import { boundLockWaits, sqlState } from '../adata/adata.scheduler.js';
import { Public } from '../auth/guards.js';
import { IdentityProvisioningService, provisioningConflict } from '../auth/identity-provisioning.service.js';
import { AuthRateLimitService } from '../auth/rate-limit.service.js';

const ndaUnavailable = () =>
  new ProblemException(503, 'nda_unavailable', 'Регистрация временно недоступна. Попробуйте позже.');
const registrationUnavailable = () =>
  new ProblemException(503, 'identity_unavailable', 'Регистрация временно недоступна. Попробуйте снова.');

/** Ожидание блокировки или оператора сверх `boundLockWaits` (lock_not_available, query_canceled). */
const LOCK_WAIT_EXCEEDED = new Set(['55P03', '57014']);

/**
 * Текущая версия NDA для формы и для регистрации — одно условие: нет текущей или её текст пуст
 * (одни пробелы) — принимать нечего, `503 nda_unavailable` (MAN-01, FC-02).
 */
async function currentNda(db: Database): Promise<{ version: number; body: string }> {
  const [current] = await db
    .select({ version: ndaVersion.versionNumber, body: ndaVersion.body })
    .from(ndaVersion)
    .where(eq(ndaVersion.isCurrent, true));
  if (!current || !current.body.trim()) throw ndaUnavailable();
  return current;
}
const ndaVersionChanged = () =>
  new ProblemException(409, 'nda_version_changed', 'Текст NDA обновлён', 'Прочитайте новую версию и примите её снова');

/**
 * Адрес запроса для записи принятия NDA (FC-02). `req.ip` — адрес, который добавил прокси (`trust proxy` 1),
 * а не значение клиента из X-Forwarded-For. Без адреса, который примет `inet`, регистрация не идёт.
 */
function requestIp(req: Request): string | null {
  const ip = req.ip;
  return ip && isIP(ip) !== 0 && !ip.includes('%') ? ip : null;
}

/**
 * Саморегистрация производителя по v1.3 (MAN-01…MAN-03, FC-02, AUTH-01). Организация и аккаунт с двумя
 * согласиями и ожидающим принятием текущей NDA; профиля нет, пока не задан пароль (NOT-23,
 * `ManufacturerOnboardingService`). Пароля в форме нет. Существующий БИН — отказ «обратитесь в IMBC».
 */
@ApiTags('registration')
@Controller('v1/registrations')
export class RegistrationController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE) private readonly queue: PgBoss,
    private readonly provisioning: IdentityProvisioningService,
    private readonly audit: AuditService,
    private readonly rates: AuthRateLimitService,
  ) {}

  /** Текст текущей версии NDA для формы (MAN-01): только номер и текст. */
  @Public()
  @Get('terms')
  async terms(@Req() req: Request): Promise<RegistrationTerms> {
    await this.rates.enforce('registration-terms-ip', req.ip ?? 'unknown', 120, 3600);
    return parseResponse(registrationTermsSchema, { nda: await currentNda(this.db) }, 'условия регистрации');
  }

  @Public()
  @Post()
  @HttpCode(202)
  async register(@Body() body: unknown, @Req() req: Request) {
    const input = parseOrThrow(registrationRequestSchema, body);
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
    const ip = requestIp(req);
    if (!ip) throw registrationUnavailable();

    // Форма показала одну версию NDA, а текущей стала другая: отказ до Keycloak (FC-02).
    if ((await currentNda(this.db)).version !== input.ndaVersion) throw ndaVersionChanged();

    const [binTaken, emailTaken] = await Promise.all([
      this.db.query.organizations.findFirst({ where: sql`${organizations.bin} = ${bin.bin}` }),
      this.db.query.userAccounts.findFirst({ where: sql`lower(${userAccounts.email}) = lower(${input.email})` }),
    ]);
    if (binTaken) {
      throw new ProblemException(409, 'bin_exists', 'Компания с этим БИН уже зарегистрирована', 'Обратитесь в IMBC');
    }
    if (emailTaken) throw new ProblemException(409, 'email_exists', 'Этот email уже используется');

    try {
      await this.provisioning.provision(
        { email: input.email, firstName: null, locale: input.locale },
        async (tx, subject) => {
          // Чужая транзакция на строке версии не держит регистрацию: отказ — 503 после удаления пользователя IdP.
          await boundLockWaits(tx);
          // Версия сверяется ещё раз под блокировкой: смена текущей версии ждёт фиксации регистрации.
          // Пусто под блокировкой — версию сменили, пока ждали (текущая была проверена до Keycloak).
          const [accepted] = await tx
            .select({ id: ndaVersion.id, versionNumber: ndaVersion.versionNumber })
            .from(ndaVersion)
            .where(eq(ndaVersion.isCurrent, true))
            .for('share');
          if (accepted?.versionNumber !== input.ndaVersion) throw ndaVersionChanged();

          const [org] = await tx
            .insert(organizations)
            .values({ type: 'manufacturer', name: input.companyName, bin: bin.bin })
            .returning({ id: organizations.id });
          // Три согласия MAN-01 — одним временем; принятие NDA ждёт профиля у аккаунта (FC-02).
          const [account] = await tx
            .insert(userAccounts)
            .values({
              organizationId: org!.id,
              email: input.email,
              role: 'manufacturer',
              idpSubject: subject,
              locale: input.locale,
              platformTermsAcceptedAt: sql`now()`,
              personalDataAcceptedAt: sql`now()`,
              registrationNdaVersionId: accepted.id,
              registrationNdaAcceptedAt: sql`now()`,
              registrationIp: ip,
              registrationHeardAboutUs: input.heardAboutUs,
            })
            .returning({ id: userAccounts.id });
          await this.audit.record(
            {
              userId: account!.id,
              organizationId: org!.id,
              action: 'registration.created',
              objectType: 'organization',
              objectId: org!.id,
              diff: { ndaVersion: accepted.versionNumber },
              isAccountEvent: true,
              ip,
            },
            tx,
          );
        },
      );
    } catch (error) {
      if (LOCK_WAIT_EXCEEDED.has(sqlState(error) as string)) throw registrationUnavailable();
      const conflict = provisioningConflict(error);
      if (conflict === 'email_exists') throw new ProblemException(409, conflict, 'Этот email уже используется');
      if (conflict === 'bin_exists')
        throw new ProblemException(409, conflict, 'Компания с этим БИН уже зарегистрирована', 'Обратитесь в IMBC');
      throw error;
    }

    return { status: 'password_email_queued' };
  }

  @Public()
  @Post('resend')
  @HttpCode(202)
  async resend(@Body() body: unknown, @Req() req: Request) {
    const { email } = parseOrThrow(z.object({ email: loginEmailSchema }), body);
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

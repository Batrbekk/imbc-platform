import { checkBin, LOCALES } from '@imbc/contracts';
import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service.js';
import { parseOrThrow, ProblemException } from '../../common/problem.js';
import { DB, type Database } from '../../database/database.module.js';
import { organizations, userAccounts } from '../../database/schema/index.js';
import { Public } from '../auth/guards.js';
import { KeycloakAdminService } from '../auth/keycloak-admin.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';

const registrationSchema = z.object({
  companyName: z.string().trim().min(2).max(300),
  bin: z.string().trim(),
  email: z.email().max(254),
  acceptTerms: z.literal(true),
  heardAboutUs: z.string().trim().max(500).optional(),
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
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly keycloak: KeycloakAdminService,
    private readonly audit: AuditService,
    private readonly profiles: ProfilesService,
  ) {}

  @Public()
  @Post()
  @HttpCode(202)
  async register(@Body() body: unknown, @Req() req: Request) {
    const input = parseOrThrow(registrationSchema, body);
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
    const subject = await this.keycloak.createUser({ email: input.email, locale: input.locale });
    try {
      await this.db.transaction(async (tx) => {
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
          outer: tx as unknown as Database,
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
      });
    } catch (error) {
      await this.keycloak.deleteUser(subject);
      if (String((error as { code?: string }).code) === '23505') {
        throw new ProblemException(409, 'bin_exists', 'Компания с этим БИН уже зарегистрирована', 'Обратитесь в IMBC');
      }
      throw error;
    }

    // NOT-01 / NOT-30: письмо со ссылкой только на корпоративный адрес.
    await this.keycloak.sendPasswordEmail(subject);
    return { status: 'password_email_sent' };
  }
}

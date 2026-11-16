import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import { PG_POOL } from '../../database/database.module.js';
import { boundLockWaits } from '../../database/lock-waits.js';
import { manufacturerProfiles, organizations, userAccounts } from '../../database/schema/index.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { AdataScheduler, type AdataReadOrigin } from '../adata/adata.scheduler.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { accountNdaLinksInsert } from './nda-evidence.js';

export type OnboardingResult = {
  profile: 'created' | 'existing' | 'skipped';
  adata: 'scheduled' | 'requeued' | 'skipped';
};

const SKIPPED: OnboardingResult = { profile: 'skipped', adata: 'skipped' };

/**
 * Связь всех неизменяемых согласий аккаунта с профилем (FC-02/03), включая до-парольные версии.
 * Блокируются account/profile parents; readonly consent rows не требуют UPDATE. Исходные время/IP
 * не заменяются временем установки пароля; повтор не меняет существующую связь.
 */
export function ndaAcceptanceInsert(profileId: string, accountId: string) {
  return accountNdaLinksInsert(profileId, accountId);
}

/**
 * Пароль задан — профиль есть (MAN-03, NOT-23). Событие пароля в `keycloak-events` или, если оно ещё не
 * пришло, вход производителя создают в одной транзакции Draft-профиль, принятие NDA из регистрации (FC-02)
 * и единственную попытку чтения Adata (IMBC-07): профиль есть ⇔ попытка поставлена. Писем нет (NOT-23).
 * Событие и вход сериализуются блокировкой строки аккаунта; повтор даёт existing. Сбой откатывает всё —
 * следующий вход или опрос событий повторит.
 */
@Injectable()
export class ManufacturerOnboardingService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly profiles: ProfilesService,
    private readonly adata: AdataScheduler,
    private readonly audit: AuditService,
  ) {}

  async onPasswordSet(accountId: string, origin: AdataReadOrigin, at: Date): Promise<OnboardingResult> {
    // Ошибка, включая 23505, откатывает всё и уходит вызывающему: он пишет warn без данных, следующий
    // вход или опрос событий повторит. Гонку исключает блокировка аккаунта, а не перехват.
    return withQueueTransaction(this.pool, async (tx, queueDb) => {
      await boundLockWaits(tx);
      const [account] = await tx
        .select({
          organizationId: userAccounts.organizationId,
          role: userAccounts.role,
          state: userAccounts.state,
          bin: organizations.bin,
          heardAboutUs: userAccounts.registrationHeardAboutUs,
          organizationType: organizations.type,
        })
        .from(userAccounts)
        .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
        .where(eq(userAccounts.id, accountId))
        .for('update', { of: userAccounts });
      // Заблокированный IMBC аккаунт не получает ни профиля, ни квоты Adata: их создаст вход после разблокировки.
      if (
        !account ||
        account.role !== 'manufacturer' ||
        account.organizationType !== 'manufacturer' ||
        !account.bin ||
        account.state === 'blocked'
      )
        return SKIPPED;

      const [existing] = await tx
        .select({ id: manufacturerProfiles.id })
        .from(manufacturerProfiles)
        .where(eq(manufacturerProfiles.organizationId, account.organizationId));
      let profile: OnboardingResult['profile'] = 'existing';
      let profileId = existing?.id;
      if (!existing) {
        profileId = await this.profiles.ensureDraft(account.organizationId, accountId, {
          heardAboutUs: account.heardAboutUs,
          registeredAt: at,
          outer: tx,
        });
        await this.audit.record(
          {
            userId: accountId,
            organizationId: account.organizationId,
            action: 'profile.created',
            objectType: 'manufacturer_profile',
            objectId: profileId,
            diff: { origin },
          },
          tx,
        );
        profile = 'created';
      }
      // Existing migrated/verified profiles link every durable version without changing profile state/evidence.
      const { rows: links } = await tx.execute<{ id: string }>(ndaAcceptanceInsert(profileId!, accountId));
      for (const link of links)
        await this.audit.record(
          {
            userId: accountId,
            organizationId: account.organizationId,
            action: 'nda.linked',
            objectType: 'nda_acceptance',
            objectId: link.id,
          },
          tx,
        );
      await tx
        .update(userAccounts)
        .set({
          registrationNdaVersionId: null,
          registrationNdaAcceptedAt: null,
          registrationIp: null,
          ...(profile === 'created' ? { registrationHeardAboutUs: null } : {}),
        })
        .where(eq(userAccounts.id, accountId));
      // Регистрации до этапа 1 уже имеют Draft: им — только чтение, принятия NDA у них нет.
      const adata = await this.adata.requestInTransaction(tx, queueDb, accountId, origin);
      return { profile, adata };
    });
  }
}

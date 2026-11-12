import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import { PG_POOL } from '../../database/database.module.js';
import { manufacturerProfiles, ndaVersion, organizations, userAccounts } from '../../database/schema/index.js';
import { withQueueTransaction } from '../../database/transaction.js';
import { AdataScheduler, boundLockWaits, sqlState, type AdataReadOrigin } from '../adata/adata.scheduler.js';
import { ProfilesService } from '../profiles/profiles.service.js';

export type OnboardingResult = {
  profile: 'created' | 'existing' | 'skipped';
  adata: 'scheduled' | 'requeued' | 'skipped';
};

const SKIPPED: OnboardingResult = { profile: 'skipped', adata: 'skipped' };

/**
 * Перенос принятия NDA, ждавшего у аккаунта, в `nda_acceptance` (FC-02): время и версия — регистрации,
 * IP — адрес запроса регистрации текстом (`host`, без маски). Таблица только для добавления: у роли
 * приложения нет UPDATE, поэтому повтор — ON CONFLICT DO NOTHING, и ни одной блокировки строк принятия.
 */
export function ndaAcceptanceInsert(profileId: string, accountId: string) {
  return sql`insert into nda_acceptance (profile_id, nda_version_id, accepted_at, ip_address)
    select ${profileId}::uuid, a.registration_nda_version_id, a.registration_nda_accepted_at, host(a.registration_ip)
    from user_accounts a
    where a.id = ${accountId}::uuid and a.registration_nda_version_id is not null
    on conflict do nothing
    returning id`;
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
    try {
      return await withQueueTransaction(this.pool, async (tx, queueDb) => {
        await boundLockWaits(tx);
        const [account] = await tx
          .select({
            organizationId: userAccounts.organizationId,
            role: userAccounts.role,
            state: userAccounts.state,
            bin: organizations.bin,
            heardAboutUs: userAccounts.registrationHeardAboutUs,
            ndaVersionId: userAccounts.registrationNdaVersionId,
            ndaVersionNumber: ndaVersion.versionNumber,
          })
          .from(userAccounts)
          .innerJoin(organizations, eq(organizations.id, userAccounts.organizationId))
          .leftJoin(ndaVersion, eq(ndaVersion.id, userAccounts.registrationNdaVersionId))
          .where(eq(userAccounts.id, accountId))
          .for('update', { of: userAccounts });
        // Заблокированный IMBC аккаунт не получает ни профиля, ни квоты Adata: их создаст вход после разблокировки.
        if (!account || account.role !== 'manufacturer' || !account.bin || account.state === 'blocked') return SKIPPED;

        const [existing] = await tx
          .select({ id: manufacturerProfiles.id })
          .from(manufacturerProfiles)
          .where(eq(manufacturerProfiles.organizationId, account.organizationId));
        let profile: OnboardingResult['profile'] = 'existing';
        if (!existing) {
          const profileId = await this.profiles.ensureDraft(account.organizationId, accountId, {
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
          if (account.ndaVersionId) {
            const { rows } = await tx.execute<{ id: string }>(ndaAcceptanceInsert(profileId, accountId));
            if (rows[0])
              await this.audit.record(
                {
                  userId: accountId,
                  organizationId: account.organizationId,
                  action: 'nda.accepted',
                  objectType: 'nda_acceptance',
                  objectId: rows[0].id,
                  diff: { version: account.ndaVersionNumber },
                },
                tx,
              );
          }
          await tx
            .update(userAccounts)
            .set({
              registrationNdaVersionId: null,
              registrationNdaAcceptedAt: null,
              registrationIp: null,
              registrationHeardAboutUs: null,
            })
            .where(eq(userAccounts.id, accountId));
          profile = 'created';
        }
        // Регистрации до этапа 1 уже имеют Draft: им — только чтение, принятия NDA у них нет.
        const adata = await this.adata.requestInTransaction(tx, queueDb, accountId, origin);
        return { profile, adata };
      });
    } catch (error) {
      // Запасная граница — частичный уникальный индекс попытки profile_created: гонка — не сбой входа.
      if (sqlState(error) === '23505') return { profile: 'existing', adata: 'skipped' };
      throw error;
    }
  }
}

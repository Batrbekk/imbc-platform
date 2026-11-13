import { DeleteObjectsCommand, type S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { AuditService } from '../common/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database, PG_POOL } from '../database/database.module.js';
import { withQueueTransaction } from '../database/transaction.js';
import {
  certificates,
  exportFiles,
  notificationsSent,
  otpCodes,
  sessions,
  trustedDevices,
  userAccounts,
  authRateLimits,
  authSecurityEvents,
  authSyncState,
  revokedIdpSessions,
} from '../database/schema/index.js';
import { QUEUE, S3 } from '../infra/infra.module.js';
import { KeycloakAdminService, KeycloakRequestError } from '../modules/auth/keycloak-admin.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { sha256 } from '../modules/auth/crypto.js';
import { ManufacturerOnboardingService } from '../modules/registration/onboarding.service.js';
import { enqueueNotification } from '../notifications/enqueue.js';
import { appLink } from '../notifications/links.js';
import type { AccountJob, IdentityJob, IdentitySyncJob } from '../jobs/queues.js';

type SecurityEvent = Awaited<ReturnType<KeycloakAdminService['securityEvents']>>[number];

/** Пароль установлен или сменён: письмо установки пароля, сброс или новый пароль в профиле Keycloak. */
export function isPasswordEvent(event: SecurityEvent): boolean {
  return (
    event.type === 'UPDATE_PASSWORD' ||
    event.type === 'RESET_PASSWORD' ||
    (event.type === 'UPDATE_CREDENTIAL' && event.details?.credential_type === 'password')
  );
}

/**
 * Обработчики заданий. Каждый идемпотентен: pg-boss может повторить задание
 * после сбоя, и повтор не должен ничего удваивать (архитектура §8).
 */
@Injectable()
export class JobHandlers {
  private readonly logger = new Logger(JobHandlers.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(S3) private readonly s3: S3Client,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly keycloak: KeycloakAdminService,
    private readonly sessions: SessionService,
    private readonly onboarding: ManufacturerOnboardingService,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE) private readonly queue: PgBoss,
  ) {}

  /** Истёкший сертификат помечается, но профиль не скрывается (REV-20). */
  async certificateExpiry(): Promise<void> {
    const expired = await this.db
      .update(certificates)
      .set({ status: 'expired' })
      .where(and(eq(certificates.status, 'verified'), lt(certificates.expiresOn, sql`current_date`)))
      .returning({ id: certificates.id });
    this.logger.log(`сертификатов истекло: ${expired.length}`);
    // TODO: уведомления за 30 дней и в день истечения (NOT-30, NOT-31), пересборка catalog_visible.
  }

  async purgeSessions(): Promise<void> {
    const now = new Date();
    await this.db.delete(sessions).where(lt(sessions.expiresAt, now));
    await this.db.delete(otpCodes).where(lt(otpCodes.expiresAt, now));
    await this.db.delete(trustedDevices).where(lt(trustedDevices.expiresAt, now));
    await this.db.delete(authRateLimits).where(lt(authRateLimits.windowStart, new Date(Date.now() - 86_400_000)));
    await this.db
      .delete(authSecurityEvents)
      .where(lt(authSecurityEvents.createdAt, new Date(Date.now() - 32 * 86_400_000)));
    await this.db.delete(revokedIdpSessions).where(lt(revokedIdpSessions.expiresAt, now));
  }

  async sendPasswordEmail({ subject }: IdentityJob): Promise<void> {
    const account = await this.db.query.userAccounts.findFirst({ where: eq(userAccounts.idpSubject, subject) });
    if (account?.state === 'invited') await this.keycloak.sendPasswordEmail(subject);
  }

  async cleanupIdentity({ subject }: IdentityJob): Promise<void> {
    const account = await this.db.query.userAccounts.findFirst({ where: eq(userAccounts.idpSubject, subject) });
    if (!account) await this.keycloak.deleteUser(subject);
  }

  /**
   * Keycloak догоняет решение администратора (ADM-02, ADM-05, AUTH-06): всегда к текущей строке БД, а не
   * к данным задания — повтор, порядок заданий и задание после следующего действия сходятся к одному.
   * Аккаунт без субъекта (seed до первого входа) догонять нечего. Сбой Keycloak — повтор pg-boss.
   */
  async syncIdentity({ accountId, logout }: IdentitySyncJob): Promise<void> {
    const [account] = await this.db
      .select({ subject: userAccounts.idpSubject, state: userAccounts.state, email: userAccounts.email })
      .from(userAccounts)
      .where(eq(userAccounts.id, accountId));
    if (!account?.subject) return;
    try {
      await this.keycloak.updateUser(account.subject, { enabled: account.state !== 'blocked', email: account.email });
    } catch (error) {
      // Пользователь удалён в Keycloak: догонять нечего, повтор ничего не изменит. Прочие сбои — повтор.
      if (error instanceof KeycloakRequestError && error.status === 404) {
        this.logger.warn({ accountId }, 'identity-sync: user not found in Keycloak');
        return;
      }
      throw error;
    }
    if (logout) await this.keycloak.logoutUser(account.subject);
  }

  /**
   * Аккаунт стал inactive (AUTH-07, NOT-26): сеансы IdP завершаются, письмо NOT-01 ссылкой сброса (72 часа,
   * AUTH-01) — на языке атрибута `locale` пользователя Keycloak. Обязательное действие `UPDATE_PASSWORD`
   * пользователю не ставится — оно только в токене ссылки: иначе вход со старым паролем сразу просил бы новый
   * и возвращал аккаунт мимо ящика. Вход со старым паролем отклоняет BFF (`account_inactive`). Пользователь
   * остаётся включённым — иначе ссылка не сработает. Аккаунт уже не inactive или без субъекта — выход.
   * Повтор безвреден.
   */
  async sendInactivityReset({ accountId }: AccountJob): Promise<void> {
    const [account] = await this.db
      .select({ subject: userAccounts.idpSubject, state: userAccounts.state })
      .from(userAccounts)
      .where(eq(userAccounts.id, accountId));
    if (account?.state !== 'inactive' || !account.subject) return;
    await this.keycloak.logoutUser(account.subject);
    await this.keycloak.sendPasswordEmail(account.subject, ['UPDATE_PASSWORD']);
  }

  /** Файлы выгрузок хранятся 90 дней (OPR-23); запись о запуске остаётся. */
  async purgeExportFiles(): Promise<void> {
    const stale = await this.db
      .select({ id: exportFiles.id, bucket: exportFiles.bucket, key: exportFiles.objectKey })
      .from(exportFiles)
      .where(and(lt(exportFiles.expiresAt, new Date()), isNotNull(exportFiles.objectKey)))
      .limit(1000);
    if (!stale.length) return;
    await this.s3.send(
      new DeleteObjectsCommand({
        Bucket: this.env.S3_BUCKET_EXPORTS,
        Delete: { Objects: stale.map((f) => ({ Key: f.key! })), Quiet: true },
      }),
    );
    for (const f of stale) {
      await this.db.update(exportFiles).set({ objectKey: null, bucket: null }).where(eq(exportFiles.id, f.id));
    }
  }

  /**
   * AUTH-04: Keycloak блокирует вход после 10 ошибок на 15 минут, но писем не шлёт.
   * Раз в минуту читаем его события: отзыв сеансов по смене пароля, профиль после установки пароля и
   * блокировки входа. Блокировка — задание `notify` NOT-03 и аудит `auth.locked_out` (`recordLockout`); письмо
   * отправляет диспетчер в своём задании, его сбои и повторы ленту событий не держат. Курсор сдвигается, когда
   * пакет обработан; сбой базы или очереди — исключение, курсор на месте, следующий опрос прочтёт пакет снова.
   */
  async keycloakEvents(): Promise<void> {
    const started = new Date();
    const cursor = await this.db.query.authSyncState.findFirst({ where: eq(authSyncState.name, 'keycloak-events') });
    const since = new Date(cursor ? cursor.checkedAt.getTime() - 5 * 60_000 : Date.now() - 30 * 86_400_000);
    const events = await this.keycloak.securityEvents(since);
    const ordered = events.sort((a, b) => a.time - b.time);
    // Самое раннее время установки пароля в пакете — момент появления профиля (registered_at, MAN-03).
    const passwordSet = new Map<string, Date>();
    for (const event of ordered) {
      if (!event.userId || event.error || !Number.isFinite(event.time)) continue;
      if (isPasswordEvent(event)) {
        await this.sessions.revokeForPasswordChange(
          event.userId,
          new Date(event.time),
          `password:${sha256(event.id ?? `${event.type}:${event.userId}:${event.time}`)}`,
        );
        if (!passwordSet.has(event.userId)) passwordSet.set(event.userId, new Date(event.time));
      }
    }
    // Профиль и чтение Adata — после всех отзывов пакета и до уведомлений: отзыв не ждёт онбординг.
    for (const [subject, at] of passwordSet) await this.onboardAfterPassword(subject, at);
    for (const event of ordered) {
      if (!event.userId || event.error || !Number.isFinite(event.time)) continue;
      if (event.type === 'USER_DISABLED_BY_TEMPORARY_LOCKOUT') await this.recordLockout(event.userId, event.time);
    }
    await this.db
      .insert(authSyncState)
      .values({ name: 'keycloak-events', checkedAt: started })
      .onConflictDoUpdate({ target: authSyncState.name, set: { checkedAt: started } });
  }

  /**
   * Блокировка входа (AUTH-04, NOT-26): одна транзакция — отметка события `lockout:<sha256(субъект:время)>` в
   * `auth_security_events`, задание `notify` NOT-03 (ключ события `<субъект>:<время>`, как в журнале писем) и
   * аудит `auth.locked_out`. Повтор того же события (повтор задания опроса, перекрытие пятиминутных окон,
   * параллельный опрос) упирается в отметку: второго задания и второй записи аудита нет. Аудит не зависит от
   * доставки письма. Отметки живут 32 дня (`purgeSessions`) — дольше самого длинного окна опроса (30 дней).
   */
  private async recordLockout(subject: string, time: number): Promise<void> {
    const eventKey = `${subject}:${time}`;
    await withQueueTransaction(this.pool, async (tx, queueDb) => {
      const [account] = await tx
        .select({ id: userAccounts.id, organizationId: userAccounts.organizationId })
        .from(userAccounts)
        .where(eq(userAccounts.idpSubject, subject));
      if (!account) return;
      const [fresh] = await tx
        .insert(authSecurityEvents)
        .values({ eventKey: `lockout:${sha256(eventKey)}` })
        .onConflictDoNothing()
        .returning();
      if (!fresh) return;
      // Expand (NFR-06): эту блокировку уже обработала предыдущая версия worker (письмо и аудит) — строка
      // NOT-03 с тем же ключом в notifications_sent. Убрать в contract вместе с notifications_sent.
      const [legacy] = await tx
        .select({ id: notificationsSent.id })
        .from(notificationsSent)
        .where(and(eq(notificationsSent.code, 'NOT-03'), eq(notificationsSent.dedupeKey, eventKey)));
      if (legacy) return;
      await enqueueNotification(
        this.queue,
        {
          rule: 'NOT-03',
          eventKey,
          accountId: account.id,
          params: { minutes: '15', link: appLink(this.env.PUBLIC_URL, '/login') },
        },
        queueDb,
      );
      await this.audit.record(
        {
          userId: account.id,
          organizationId: account.organizationId,
          action: 'auth.locked_out',
          objectType: 'account',
          objectId: account.id,
          outcome: 'denied',
          isAccountEvent: true,
        },
        tx,
      );
    });
  }

  /**
   * Установка пароля создаёт Draft-профиль и принятие NDA (MAN-03, FC-02) и ставит одно чтение Adata
   * (IMBC-07) — одной транзакцией, без писем (NOT-23). Сбой не мешает отзыву сеансов, письмам NOT-03
   * и сдвигу курсора: следующий вход или повтор события в пятиминутном окне опроса создаст всё. Повтор
   * события — existing; попытку в quota_exhausted или not_configured он ставит снова (requeued).
   */
  private async onboardAfterPassword(subject: string, at: Date): Promise<void> {
    try {
      const [account] = await this.db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(eq(userAccounts.idpSubject, subject));
      if (account) await this.onboarding.onPasswordSet(account.id, 'password_set', at);
    } catch {
      this.logger.warn('onboarding: профиль после установки пароля не создан');
    }
  }

  /** Заглушки этапа 0: контракты заданий и расписание уже на месте, логика — в своих модулях. */
  async todo(queue: string): Promise<void> {
    this.logger.debug(`${queue}: обработчик ещё не реализован`);
  }
}

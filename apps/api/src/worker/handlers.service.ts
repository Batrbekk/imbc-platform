import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import { AuditService } from '../common/audit.service.js';
import { ENV, type Env } from '../config/env.js';
import { DB, type Database } from '../database/database.module.js';
import {
  certificates,
  exportFiles,
  fileVersions,
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
import { S3 } from '../infra/infra.module.js';
import { MailService } from '../mail/mail.service.js';
import { renderMail } from '../mail/templates.js';
import { KeycloakAdminService } from '../modules/auth/keycloak-admin.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { sha256 } from '../modules/auth/crypto.js';
import { ManufacturerOnboardingService } from '../modules/registration/onboarding.service.js';
import type { IdentityJob, IdentitySyncJob, ScanFileJob, SendNotificationJob } from '../jobs/queues.js';
import { scanStream } from './clamd.js';

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
    private readonly mail: MailService,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly keycloak: KeycloakAdminService,
    private readonly sessions: SessionService,
    private readonly onboarding: ManufacturerOnboardingService,
  ) {}

  /** Файл из карантина проверяется ClamAV и только чистым переносится в рабочий бакет (FILE-03). */
  async scanFile({ fileVersionId }: ScanFileJob): Promise<void> {
    const [version] = await this.db.select().from(fileVersions).where(eq(fileVersions.id, fileVersionId));
    if (!version || version.scanState !== 'pending') return;

    const object = await this.s3.send(new GetObjectCommand({ Bucket: version.bucket, Key: version.objectKey }));
    const verdict = await scanStream(this.env.CLAMAV_HOST, this.env.CLAMAV_PORT, object.Body as Readable);

    if (verdict.clean) {
      await this.s3.send(
        new CopyObjectCommand({
          Bucket: this.env.S3_BUCKET_FILES,
          Key: version.objectKey,
          CopySource: `${version.bucket}/${encodeURIComponent(version.objectKey)}`,
        }),
      );
      await this.db
        .update(fileVersions)
        .set({ scanState: 'clean', scannedAt: new Date(), bucket: this.env.S3_BUCKET_FILES })
        .where(eq(fileVersions.id, fileVersionId));
    } else {
      await this.db
        .update(fileVersions)
        .set({ scanState: 'infected', scannedAt: new Date() })
        .where(eq(fileVersions.id, fileVersionId));
      await this.audit.record({
        userId: version.uploadedBy,
        action: 'file.infected',
        objectType: 'file_version',
        objectId: fileVersionId,
        outcome: 'denied',
        diff: { signature: verdict.signature },
      });
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: version.bucket, Key: version.objectKey }));
  }

  /** Одно письмо на событие и адрес: уникальный ключ в notifications_sent (NOT-20, ADR-22). */
  async sendNotification(job: SendNotificationJob): Promise<void> {
    const [claimed] = await this.db
      .insert(notificationsSent)
      .values({ code: job.code, dedupeKey: job.dedupeKey, recipient: job.to, locale: job.locale })
      .onConflictDoNothing()
      .returning({ id: notificationsSent.id });
    if (!claimed) return;
    try {
      await this.mail.sendRaw(job.to, job.subject, job.text, job.html);
    } catch (error) {
      // Освобождаем ключ, чтобы повтор задания отправил письмо.
      await this.db.delete(notificationsSent).where(eq(notificationsSent.id, claimed.id));
      throw error;
    }
  }

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
    await this.keycloak.updateUser(account.subject, { enabled: account.state !== 'blocked', email: account.email });
    if (logout) await this.keycloak.logoutUser(account.subject);
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
   * Раз в минуту читаем его события и отправляем NOT-03 — одно письмо на одну блокировку.
   */
  async keycloakEvents(): Promise<void> {
    const started = new Date();
    const cursor = await this.db.query.authSyncState.findFirst({ where: eq(authSyncState.name, 'keycloak-events') });
    const since = new Date(cursor ? cursor.checkedAt.getTime() - 5 * 60_000 : Date.now() - 30 * 86_400_000);
    const events = await this.keycloak.securityEvents(since);
    const ordered = events.sort((a, b) => a.time - b.time);
    // Revocations must finish even when an unrelated lockout notification cannot be mailed.
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
      if (event.type !== 'USER_DISABLED_BY_TEMPORARY_LOCKOUT') continue;
      const [account] = await this.db
        .select({
          id: userAccounts.id,
          email: userAccounts.email,
          locale: userAccounts.locale,
          organizationId: userAccounts.organizationId,
        })
        .from(userAccounts)
        .where(eq(userAccounts.idpSubject, event.userId));
      if (!account) continue;
      const dedupeKey = `${event.userId}:${event.time}`;
      const mail = renderMail('NOT-03', account.locale, { minutes: 15, publicUrl: this.env.PUBLIC_URL });
      const before = await this.db
        .select({ id: notificationsSent.id })
        .from(notificationsSent)
        .where(and(eq(notificationsSent.code, 'NOT-03'), eq(notificationsSent.dedupeKey, dedupeKey)));
      if (before.length) continue;
      await this.sendNotification({ code: 'NOT-03', dedupeKey, to: account.email, locale: account.locale, ...mail });
      await this.audit.record({
        userId: account.id,
        organizationId: account.organizationId,
        action: 'auth.locked_out',
        objectType: 'account',
        objectId: account.id,
        outcome: 'denied',
        isAccountEvent: true,
      });
    }
    await this.db
      .insert(authSyncState)
      .values({ name: 'keycloak-events', checkedAt: started })
      .onConflictDoUpdate({ target: authSyncState.name, set: { checkedAt: started } });
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

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
import { AdataScheduler } from '../modules/adata/adata.scheduler.js';
import { KeycloakAdminService } from '../modules/auth/keycloak-admin.service.js';
import { SessionService } from '../modules/auth/session.service.js';
import { sha256 } from '../modules/auth/crypto.js';
import type { IdentityJob, ScanFileJob, SendNotificationJob } from '../jobs/queues.js';
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
    private readonly adata: AdataScheduler,
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
    for (const event of ordered) {
      if (!event.userId || event.error || !Number.isFinite(event.time)) continue;
      if (isPasswordEvent(event)) {
        await this.sessions.revokeForPasswordChange(
          event.userId,
          new Date(event.time),
          `password:${sha256(event.id ?? `${event.type}:${event.userId}:${event.time}`)}`,
        );
        await this.requestAdataRead(event.userId);
      }
    }
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
   * Установка пароля создаёт профиль (MAN-03, NOT-23) — с ней ставится одно чтение Adata (IMBC-07).
   * Сбой не мешает отзыву сеансов и письмам NOT-03; повтор события в окне опроса даёт skipped.
   */
  private async requestAdataRead(subject: string): Promise<void> {
    try {
      const [account] = await this.db
        .select({ id: userAccounts.id })
        .from(userAccounts)
        .where(eq(userAccounts.idpSubject, subject));
      if (account) await this.adata.requestOnProfileCreated(account.id, 'password_set');
    } catch {
      this.logger.warn('adata: чтение после установки пароля не поставлено');
    }
  }

  /** Заглушки этапа 0: контракты заданий и расписание уже на месте, логика — в своих модулях. */
  async todo(queue: string): Promise<void> {
    this.logger.debug(`${queue}: обработчик ещё не реализован`);
  }
}

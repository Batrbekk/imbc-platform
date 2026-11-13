import {
  type OrgChartSampleCurrent,
  orgChartSampleCurrentSchema,
  type OrgChartSampleState,
  orgChartSampleStateSchema,
  type OrgChartSampleUpload,
  orgChartSampleUploadSchema,
} from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import { actorTransaction, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database, PG_POOL } from '../../database/database.module.js';
import { fileVersion, orgChartSample } from '../../database/schema/index.js';
import type { AuthContext, AuthUser } from '../auth/auth.types.js';
import { type FileDescription, FilesService, type OpenedFile } from './files.service.js';
import { storageFailureSummary } from './object-storage.js';
import { orgChartSampleAccess } from './org-chart-sample.rules.js';
import type { AcceptedUpload } from './upload.js';

/** Маршруты образца, как их пишут в аудит отказ SessionGuard (`req.route.path`) и `actorTransaction`. */
export const ORG_CHART_SAMPLE_ROUTES = {
  /** GET — состояние (`reference.read`), POST — загрузка (`reference.manage`). */
  sample: '/api/v1/org-chart-sample',
  /** GET — описание текущего образца; без действия матрицы, доступ — `orgChartSampleAccess`. */
  current: '/api/v1/org-chart-sample/current',
  /** GET и HEAD — байты текущего образца; без действия матрицы, доступ — `orgChartSampleAccess`. */
  currentContent: '/api/v1/org-chart-sample/current/content',
} as const;

const logger = new Logger('OrgChartSample');

const forbidden = () => new ProblemException(403, 'forbidden', 'Нет прав на образец оргструктуры');

/** Последняя версия файла образца — её же отдаёт скачивание без `?version`. */
const latestVersion = and(
  eq(fileVersion.fileObjectId, orgChartSample.fileObjectId),
  sql`${fileVersion.versionNumber} = (select max(fv.version_number) from file_version fv
        where fv.file_object_id = ${orgChartSample.fileObjectId})`,
);

/** Текущий образец: строка `is_current` и последняя версия файла прошла скан (DATA-07). */
const currentAndPassed = and(eq(orgChartSample.isCurrent, true), eq(fileVersion.scanState, 'passed'));

/**
 * Образец оргструктуры (ADM-11, MAN-19): загружает администратор (`reference.manage`), видят администратор и
 * директор (`reference.read`), производитель — только текущий (`orgChartSampleAccess`). Загрузка — единый путь
 * файла (`FilesService`): карантин, строка `org_chart_sample` с `is_current = false`, скан в worker; текущим
 * образец делает `orgChartSamplePassed` (DATA-07). Скачивание — `GET /api/v1/files/:id/content` по
 * `orgChartSampleReadRule` или стабильная ссылка `GET /api/v1/org-chart-sample/current/content`.
 */
@Injectable()
export class OrgChartSampleService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Текущий образец и последняя загрузка, если она не текущая (на проверке или отклонена). Текущий — строка
   * `is_current` с версией `passed`: строка без прошедшей скан версии текущим не показывается (страховка от
   * умолчания колонки). Один запрос — один снимок: текущий и последний не расходятся при смене текущего между
   * чтениями. Порядок «последней» — тот же, что у хука: `uploaded_at`, затем id.
   */
  async state(): Promise<OrgChartSampleState> {
    const rows = await this.db
      .select({
        isCurrent: orgChartSample.isCurrent,
        uploadedAt: orgChartSample.uploadedAt,
        fileId: orgChartSample.fileObjectId,
        originalName: fileVersion.originalName,
        byteSize: fileVersion.byteSize,
        mediaType: fileVersion.detectedMediaType,
        scanState: fileVersion.scanState,
      })
      .from(orgChartSample)
      .innerJoin(fileVersion, latestVersion)
      .where(
        or(
          eq(orgChartSample.isCurrent, true),
          eq(
            orgChartSample.id,
            sql`(select s.id from org_chart_sample s order by s.uploaded_at desc, s.id desc limit 1)`,
          ),
        ),
      )
      .orderBy(desc(orgChartSample.uploadedAt), desc(orgChartSample.id));
    const toFile = (row: (typeof rows)[number]) => ({
      fileId: row.fileId,
      originalName: row.originalName,
      byteSize: row.byteSize,
      mediaType: row.mediaType ?? 'application/octet-stream',
      scanState: row.scanState,
      uploadedAt: row.uploadedAt.toISOString(),
    });
    const current = rows.find((row) => row.isCurrent && row.scanState === 'passed');
    // Последняя загрузка — первая строка (текущий не новее последней), если она не текущая и ещё не прошла скан:
    // прошедшая скан последняя загрузка — это текущий.
    const latest = rows[0] && rows[0] !== current && rows[0].scanState !== 'passed' ? rows[0] : undefined;
    return parseResponse(
      orgChartSampleStateSchema,
      { current: current ? toFile(current) : null, latest: latest ? toFile(latest) : null },
      'образец оргструктуры',
    );
  }

  /**
   * Описание текущего образца для ссылки «Скачать» (MAN-19): имя, размер, тип, время загрузки — без id файла,
   * состояния скана и истории. Роли без доступа (`orgChartSampleAccess` — null) — 403 и `file.read` `denied`.
   * Текущего нет (в том числе только загрузки на проверке или отклонённые) — `current: null`.
   */
  async current(user: AuthUser, ip: string | null): Promise<OrgChartSampleCurrent> {
    if (!orgChartSampleAccess(user.role)) await this.deny(user, ip);
    const row = await this.findCurrent();
    return parseResponse(
      orgChartSampleCurrentSchema,
      {
        current: row
          ? {
              originalName: row.originalName,
              byteSize: row.byteSize,
              mediaType: row.mediaType ?? 'application/octet-stream',
              uploadedAt: row.uploadedAt.toISOString(),
            }
          : null,
      },
      'текущий образец оргструктуры',
    );
  }

  /**
   * Байты текущего образца (стабильная ссылка, id файла не раскрывается): доступ — `orgChartSampleAccess`
   * (null — 403 и `file.read` `denied`), текущего нет — 404, затем `FilesService.open` с его правом, проверкой
   * скана и аудитом `file.downloaded` (GEN-09, DATA-07, NFR-09).
   */
  async openCurrent(auth: AuthContext, ip: string | null): Promise<OpenedFile> {
    const current = await this.locateCurrent(auth.user, ip);
    return this.files.open(auth, current.fileId, current.versionNumber, ip);
  }

  /** Те же проверки и заголовки, что у `openCurrent`, без чтения объекта и без «скачано» — для HEAD. */
  async describeCurrent(auth: AuthContext, ip: string | null): Promise<FileDescription> {
    const current = await this.locateCurrent(auth.user, ip);
    return this.files.describe(auth, current.fileId, current.versionNumber, ip);
  }

  private async locateCurrent(user: AuthUser, ip: string | null) {
    if (!orgChartSampleAccess(user.role)) await this.deny(user, ip);
    const current = await this.findCurrent();
    if (!current) throw notFound();
    return current;
  }

  private async findCurrent() {
    const [row] = await this.db
      .select({
        fileId: orgChartSample.fileObjectId,
        versionNumber: fileVersion.versionNumber,
        originalName: fileVersion.originalName,
        byteSize: fileVersion.byteSize,
        mediaType: fileVersion.detectedMediaType,
        uploadedAt: orgChartSample.uploadedAt,
      })
      .from(orgChartSample)
      .innerJoin(fileVersion, latestVersion)
      .where(currentAndPassed)
      .limit(1);
    return row;
  }

  /**
   * Отказ роли без доступа к образцам — как отказ в чтении файла (`FilesService`): `file.read` `denied`,
   * `objectType: 'file_object'`; id файла нет — текущий образец для отказа не ищется. Сбой записи не подменяет
   * 403 ошибкой 500: в журнал — сводка.
   */
  private async deny(user: AuthUser, ip: string | null): Promise<never> {
    try {
      await this.audit.record({
        userId: user.id,
        organizationId: user.organizationId,
        action: 'file.read',
        objectType: 'file_object',
        objectId: null,
        outcome: 'denied',
        ip,
      });
    } catch (error) {
      logger.error(storageFailureSummary(error), 'Denied organisation chart sample read audit failed');
    }
    throw forbidden();
  }

  /**
   * Загрузка нового образца (ADM-11): байты — в карантин (`withStagedObject`), затем транзакция действия
   * (`actorTransaction`: исполнитель под блокировкой всё ещё администратор, иначе 403 и `denied`, объект карантина
   * удаляется) — `file_object` организации исполнителя (IMBC), класс `e_administration`, версия `pending`, задание
   * `file-scan`, строка `org_chart_sample` не текущая с `uploaded_at = now()` транзакции, аудит
   * `org_chart_sample.uploaded` (`{ fileObjectId }`, без имени файла; IP — только колонка `ip`).
   */
  async upload(actor: AuthUser, upload: AcceptedUpload, ip: string | null): Promise<OrgChartSampleUpload> {
    return this.files.withStagedObject(upload, (storageKey) =>
      actorTransaction(
        this.pool,
        this.audit,
        actor,
        { route: ORG_CHART_SAMPLE_ROUTES.sample, ip, action: 'reference.manage' },
        async (tx, queueDb) => {
          const { fileObjectId } = await this.files.recordNew(tx, queueDb, {
            organizationId: actor.organizationId,
            purpose: 'organisation_chart_sample',
            dataClass: 'e_administration',
            uploadedBy: actor.id,
            upload,
            storageKey,
          });
          const [sample] = await tx
            .insert(orgChartSample)
            .values({ fileObjectId, uploadedBy: actor.id, uploadedAt: sql`now()`, isCurrent: false })
            .returning({ id: orgChartSample.id, uploadedAt: orgChartSample.uploadedAt });
          await this.audit.record(
            {
              userId: actor.id,
              organizationId: actor.organizationId,
              action: 'org_chart_sample.uploaded',
              objectType: 'org_chart_sample',
              objectId: sample!.id,
              diff: { fileObjectId },
              isAccountEvent: false,
              ip,
            },
            tx,
          );
          // Разбор ответа — до COMMIT: отказ схемы откатывает строки, и объект карантина удаляется вместе с ними.
          return parseResponse(
            orgChartSampleUploadSchema,
            {
              upload: {
                fileId: fileObjectId,
                originalName: upload.originalName,
                byteSize: upload.bytes.length,
                mediaType: upload.mediaType,
                scanState: 'pending',
                uploadedAt: sample!.uploadedAt.toISOString(),
              },
            },
            'загрузка образца оргструктуры',
          );
        },
      ),
    );
  }
}

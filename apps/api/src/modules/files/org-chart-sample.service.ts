import {
  type OrgChartSampleFile,
  type OrgChartSampleState,
  orgChartSampleStateSchema,
  type OrgChartSampleUpload,
  orgChartSampleUploadSchema,
} from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import { actorTransaction } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseResponse } from '../../common/response.js';
import { DB, type Database, PG_POOL } from '../../database/database.module.js';
import { fileVersion, orgChartSample } from '../../database/schema/index.js';
import type { ScanPassedHook } from '../../worker/file-scan.job.js';
import type { AuthUser } from '../auth/auth.types.js';
import { FilesService } from './files.service.js';
import type { AcceptedUpload } from './upload.js';

/** Маршрут образца, как его пишут в аудит отказ SessionGuard (`req.route.path`) и `actorTransaction`. */
export const ORG_CHART_SAMPLE_ROUTES = {
  /** GET — состояние (`reference.read`), POST — загрузка (`reference.manage`). */
  sample: '/api/v1/org-chart-sample',
} as const;

const logger = new Logger('OrgChartSample');

/**
 * Хук скана образца (DATA-07, расхождение 13 плана этапа 2) — в транзакции перехода версии в `passed`. Все строки
 * `org_chart_sample` берутся `for update` в порядке id: хуки двух сканов идут по очереди, второй видит итог
 * первого. Образец этого файла становится текущим, только если он загружен позже текущего — по `uploaded_at`
 * (сравнение в SQL, с микросекундами), при равенстве по id — или если текущего нет; прежний текущий получает
 * `is_current = false` и остаётся строкой истории. Порядок «снять, затем поставить» — частичный уникальный индекс
 * `org_chart_sample_current_uq` не откладывается.
 */
export const orgChartSamplePassed: ScanPassedHook = async (tx, version) => {
  const samples = await tx
    .select({ id: orgChartSample.id, fileObjectId: orgChartSample.fileObjectId, isCurrent: orgChartSample.isCurrent })
    .from(orgChartSample)
    .orderBy(asc(orgChartSample.id))
    .for('update');
  const sample = samples.find((s) => s.fileObjectId === version.fileObjectId);
  if (!sample) {
    // Строку образца и файл пишет одна транзакция загрузки; файл без строки текущим не становится.
    logger.warn({ fileVersionId: version.id }, 'Organisation chart sample row not found after scan');
    return;
  }
  if (sample.isCurrent) return;
  await tx.execute(sql`
    update org_chart_sample c set is_current = false
      from org_chart_sample s
     where s.id = ${sample.id} and c.is_current and (c.uploaded_at, c.id) < (s.uploaded_at, s.id)`);
  await tx
    .update(orgChartSample)
    .set({ isCurrent: true })
    .where(
      and(eq(orgChartSample.id, sample.id), sql`not exists (select 1 from org_chart_sample c where c.is_current)`),
    );
};

/**
 * Образец оргструктуры (ADM-11, MAN-19): загружает администратор (`reference.manage`), видят администратор и
 * директор (`reference.read`). Загрузка — единый путь файла (`FilesService`): карантин, строка `org_chart_sample`
 * с `is_current = false`, скан в worker; текущим образец делает `orgChartSamplePassed` (DATA-07). Скачивание —
 * `GET /api/v1/files/:id/content` по `orgChartSampleReadRule` (производитель — только текущий).
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
   * Текущий образец и последняя загрузка, если она не текущая (на проверке или отклонена). Один запрос — один
   * снимок: текущий и последний не расходятся при смене текущего между чтениями. Порядок «последней» — тот же,
   * что у хука: `uploaded_at`, затем id.
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
      .innerJoin(
        fileVersion,
        and(
          eq(fileVersion.fileObjectId, orgChartSample.fileObjectId),
          // Последняя версия файла — её же отдаёт скачивание без ?version.
          sql`${fileVersion.versionNumber} = (select max(fv.version_number) from file_version fv
                where fv.file_object_id = ${orgChartSample.fileObjectId})`,
        ),
      )
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
    const toFile = (row: (typeof rows)[number]): OrgChartSampleFile => ({
      fileId: row.fileId,
      originalName: row.originalName,
      byteSize: row.byteSize,
      mediaType: row.mediaType ?? 'application/octet-stream',
      scanState: row.scanState,
      uploadedAt: row.uploadedAt.toISOString(),
    });
    const current = rows.find((row) => row.isCurrent);
    // Последняя загрузка — первая строка: текущий не новее последней.
    const latest = rows[0] && !rows[0].isCurrent ? rows[0] : undefined;
    return parseResponse(
      orgChartSampleStateSchema,
      { current: current ? toFile(current) : null, latest: latest ? toFile(latest) : null },
      'образец оргструктуры',
    );
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

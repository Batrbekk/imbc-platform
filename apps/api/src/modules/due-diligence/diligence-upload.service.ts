import {
  profileUploadSchema,
  profileUploadStateSchema,
  type ProfileUpload,
  type ProfileUploadState,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type pg from 'pg';
import { z } from 'zod';
import { actorTransaction, isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL } from '../../database/database.module.js';
import { fileVersion } from '../../database/schema/files.js';
import type { AuthUser } from '../auth/auth.types.js';
import { FilesService } from '../files/files.service.js';
import type { AcceptedUpload } from '../files/upload.js';
import { lockDiligenceScope } from './diligence.service.js';

const purposeSchema = z.enum(['due_diligence_report', 'enhanced_due_diligence_report']);
export const DILIGENCE_UPLOAD_ROUTE = 'v1/profiles/:profileId/due-diligence/files/:purpose';

/** Report candidates remain unreadable bytes until explicit DD save captures a passed exact version. */
@Injectable()
export class DiligenceUploadService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}
  async authorize(actor: AuthUser, profileId: string, purpose: unknown, ip: string | null): Promise<void> {
    purposeSchema.parse(purpose);
    if (!isUuid(profileId)) throw notFound();
    await actorTransaction(
      this.pool,
      this.audit,
      actor,
      { action: 'imbc_records.edit', route: DILIGENCE_UPLOAD_ROUTE, ip },
      async (tx) => {
        await lockDiligenceScope(tx, actor, profileId, true);
      },
    );
  }
  async upload(
    actor: AuthUser,
    profileId: string,
    purposeValue: unknown,
    upload: AcceptedUpload,
    ip: string | null,
  ): Promise<ProfileUpload> {
    const purpose = purposeSchema.parse(purposeValue);
    await this.authorize(actor, profileId, purpose, ip);
    return this.files.withStagedObject(upload, (storageKey) =>
      actorTransaction(
        this.pool,
        this.audit,
        actor,
        { action: 'imbc_records.edit', route: DILIGENCE_UPLOAD_ROUTE, ip },
        async (tx, queueDb) => {
          const scope = await lockDiligenceScope(tx, actor, profileId, true);
          const saved = await this.files.recordNew(tx, queueDb, {
            organizationId: scope.organizationId,
            purpose,
            dataClass: 'c_imbc',
            uploadedBy: actor.id,
            upload,
            storageKey,
          });
          const version = (await tx.select().from(fileVersion).where(eq(fileVersion.id, saved.versionId)))[0]!;
          await this.audit.record(
            {
              userId: actor.id,
              organizationId: scope.organizationId,
              action: 'due_diligence.file_uploaded',
              objectType: 'file_object',
              objectId: saved.fileObjectId,
              diff: { profileId, purpose, versionId: saved.versionId },
              ip,
            },
            tx,
          );
          return parseResponse(
            profileUploadSchema,
            {
              upload: {
                fileId: saved.fileObjectId,
                versionId: saved.versionId,
                versionNumber: 1,
                originalName: version.originalName,
                byteSize: version.byteSize,
                mediaType: version.detectedMediaType ?? version.declaredMediaType,
                scanState: version.scanState,
                rejectionReason: version.rejectionReason,
                uploadedAt: version.uploadedAt.toISOString(),
                canDownload: false,
              },
            },
            'загрузка отчёта DD',
          );
        },
      ),
    );
  }
  async metadata(
    actor: AuthUser,
    profileId: string,
    purposeValue: unknown,
    fileId: string,
    ip: string | null,
  ): Promise<ProfileUploadState> {
    const purpose = purposeSchema.parse(purposeValue);
    if (![profileId, fileId].every(isUuid)) throw notFound();
    return actorTransaction(
      this.pool,
      this.audit,
      actor,
      { action: 'imbc_records.edit', route: DILIGENCE_UPLOAD_ROUTE, ip },
      async (tx) => {
        const scope = await lockDiligenceScope(tx, actor, profileId, true);
        const object = (
          await tx.execute(sql`select id from file_object where id=${fileId} and organization_id=${scope.organizationId}
        and purpose=${purpose}::file_purpose and data_class='c_imbc' and purge_requested_at is null for share`)
        ).rows[0];
        if (!object) throw notFound();
        const version = (
          await tx
            .select()
            .from(fileVersion)
            .where(eq(fileVersion.fileObjectId, fileId))
            .orderBy(sql`version_number desc`)
            .limit(1)
        )[0];
        if (!version || version.uploadedBy !== actor.id) throw notFound();
        // Metadata is a candidate preview only. FileReadRule still requires a current/history owner for bytes.
        return parseResponse(
          profileUploadStateSchema,
          {
            upload: {
              fileId,
              versionId: version.id,
              versionNumber: version.versionNumber,
              originalName: version.originalName,
              byteSize: version.byteSize,
              mediaType: version.detectedMediaType ?? version.declaredMediaType,
              scanState: version.scanState,
              rejectionReason: version.rejectionReason,
              uploadedAt: version.uploadedAt.toISOString(),
              canDownload: false,
            },
          },
          'состояние отчёта DD',
        );
      },
    );
  }
}

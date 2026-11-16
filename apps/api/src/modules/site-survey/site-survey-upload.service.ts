import {
  profileUploadSchema,
  profileUploadStateSchema,
  type ProfileUpload,
  type ProfileUploadState,
} from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import type { AuthUser } from '../auth/auth.types.js';
import { FilesService } from '../files/files.service.js';
import type { AcceptedUpload } from '../files/upload.js';
import { runSurveyAction } from './survey-scope.js';

export const SITE_SURVEY_UPLOAD_ROUTE = 'v1/profiles/:profileId/site-surveys/files';
export const SITE_SURVEY_UPLOAD_STATE_ROUTE = SITE_SURVEY_UPLOAD_ROUTE + '/:fileId/state';

type CandidateVersion = {
  fileId: string;
  versionId: string;
  versionNumber: number;
  originalName: string;
  byteSize: number;
  mediaType: string;
  scanState: string;
  rejectionReason: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
};
const candidateVersion = async (tx: Database, fileId: string): Promise<CandidateVersion | undefined> =>
  (
    await tx.execute<CandidateVersion>(sql`
    select file_object_id as "fileId",id as "versionId",version_number as "versionNumber",
      original_name as "originalName",byte_size::int as "byteSize",coalesce(detected_media_type,declared_media_type) as "mediaType",
      scan_state as "scanState",rejection_reason as "rejectionReason",
      to_char(uploaded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "uploadedAt",uploaded_by as "uploadedBy"
    from file_version where file_object_id=${fileId} order by version_number desc limit 1 for share`)
  ).rows[0];
const preview = (row: CandidateVersion) => {
  const { uploadedBy: _actor, ...upload } = row;
  return { upload: { ...upload, canDownload: false } };
};

/** A replacement is a fresh candidate object. Record save captures its passed exact version separately. */
@Injectable()
export class SiteSurveyUploadService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}
  async authorize(actor: AuthUser, profileId: string, ip: string | null): Promise<void> {
    await runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: 'staff_edit', profileId, route: SITE_SURVEY_UPLOAD_ROUTE, ip },
      async () => {},
    );
  }
  async upload(actor: AuthUser, profileId: string, upload: AcceptedUpload, ip: string | null): Promise<ProfileUpload> {
    // The HTTP guard checks before multipart. Recheck before storage and in the registering transaction.
    await this.authorize(actor, profileId, ip);
    return this.files.withStagedObject(upload, (storageKey) =>
      runSurveyAction(
        this.pool,
        this.audit,
        actor,
        { mode: 'staff_edit', profileId, route: SITE_SURVEY_UPLOAD_ROUTE, ip },
        async (tx, queueDb, scope) => {
          const saved = await this.files.recordNew(tx, queueDb, {
            organizationId: scope!.organizationId,
            purpose: 'site_survey_report',
            dataClass: 'c_imbc',
            uploadedBy: actor.id,
            upload,
            storageKey,
          });
          const version = await candidateVersion(tx, saved.fileObjectId);
          if (
            !version ||
            version.versionId !== saved.versionId ||
            version.versionNumber !== 1 ||
            version.uploadedBy !== actor.id
          )
            throw new Error('Survey upload registration mismatch');
          await this.audit.record(
            {
              userId: actor.id,
              organizationId: scope!.organizationId,
              action: 'site_survey.file_uploaded',
              objectType: 'file_object',
              objectId: saved.fileObjectId,
              diff: { profileId: scope!.profileId, purpose: 'site_survey_report', versionId: saved.versionId },
              ip,
            },
            tx,
          );
          return parseResponse(profileUploadSchema, preview(version), 'загрузка отчёта обследования');
        },
      ),
    );
  }
  async metadata(actor: AuthUser, profileId: string, fileId: string, ip: string | null): Promise<ProfileUploadState> {
    if (!isUuid(fileId)) throw notFound();
    return runSurveyAction(
      this.pool,
      this.audit,
      actor,
      { mode: 'staff_edit', profileId, route: SITE_SURVEY_UPLOAD_STATE_ROUTE, ip },
      async (tx, _queueDb, scope) => {
        const object = (
          await tx.execute(sql`select id from file_object where id=${fileId}
          and organization_id=${scope!.organizationId} and purpose='site_survey_report' and data_class='c_imbc'
          and purge_requested_at is null for share`)
        ).rows[0];
        if (!object) throw notFound();
        const version = await candidateVersion(tx, fileId);
        if (!version || version.uploadedBy !== actor.id) throw notFound();
        // Candidate metadata never grants bytes, even once the scan passed.
        return parseResponse(profileUploadStateSchema, preview(version), 'состояние отчёта обследования');
      },
    );
  }
}

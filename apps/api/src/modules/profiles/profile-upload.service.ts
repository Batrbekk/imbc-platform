import {
  profileUploadSchema,
  profileUploadStateSchema,
  profileUploadTargetSchema,
  type ProfileUpload,
  type ProfileUploadState,
  type ProfileUploadTarget,
} from '@imbc/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type pg from 'pg';
import { actorTransaction, isUuid, notFound } from '../../common/actor-transaction.js';
import { AuditService } from '../../common/audit.service.js';
import { ProblemException } from '../../common/problem.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL, type Database } from '../../database/database.module.js';
import { databaseErrorSummary } from '../../database/pg-errors.js';
import { fileObject, fileVersion } from '../../database/schema/index.js';
import type { QueueDb } from '../../database/transaction.js';
import type { AuthUser } from '../auth/auth.types.js';
import { FilesService } from '../files/files.service.js';
import type { AcceptedUpload } from '../files/upload.js';
import { ownProfile, OwnProfileDenied, ownSections, profileIsLocked } from './profile-store.js';
import { profileLocked } from './section-errors.js';

export const PROFILE_UPLOAD_ROUTE = '/api/v1/profiles/own/sections/:kind/files/:purpose';

/** Two short authorization transactions surround multipart/staging; no profile lock is held while reading bytes. */
@Injectable()
export class ProfileUploadService {
  private readonly logger = new Logger(ProfileUploadService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private target(kind: unknown, purpose: unknown): ProfileUploadTarget {
    const parsed = profileUploadTargetSchema.safeParse({ kind, purpose });
    if (!parsed.success)
      throw new ProblemException(400, 'file_purpose_not_allowed', 'Файл не подходит для этого раздела.');
    return parsed.data;
  }

  private async context(tx: Database, actor: AuthUser, target: ProfileUploadTarget, allowLocked = false) {
    const profile = await ownProfile(tx, actor);
    const sections = await ownSections(tx, profile.id, profile.organizationId);
    if (!allowLocked && profileIsLocked(profile, sections)) throw profileLocked();
    const section = sections.find((row) => row.kind === target.kind);
    if (!section) throw new ProblemException(409, 'section_unavailable', 'Раздел недоступен для загрузки.');
    return { profileId: profile.id, organizationId: profile.organizationId, sectionId: section.id };
  }

  private async run<T>(
    actor: AuthUser,
    ip: string | null,
    run: (tx: Database, queueDb: QueueDb) => Promise<T>,
    action: 'profile.read' | 'profile.edit' = 'profile.edit',
  ): Promise<T> {
    try {
      return await actorTransaction(this.pool, this.audit, actor, { route: PROFILE_UPLOAD_ROUTE, ip, action }, run);
    } catch (error) {
      if (error instanceof OwnProfileDenied) {
        try {
          await this.audit.record({
            userId: actor.id,
            organizationId: actor.organizationId,
            action,
            objectType: 'route',
            objectId: PROFILE_UPLOAD_ROUTE,
            outcome: 'denied',
            ip,
          });
        } catch (auditError) {
          this.logger.error(
            databaseErrorSummary(auditError) ?? { error: 'audit_failed' },
            'Denied upload audit failed',
          );
        }
      }
      throw error;
    }
  }

  /** Called by the local guard before the multipart interceptor, including stale account/profile checks. */
  async authorize(actor: AuthUser, kind: unknown, purpose: unknown, ip: string | null): Promise<void> {
    const target = this.target(kind, purpose);
    await this.run(actor, ip, async (tx) => {
      await this.context(tx, actor, target);
    });
  }

  /** This is an own-file preview, including pending/rejected candidates and locked-profile reads. */
  async metadata(
    actor: AuthUser,
    kind: unknown,
    purpose: unknown,
    fileId: string,
    ip: string | null,
  ): Promise<ProfileUploadState> {
    const target = this.target(kind, purpose);
    if (!isUuid(fileId)) throw notFound();
    return this.run(
      actor,
      ip,
      async (tx) => {
        const context = await this.context(tx, actor, target, true);
        const [object] = await tx
          .select({ id: fileObject.id })
          .from(fileObject)
          .where(
            and(
              eq(fileObject.id, fileId),
              eq(fileObject.organizationId, context.organizationId),
              eq(fileObject.dataClass, 'b_manufacturer'),
              eq(fileObject.purpose, target.purpose),
              isNull(fileObject.purgeRequestedAt),
            ),
          )
          .for('share');
        if (!object) throw notFound();
        const [version] = await tx
          .select()
          .from(fileVersion)
          .where(eq(fileVersion.fileObjectId, object.id))
          .orderBy(desc(fileVersion.versionNumber))
          .limit(1);
        if (!version) throw notFound();
        return parseResponse(
          profileUploadStateSchema,
          {
            upload: {
              fileId: object.id,
              versionId: version.id,
              versionNumber: version.versionNumber,
              originalName: version.originalName,
              byteSize: version.byteSize,
              mediaType: version.detectedMediaType ?? version.declaredMediaType,
              scanState: version.scanState,
              rejectionReason: version.rejectionReason,
              uploadedAt: version.uploadedAt.toISOString(),
              canDownload: version.scanState === 'passed',
            },
          },
          'состояние загрузки производителя',
        );
      },
      'profile.read',
    );
  }

  /** DATA-05/07: registration and scan job commit together; a failed second authorization discards staging. */
  async upload(
    actor: AuthUser,
    kind: unknown,
    purpose: unknown,
    upload: AcceptedUpload,
    ip: string | null,
  ): Promise<ProfileUpload> {
    const target = this.target(kind, purpose);
    return this.files.withStagedObject(upload, (storageKey) =>
      this.run(actor, ip, async (tx, queueDb) => {
        const context = await this.context(tx, actor, target);
        const saved = await this.files.recordNew(tx, queueDb, {
          organizationId: context.organizationId,
          purpose: target.purpose,
          dataClass: 'b_manufacturer',
          uploadedBy: actor.id,
          upload,
          storageKey,
        });
        const [version] = await tx
          .select()
          .from(fileVersion)
          .where(and(eq(fileVersion.id, saved.versionId), eq(fileVersion.fileObjectId, saved.fileObjectId)));
        if (!version) throw new Error('Registered upload version is missing');
        await this.audit.record(
          {
            userId: actor.id,
            organizationId: context.organizationId,
            action: 'profile.file.uploaded',
            objectType: 'file_object',
            objectId: saved.fileObjectId,
            diff: { kind: target.kind, purpose: target.purpose, versionNumber: 1 },
            ip,
          },
          tx,
        );
        return parseResponse(
          profileUploadSchema,
          {
            upload: {
              fileId: saved.fileObjectId,
              versionId: version.id,
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
          'загрузка файла производителя',
        );
      }),
    );
  }
}

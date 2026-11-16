import { profileSubmissionStateSchema, type ProfileSubmissionState } from '@imbc/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AuditService } from '../../common/audit.service.js';
import { parseResponse } from '../../common/response.js';
import { PG_POOL } from '../../database/database.module.js';
import type { AuthUser } from '../auth/auth.types.js';
import { runOwnProfileAction } from './own-profile-action.js';
import { selectedCandidateRevisionId } from './profile-candidate.js';
import { profileIsLocked } from './profile-store.js';

/** Own lifecycle context is separate from immutable section DTOs; the client never chooses a profile. */
@Injectable()
export class ProfileSubmissionStateService {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    private readonly audit: AuditService,
  ) {}
  async current(actor: AuthUser, ip: string | null = null): Promise<ProfileSubmissionState> {
    return runOwnProfileAction(
      this.pool,
      this.audit,
      actor,
      { action: 'profile.read', route: '/api/v1/profiles/own/submission', ip },
      async (_tx, _queueDb, { profile, sections }) => {
        return parseResponse(
          profileSubmissionStateSchema,
          {
            profileId: profile.id,
            profileStatus: profile.status,
            activeAssignmentId: profile.activeAssignmentId,
            hasUnsubmittedChanges:
              profile.status === 'verified' &&
              !profileIsLocked(profile, sections) &&
              sections.some((section) => selectedCandidateRevisionId(section) !== section.verifiedRevisionId),
          },
          'состояние своей отправки',
        );
      },
    );
  }
}

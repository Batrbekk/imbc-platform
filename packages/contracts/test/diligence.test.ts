import { describe, expect, it } from 'vitest';
import {
  diligenceCheckReadSchema,
  diligenceEnhancedWriteSchema,
  diligenceLastRunReadSchema,
  diligenceOverrideWriteSchema,
  diligencePublicSummarySchema,
  diligenceReadSchema,
  diligenceTimestampSchema,
  diligenceHistorySchema,
} from '../src/diligence.js';
import { companyCardDataSchema } from '../src/company.js';

const profileId = '00000000-0000-4000-8000-000000000001';
const organizationId = '00000000-0000-4000-8000-000000000002';
const id = '00000000-0000-4000-8000-000000000003';
const timestamp = '2026-11-16T06:03:42.123456Z';
const check = {
  id,
  profileId,
  organizationId,
  groupName: 'company_enterprise',
  subjectName: 'Synthetic company',
  checkName: 'Synthetic check',
  adataValue: 'false',
  mark: 'clear',
  attention: false,
  position: 0,
};
const record = {
  profileId,
  organizationId,
  checkedOn: '2026-11-16',
  checkedAt: timestamp,
  sourceIsTestData: true,
  adataResult: 'green',
  result: 'amber',
  comment: null,
  reportFileId: null,
  reportFileVersionId: null,
  reportFileVersionNumber: null,
  overriddenBy: id,
  overriddenAt: timestamp,
  enhanced: 'not_done',
  enhancedComment: null,
  enhancedReportFileId: null,
  enhancedReportFileVersionId: null,
  enhancedReportFileVersionNumber: null,
  sourceSnapshotId: id,
  updatedAt: timestamp,
};
const read = { profileId, organizationId, record, checks: [check], lastRun: null };

describe('Canonical due diligence boundary', () => {
  it('retains all six PG timestamp digits and refuses lossy or local-time tokens', () => {
    expect(diligenceTimestampSchema.parse(timestamp)).toBe(timestamp);
    for (const value of [
      '2026-11-16T06:03:42.123Z',
      '2026-11-16T06:03:42Z',
      '2026-11-16T06:03:42.123456+06:00',
      '2026-11-16 06:03:42.123456',
    ])
      expect(diligenceTimestampSchema.safeParse(value).success).toBe(false);
  });
  it('keeps unknown versus explicit false/zero and preserves large compound values', () => {
    expect(diligenceCheckReadSchema.parse({ ...check, mark: 'no_answer', adataValue: null }).adataValue).toBeNull();
    for (const adataValue of ['false', '0', '0.00000000000000000001'])
      expect(diligenceCheckReadSchema.parse({ ...check, adataValue }).adataValue).toBe(adataValue);
    const adataValue = JSON.stringify({
      civil: '9'.repeat(10_000),
      criminal: '8'.repeat(10_000),
      administrative: '7'.repeat(10_000),
      appk: '6'.repeat(10_000),
    });
    expect(diligenceCheckReadSchema.parse({ ...check, adataValue, mark: 'shown_only' }).adataValue).toBe(adataValue);
    for (const row of [
      { ...check, mark: 'no_answer' },
      { ...check, adataValue: null },
      { ...check, adataValue: '' },
    ])
      expect(diligenceCheckReadSchema.safeParse(row).success).toBe(false);
  });
  it('refuses cross-profile graphs, missing current records and non-contiguous/repeated check identities', () => {
    expect(diligenceReadSchema.parse(read).checks).toHaveLength(1);
    for (const data of [
      { ...read, record: null },
      { ...read, record: { ...record, organizationId: id } },
      { ...read, checks: [{ ...check, profileId: id }] },
      { ...read, checks: [{ ...check, position: 1 }] },
      { ...read, checks: [check, { ...check, position: 1 }] },
    ])
      expect(diligenceReadSchema.safeParse(data).success).toBe(false);
  });
  it('keeps manual and enhanced intents separate and requires the exact concurrency token', () => {
    const override = { expectedUpdatedAt: timestamp, result: 'red', comment: null, reportFileId: null };
    expect(diligenceOverrideWriteSchema.parse(override).expectedUpdatedAt).toBe(timestamp);
    expect(diligenceOverrideWriteSchema.parse({ ...override, expectedUpdatedAt: null }).expectedUpdatedAt).toBeNull();
    expect(diligenceOverrideWriteSchema.safeParse({ ...override, enhanced: 'done' }).success).toBe(false);
    expect(diligenceOverrideWriteSchema.safeParse({ ...override, expectedUpdatedAt: undefined }).success).toBe(false);
    expect(
      diligenceEnhancedWriteSchema.parse({
        expectedUpdatedAt: timestamp,
        enhanced: 'done',
        comment: 'Synthetic note',
        reportFileId: null,
      }).enhanced,
    ).toBe('done');
    expect(diligenceEnhancedWriteSchema.safeParse({ ...override, enhanced: 'done' }).success).toBe(false);
  });
  it('rejects unpaired override identity/time and unsafe text without rejecting Unicode', () => {
    expect(diligenceReadSchema.safeParse({ ...read, record: { ...record, overriddenBy: null } }).success).toBe(false);
    for (const value of ['synthetic\0text', 'synthetic\uD800'])
      expect(diligenceCheckReadSchema.safeParse({ ...check, subjectName: value }).success).toBe(false);
    expect(diligenceCheckReadSchema.parse({ ...check, subjectName: 'Өндіруші — synthetic 🏭' }).subjectName).toContain(
      '🏭',
    );
  });
  it('publishes only checked date and enhanced status, refusing every Class C field', () => {
    const summary = { checkedOn: '2026-11-16', enhancedDone: true };
    expect(diligencePublicSummarySchema.parse(summary)).toEqual(summary);
    for (const field of [
      'result',
      'adataResult',
      'comment',
      'checks',
      'reportFileId',
      'enhancedComment',
      'enhancedReportFileId',
      'sourceSnapshotId',
      'overriddenBy',
    ])
      expect(diligencePublicSummarySchema.safeParse({ ...summary, [field]: 'synthetic-private' }).success).toBe(false);
  });
  it('supports retained legacy cards and a safe new public summary', () => {
    const legacy = { companyPhone: null, companyEmail: null, focalPoint: null };
    expect(companyCardDataSchema.parse(legacy)).toEqual(legacy);
    const diligence = { checkedOn: '2026-11-16', enhancedDone: false };
    expect(companyCardDataSchema.parse({ ...legacy, diligence }).diligence).toEqual(diligence);
    expect(companyCardDataSchema.safeParse({ ...legacy, diligence: { ...diligence, result: 'red' } }).success).toBe(
      false,
    );
  });
  it('requires a complete exact report pin for current downloads', () => {
    const pinned = { ...record, reportFileId: id, reportFileVersionId: organizationId, reportFileVersionNumber: 7 };
    expect(diligenceReadSchema.parse({ ...read, record: pinned }).record?.reportFileVersionNumber).toBe(7);
    for (const data of [
      { ...pinned, reportFileId: null },
      { ...pinned, reportFileVersionId: null },
      { ...pinned, reportFileVersionNumber: null },
      { ...pinned, reportFileVersionNumber: 0 },
      { ...record, enhancedReportFileId: id },
    ])
      expect(diligenceReadSchema.safeParse({ ...read, record: data }).success).toBe(false);
  });
  it('separates shown-only information from attention and rejects attention on other marks', () => {
    expect(diligenceCheckReadSchema.parse({ ...check, mark: 'shown_only', attention: false }).attention).toBe(false);
    expect(diligenceCheckReadSchema.parse({ ...check, mark: 'shown_only', attention: true }).attention).toBe(true);
    for (const row of [
      { ...check, attention: true },
      { ...check, mark: 'finding', attention: true },
      { ...check, mark: 'no_answer', adataValue: null, attention: true },
    ])
      expect(diligenceCheckReadSchema.safeParse(row).success).toBe(false);
  });
  it('keeps current source time/test provenance separate from a newer failed live run', () => {
    const lastRun = {
      attemptId: id,
      snapshotId: id,
      state: 'unavailable',
      requestedAt: '2026-11-17T06:03:42.000001Z',
      completedAt: '2026-11-17T06:03:42.000002Z',
      isTestData: false,
    };
    expect(diligenceReadSchema.parse({ ...read, lastRun }).record).toMatchObject({
      checkedAt: timestamp,
      sourceIsTestData: true,
    });
    expect(diligenceReadSchema.safeParse({ ...read, record: { ...record, sourceSnapshotId: null } }).success).toBe(
      false,
    );
    expect(
      diligenceReadSchema.parse({
        ...read,
        record: { ...record, sourceSnapshotId: null, checkedAt: null, sourceIsTestData: null },
      }).record?.checkedAt,
    ).toBeNull();
  });
  it('retains the full sealed history and exact historical download number without rewriting timestamps', () => {
    const stored = {
      profile_id: profileId,
      organization_id: organizationId,
      checked_on: '2026-11-16',
      adata_result: null,
      result: 'amber',
      comment: 'Synthetic original note',
      report_file_id: id,
      report_file_version_id: organizationId,
      overridden_by: id,
      overridden_at: '2026-11-16T06:03:42.123456+00:00',
      enhanced: 'not_done',
      enhanced_comment: null,
      enhanced_report_file_id: null,
      enhanced_report_file_version_id: null,
      source_snapshot_id: null,
      updated_at: '2026-11-16T06:03:42.123456+00:00',
    };
    const entry = {
      id,
      at: timestamp,
      actorId: id,
      actorName: 'Synthetic SME',
      action: 'due_diligence.override',
      diff: {
        operationId: profileId,
        actor: { type: 'user', id },
        before: { record: null, checks: [] },
        after: { record: stored, checks: [] },
      },
      reports: [{ fileId: id, versionId: organizationId, versionNumber: 1 }],
      sourceSnapshots: [],
    };
    expect(diligenceHistorySchema.parse([entry])).toEqual([entry]);
    expect(diligenceHistorySchema.parse([entry])[0]?.diff.after.record?.updated_at).toBe(stored.updated_at);
    expect(diligenceHistorySchema.parse([entry])[0]?.reports[0]?.versionNumber).toBe(1);
    for (const bad of [
      { ...entry, actorId: null },
      { ...entry, reports: [{ fileId: profileId, versionId: organizationId, versionNumber: 1 }] },
      { ...entry, reports: [entry.reports[0], entry.reports[0]] },
      { ...entry, diff: { ...entry.diff, before: { record: { ...stored, organization_id: id }, checks: [] } } },
      { ...entry, diff: { ...entry.diff, after: { record: { ...stored, report_file_version_id: null }, checks: [] } } },
    ])
      expect(diligenceHistorySchema.safeParse([bad]).success).toBe(false);
    const sourceSnapshots = [
      { snapshotId: id, checkedAt: timestamp, isTestData: true },
      { snapshotId: organizationId, checkedAt: '2026-11-17T06:03:42.000001Z', isTestData: false },
    ];
    const sourced = {
      ...entry,
      diff: {
        ...entry.diff,
        before: { record: { ...stored, source_snapshot_id: id }, checks: [] },
        after: { record: { ...stored, source_snapshot_id: organizationId }, checks: [] },
      },
      sourceSnapshots,
    };
    expect(diligenceHistorySchema.parse([sourced])[0]?.sourceSnapshots).toEqual(sourceSnapshots);
    for (const bad of [
      { ...sourced, sourceSnapshots: [] },
      { ...sourced, sourceSnapshots: sourceSnapshots.slice(0, 1) },
      { ...sourced, sourceSnapshots: [sourceSnapshots[0], sourceSnapshots[0]] },
      { ...sourced, sourceSnapshots: [sourceSnapshots[0], { ...sourceSnapshots[1], snapshotId: profileId }] },
      {
        ...sourced,
        sourceSnapshots: [{ ...sourceSnapshots[0], checkedAt: '2026-11-16T06:03:42.123Z' }, sourceSnapshots[1]],
      },
    ])
      expect(diligenceHistorySchema.safeParse([bad]).success).toBe(false);
  });
  it('distinguishes pending transport from every completed terminal state', () => {
    const waiting = {
      attemptId: id,
      snapshotId: null,
      state: 'waiting',
      requestedAt: timestamp,
      completedAt: null,
      isTestData: true,
    };
    expect(diligenceLastRunReadSchema.parse(waiting).completedAt).toBeNull();
    expect(diligenceLastRunReadSchema.safeParse({ ...waiting, snapshotId: id }).success).toBe(false);
    for (const state of [
      'received',
      'no_answer',
      'unavailable',
      'modules_not_connected',
      'not_configured',
      'quota_exhausted',
      'malformed',
    ]) {
      expect(diligenceLastRunReadSchema.safeParse({ ...waiting, state }).success).toBe(false);
      expect(diligenceLastRunReadSchema.parse({ ...waiting, state, completedAt: timestamp }).completedAt).toBe(
        timestamp,
      );
    }
  });
});

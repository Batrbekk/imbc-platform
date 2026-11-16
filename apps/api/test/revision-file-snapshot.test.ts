import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/database.module.js';
import { captureRevisionFileVersions, frozenRevisionFileVersion } from '../src/modules/files/revision-file-snapshot.js';

const ORG = '00000000-0000-4000-8000-000000000001';
const FILE = '00000000-0000-4000-8000-000000000002';
const REVISION = '00000000-0000-4000-8000-000000000003';
const VERSION = '00000000-0000-4000-8000-000000000004';
const input = { sectionRevisionId: REVISION, organizationId: ORG };
const captured = { fileObjectId: FILE, fileVersionId: VERSION, versionNumber: 2 };
const txWith = (...rows: unknown[][]) => {
  const execute = vi.fn();
  for (const result of rows) execute.mockResolvedValueOnce({ rows: result });
  return { tx: { execute } as unknown as Database, execute };
};

describe('revision file snapshot boundary prepared for 3в (GEN-09, DATA-07)', () => {
  it('captures the already passed latest version once when several owners reuse the file', async () => {
    const { tx } = txWith(
      [{ state: 'working', submittedAt: null }],
      [
        { fileObjectId: FILE, valid: true },
        { fileObjectId: FILE, valid: true },
      ],
      [{ id: FILE }],
      [{ ...captured, scanState: 'passed' }],
      [],
      [],
    );
    expect(await captureRevisionFileVersions(tx, input)).toEqual([captured]);
  });

  it.each(['pending', 'rejected'])(
    'latest %s prevents capture even if an earlier version passed',
    async (scanState) => {
      const { tx, execute } = txWith(
        [{ state: 'working', submittedAt: null }],
        [{ fileObjectId: FILE, valid: true }],
        [{ id: FILE }],
        [{ ...captured, scanState }],
      );
      await expect(captureRevisionFileVersions(tx, input)).rejects.toMatchObject({
        code: scanState === 'pending' ? 'file_pending_scan' : 'file_rejected',
      });
      expect(execute).toHaveBeenCalledTimes(4); // No deletion or insert of snapshot evidence.
    },
  );

  it('a purpose mismatch prevents capture rather than silently dropping the attachment', async () => {
    const { tx, execute } = txWith([{ state: 'working', submittedAt: null }], [{ fileObjectId: FILE, valid: false }]);
    await expect(captureRevisionFileVersions(tx, input)).rejects.toMatchObject({ code: 'validation' });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('a frozen revision cannot refresh its snapshot', async () => {
    const { tx, execute } = txWith([{ state: 'verified', submittedAt: new Date() }]);
    await expect(captureRevisionFileVersions(tx, input)).rejects.toMatchObject({ code: 'profile_locked' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('an empty working revision can remove a previous technical draft snapshot', async () => {
    const { tx, execute } = txWith([{ state: 'working', submittedAt: null }], [], []);
    expect(await captureRevisionFileVersions(tx, input)).toEqual([]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('a frozen DTO never falls back to latest when its snapshot or owner is missing', async () => {
    const missing = txWith([]);
    expect(await frozenRevisionFileVersion(missing.tx, { ...input, fileObjectId: FILE })).toBeNull();
    expect(missing.execute).toHaveBeenCalledTimes(1);
    expect(await frozenRevisionFileVersion(txWith([captured], []).tx, { ...input, fileObjectId: FILE })).toBeNull();
    expect(
      await frozenRevisionFileVersion(txWith([captured], [{ fileObjectId: FILE, valid: true }]).tx, {
        ...input,
        fileObjectId: FILE,
      }),
    ).toEqual(captured);
  });
});

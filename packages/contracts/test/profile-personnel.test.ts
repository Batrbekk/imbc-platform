import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { personnelReadSchema, personnelWriteSchema, type PersonnelWrite } from '../src/profile-personnel.js';

const draft = (): PersonnelWrite => ({
  managersCount: null,
  engineersCount: null,
  productionWorkersCount: null,
  nonresidentCount: null,
  organisationChartIds: [],
  cvFileIds: [],
});
const complete = (): PersonnelWrite => ({
  ...draft(),
  managersCount: 2,
  engineersCount: 3,
  productionWorkersCount: 5,
  nonresidentCount: 7,
});

describe('MAN-17–20 personnel draft contracts', () => {
  it('accepts null partial fields, including no files, and never guesses missing categories', () => {
    expect(personnelWriteSchema.parse(draft())).toEqual(draft());
    expect(personnelWriteSchema.parse({ ...draft(), managersCount: 2, nonresidentCount: 10 })).toMatchObject({
      managersCount: 2,
      engineersCount: null,
      productionWorkersCount: null,
      nonresidentCount: 10,
    });
  });

  it('accepts zero for all four counts, with nonresidents a subset rather than an extra category', () => {
    expect(
      personnelWriteSchema.safeParse({
        ...draft(),
        managersCount: 0,
        engineersCount: 0,
        productionWorkersCount: 0,
        nonresidentCount: 0,
      }).success,
    ).toBe(true);
    expect(personnelWriteSchema.parse(complete()).nonresidentCount).toBe(7);
  });

  it.each([-1, 0.5, 2_147_483_648, Number.NaN, Number.POSITIVE_INFINITY, '10'])(
    'rejects invalid category count %s',
    (value) => {
      expect(personnelWriteSchema.safeParse({ ...complete(), managersCount: value }).success).toBe(false);
    },
  );

  it('rejects a nonresident count above the known total with a field-level code', () => {
    const result = personnelWriteSchema.safeParse({ ...complete(), nonresidentCount: 11 });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({
          path: ['nonresidentCount'],
          message: 'nonresident_exceeds_total',
        }),
      );
  });

  it('rejects writable totals, residency scores, source values and arbitrary additional fields', () => {
    for (const extra of [{ totalHeadcount: 10 }, { residencyScore: 100 }, { adataHeadcount: 10 }, { confirmed: true }])
      expect(personnelWriteSchema.safeParse({ ...complete(), ...extra }).success).toBe(false);
  });

  it('supports multiple charts and optional CVs without a business cap of 50 files', () => {
    const input = {
      ...complete(),
      organisationChartIds: Array.from({ length: 75 }, () => randomUUID()),
      cvFileIds: Array.from({ length: 75 }, () => randomUUID()),
    };
    expect(personnelWriteSchema.parse(input)).toEqual(input);
  });

  it('rejects repeated stable IDs within or across lists, preserving the offending path', () => {
    const id = randomUUID();
    for (const input of [
      { ...complete(), organisationChartIds: [id, id] },
      { ...complete(), organisationChartIds: [id, id.toUpperCase()] },
      { ...complete(), organisationChartIds: [id], cvFileIds: [id] },
    ]) {
      const result = personnelWriteSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues[0]?.message).toBe('duplicate_file');
    }
  });

  it('normalizes UUID spelling before file binding and normalized no-op comparison', () => {
    const id = randomUUID();
    expect(
      personnelWriteSchema.parse({ ...complete(), organisationChartIds: [id.toUpperCase()] }).organisationChartIds,
    ).toEqual([id]);
  });

  it('the read DTO can represent a missing frozen file snapshot without borrowing latest metadata', () => {
    const id = randomUUID();
    const read = {
      editable: { ...complete(), organisationChartIds: [id] },
      totalHeadcount: 10,
      organisationCharts: [
        {
          fileId: id,
          versionId: null,
          versionNumber: null,
          originalName: null,
          byteSize: null,
          mediaType: null,
          scanState: null,
          rejectionReason: null,
          uploadedAt: null,
          canDownload: false,
        },
      ],
      cvs: [],
    };
    expect(personnelReadSchema.parse(read)).toEqual(read);
    expect(personnelReadSchema.safeParse({ ...read, storageKey: 'private-storage-key' }).success).toBe(false);
  });

  it('read total supports the sum of three PostgreSQL integers without signed-32-bit overflow', () => {
    const input = {
      ...draft(),
      managersCount: 2_147_483_647,
      engineersCount: 2_147_483_647,
      productionWorkersCount: 2_147_483_647,
      nonresidentCount: 2_147_483_647,
    };
    expect(
      personnelReadSchema.parse({ editable: input, totalHeadcount: 6_442_450_941, organisationCharts: [], cvs: [] })
        .totalHeadcount,
    ).toBe(6_442_450_941);
  });
});

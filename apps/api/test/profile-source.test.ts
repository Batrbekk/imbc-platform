import { describe, expect, it } from 'vitest';
import { extractPrefill } from '../src/modules/adata/company-info.js';

describe('MAN-10 / MAN-21 complete retained legal lists', () => {
  it('reads all OKED and founders for the profile without changing the legacy worker limit', () => {
    const data = {
      basic: {
        okeds: Array.from({ length: 75 }, (_, index) => ({
          i: String(index).padStart(5, '0'),
          name_ru: `Activity ${index}`,
        })),
      },
      founders: { founders_dtl: Array.from({ length: 65 }, (_, index) => ({ name: `Founder ${index}` })) },
    };
    expect(extractPrefill(data).filter((row) => row.field === 'activity')).toHaveLength(50);
    const complete = extractPrefill(data, { completeLegalLists: true });
    expect(complete.filter((row) => row.field === 'activity')).toHaveLength(75);
    expect(complete.filter((row) => row.field === 'shareholders')).toHaveLength(65);
    expect(complete.find((row) => row.field === 'activity')).toMatchObject({ value: '00000', label: 'Activity 0' });
  });
});

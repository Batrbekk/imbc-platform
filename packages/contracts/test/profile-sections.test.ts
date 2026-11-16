import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  COMPLETENESS_SECTIONS,
  displayCompleteness,
  profileCompleteness,
  SECTION_KINDS,
  sectionCompleteness,
  sectionSaveInputSchema,
} from '../src/profile-sections.js';

describe('MAN-41 applicable completeness', () => {
  it('uses exactly seven section kinds and six equal profile weights', () => {
    expect(SECTION_KINDS).toHaveLength(7);
    expect(SECTION_KINDS).not.toContain('shareholders');
    expect(COMPLETENESS_SECTIONS).toHaveLength(6);
    expect(COMPLETENESS_SECTIONS).not.toContain('production');
  });

  it('a section without applicable mandatory inputs is complete', () => {
    expect(sectionCompleteness([])).toEqual({ percent: 100, missing: [] });
  });

  it('keeps missing field paths and arithmetic precision', () => {
    const completeness = sectionCompleteness([
      { path: 'sites.0.address', code: 'site_address_required', satisfied: true },
      { path: 'sites.0.city', code: 'site_city_required', satisfied: true },
      { path: 'sites.0.regionId', code: 'site_region_required', satisfied: false },
    ]);
    expect(completeness.percent).toBeCloseTo(200 / 3, 12);
    expect(completeness.missing).toEqual([{ path: 'sites.0.regionId', code: 'site_region_required' }]);
    expect(displayCompleteness(completeness.percent)).toBe(66);
  });

  it('unavailable sections contribute zero even if passed an empty applicable-input list', () => {
    const sections = SECTION_KINDS.map((kind) => ({
      kind,
      available: kind === 'main_information' || kind === 'contacts',
      completeness: sectionCompleteness([]),
    }));
    expect(profileCompleteness(sections)).toBeCloseTo(100 / 3, 12);
    expect(displayCompleteness(profileCompleteness(sections))).toBe(33);
  });

  it('production cannot lower or raise the six-section profile average', () => {
    const sections = SECTION_KINDS.map((kind) => ({
      kind,
      available: true,
      completeness: { percent: kind === 'production' ? 0 : 100, missing: [] },
    }));
    expect(profileCompleteness(sections)).toBe(100);
    sections.find((section) => section.kind === 'production')!.completeness.percent = 100;
    expect(profileCompleteness(sections)).toBe(100);
  });

  it('one incomplete mandatory input never displays a rounded 100', () => {
    const inputs = Array.from({ length: 10001 }, (_, i) => ({
      path: `contacts.${i}.fullName`,
      code: 'required',
      satisfied: i > 0,
    }));
    expect(displayCompleteness(sectionCompleteness(inputs).percent)).toBe(99);
  });
});

describe('GEN-11 strict section save envelope', () => {
  const schema = sectionSaveInputSchema(z.strictObject({ value: z.string() }));

  it('keeps data types while rejecting profile selectors and metadata from the body', () => {
    expect(schema.parse({ editVersion: 0, data: { value: 'partial draft' } })).toEqual({
      editVersion: 0,
      data: { value: 'partial draft' },
    });
    expect(schema.safeParse({ editVersion: 0, profileId: 'another profile', data: { value: 'text' } }).success).toBe(
      false,
    );
    expect(schema.safeParse({ editVersion: 0, data: { value: 'text', confirmed: true } }).success).toBe(false);
  });

  it.each([-1, 0.5, '1', null])('rejects invalid optimistic version %s', (editVersion) => {
    expect(schema.safeParse({ editVersion, data: { value: '' } }).success).toBe(false);
  });
});

import { z } from 'zod';
import { PROFILE_STATUSES } from './enums.js';

/** Seven sections in specification v1.4 / DBML (MAN-21, MAN-41). */
export const SECTION_KINDS = [
  'main_information',
  'contacts',
  'personnel',
  'products',
  'production',
  'certificates',
  'documents',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** The optional production section is excluded from the profile average (MAN-41). */
export const COMPLETENESS_SECTIONS = [
  'main_information',
  'contacts',
  'personnel',
  'products',
  'certificates',
  'documents',
] as const satisfies readonly SectionKind[];

export const REVISION_ORIGINS = ['manufacturer', 'migration', 'source_refresh'] as const;
export type RevisionOrigin = (typeof REVISION_ORIGINS)[number];

export const SECTION_REVISION_STATES = ['working', 'submitted', 'verified', 'rejected'] as const;
export type SectionRevisionState = (typeof SECTION_REVISION_STATES)[number];

/** Stable section errors; field validation uses errors[].path and errors[].code (MAN-40). */
export const SECTION_ERROR_CODES = [
  'profile_locked',
  'section_changed',
  'section_unavailable',
  'request_too_large',
] as const;

export const missingInputSchema = z.strictObject({ path: z.string(), code: z.string() });
export type MissingInput = z.infer<typeof missingInputSchema>;

export interface CompletenessInput extends MissingInput {
  satisfied: boolean;
}

export const sectionCompletenessSchema = z.strictObject({
  /** Preserve arithmetic precision; only the displayed percentage is rounded (MAN-41). */
  percent: z.number().min(0).max(100),
  missing: z.array(missingInputSchema),
});
export type SectionCompleteness = z.infer<typeof sectionCompletenessSchema>;

export const sectionOverviewSchema = z.strictObject({
  kind: z.enum(SECTION_KINDS),
  available: z.boolean(),
  profileStatus: z.enum(PROFILE_STATUSES),
  revisionId: z.uuid().nullable(),
  revisionState: z.enum(SECTION_REVISION_STATES).nullable(),
  revisionOrigin: z.enum(REVISION_ORIGINS).nullable(),
  editVersion: z.number().int().nonnegative(),
  savedAt: z.iso.datetime().nullable(),
  readOnly: z.boolean(),
  /** An unsubmitted working copy is distinct from pending_revision_id (MAN-45). */
  hasWorkingChanges: z.boolean(),
  completeness: sectionCompletenessSchema,
});
export type SectionOverview = z.infer<typeof sectionOverviewSchema>;

export const ownSectionsOverviewSchema = z.strictObject({
  profileId: z.uuid(),
  profileStatus: z.enum(PROFILE_STATUSES),
  readOnly: z.boolean(),
  hasPendingChanges: z.boolean(),
  completenessPct: z.number().min(0).max(100),
  sections: z.array(sectionOverviewSchema).length(SECTION_KINDS.length),
});
export type OwnSectionsOverview = z.infer<typeof ownSectionsOverviewSchema>;

/** Typed concrete read/write schemas are supplied by each section (GEN-11). */
export function sectionReadSchema<T extends z.ZodType>(data: T) {
  return sectionOverviewSchema.extend({
    available: z.literal(true),
    revisionId: z.uuid(),
    revisionState: z.enum(SECTION_REVISION_STATES),
    revisionOrigin: z.enum(REVISION_ORIGINS),
    data,
  });
}
export type SectionRead<Data> = Omit<
  SectionOverview,
  'available' | 'revisionId' | 'revisionState' | 'revisionOrigin'
> & {
  available: true;
  revisionId: string;
  revisionState: SectionRevisionState;
  revisionOrigin: RevisionOrigin;
  data: Data;
};

export function sectionSaveInputSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ editVersion: z.number().int().nonnegative(), data });
}
export interface SectionSaveInput<Data> {
  editVersion: number;
  data: Data;
}

/** The core validates the envelope before a handler validates its strict data shape. */
export const unknownSectionSaveInputSchema = sectionSaveInputSchema(z.unknown());

/** Source-owned legal fields are never included in this list (MAN-41). */
export function sectionCompleteness(inputs: readonly CompletenessInput[]): SectionCompleteness {
  const missing = inputs.filter((input) => !input.satisfied).map(({ path, code }) => ({ path, code }));
  return {
    percent: inputs.length === 0 ? 100 : ((inputs.length - missing.length) / inputs.length) * 100,
    missing,
  };
}

/** Six equal weights; a not-yet-implemented required section contributes zero, not 100. */
export function profileCompleteness(
  sections: readonly Pick<SectionOverview, 'kind' | 'available' | 'completeness'>[],
): number {
  return (
    COMPLETENESS_SECTIONS.reduce((sum, kind) => {
      const section = sections.find((item) => item.kind === kind);
      return sum + (section?.available ? section.completeness.percent : 0);
    }, 0) / COMPLETENESS_SECTIONS.length
  );
}

/** MAN-41: an incomplete mandatory input must never be rounded up to a displayed 100. */
export function displayCompleteness(percent: number): number {
  return Math.floor(Math.max(0, Math.min(100, percent)));
}

import type { CompletenessInput, SectionKind } from '@imbc/contracts';
import type { Database } from '../../database/database.module.js';
import type { z } from 'zod';

/** GEN-11: supplied by the locked own-profile lookup, never copied from an HTTP body. */
export interface SectionContext {
  profileId: string;
  organizationId: string;
  sectionId: string;
  revisionId: string;
}

/** Registration order does not affect the seven-section overview (MAN-21, MAN-41). */
export const PROFILE_SECTION_HANDLERS = Symbol('PROFILE_SECTION_HANDLERS');

/**
 * MAN-40: parse returns the normalized strict write shape. editable returns that same shape,
 * so the core can identify a no-op before creating a working revision. read may additionally
 * include read-only source values. Handlers never commit their own transaction.
 */
export interface TypedSectionHandler<Write, Read> {
  readonly kind: SectionKind;
  readonly readSchema: z.ZodType<Read>;
  parse(input: unknown): Write;
  editable(tx: Database, context: SectionContext): Promise<Write>;
  /** An explicit clear of a first-read source prefill must be saved, even when persisted values are blank. */
  hasUnsavedPrefill?(tx: Database, context: SectionContext): Promise<boolean>;
  read(tx: Database, context: SectionContext): Promise<Read>;
  save(tx: Database, context: SectionContext, normalized: Write): Promise<void>;
  mandatoryInputs(tx: Database, context: SectionContext): Promise<CompletenessInput[]>;
}

export type SectionHandler = TypedSectionHandler<unknown, unknown>;

/** Erases data types only at the registry boundary; parse and save always belong to one handler. */
export function defineSectionHandler<Write, Read>(handler: TypedSectionHandler<Write, Read>): SectionHandler {
  return {
    kind: handler.kind,
    readSchema: handler.readSchema,
    parse: (input) => handler.parse(input),
    editable: (tx, context) => handler.editable(tx, context),
    hasUnsavedPrefill: handler.hasUnsavedPrefill ? (tx, context) => handler.hasUnsavedPrefill!(tx, context) : undefined,
    read: (tx, context) => handler.read(tx, context),
    save: (tx, context, normalized) => handler.save(tx, context, normalized as Write),
    mandatoryInputs: (tx, context) => handler.mandatoryInputs(tx, context),
  };
}

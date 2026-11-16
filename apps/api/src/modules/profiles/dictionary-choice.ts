import { and, eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { dictionary, dictionaryEntry } from '../../database/schema/index.js';
import { sectionFieldError } from './section-errors.js';

/**
 * DATA-04: an existing retired choice can be kept, but cannot be newly selected. The shared lock
 * keeps retirement/deletion from racing this save. Empty choices remain valid partial drafts.
 */
export async function assertDictionaryChoice(
  tx: Database,
  choice: { id: string | null; dictionaryCode: string; path: string; retainedIds?: ReadonlySet<string> },
): Promise<void> {
  if (choice.id === null) return;
  const [entry] = await tx
    .select({ id: dictionaryEntry.id, retiredAt: dictionaryEntry.retiredAt })
    .from(dictionaryEntry)
    .innerJoin(dictionary, eq(dictionary.id, dictionaryEntry.dictionaryId))
    .where(and(eq(dictionaryEntry.id, choice.id), eq(dictionary.code, choice.dictionaryCode)))
    .for('share', { of: dictionaryEntry });
  if (!entry) throw sectionFieldError(choice.path, 'reference_invalid');
  if (entry.retiredAt !== null && !choice.retainedIds?.has(entry.id))
    throw sectionFieldError(choice.path, 'reference_retired');
}

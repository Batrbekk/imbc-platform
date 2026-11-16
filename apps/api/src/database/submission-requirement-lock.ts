import { sql } from 'drizzle-orm';
import type { Database } from './database.module.js';

/** Must precede dictionary-entry/parent locks in both Send and administrator mutations (0021). */
export async function lockSubmissionRequirementDictionary(tx: Database): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(2146711107,3)`);
}

import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import * as schema from '../src/database/schema/index.js';
import { mainContactOwnership, mainSiteOwnership } from '../src/database/schema/main-source-ownership.js';
import { migrateThrough, resetDatabase } from './support/database.js';

const url = process.env.EONDIRIS_TEST_DATABASE_URL;
describe.skipIf(!url)('0026 historical unknown ownership expansion', () => {
  it('adds unknown technical provenance to old working/frozen rows without adopting legacy NULL or rewriting facts', async () => {
    const target = new URL(url!);
    if (target.hostname !== '127.0.0.1' || target.port !== '55435' || target.pathname !== '/imbc_eondiris_test')
      throw new Error('Isolated source DB required');
    const pool = new pg.Pool({ connectionString: url });
    try {
      await resetDatabase(pool);
      await migrateThrough(pool, '0025_stage6b_lps');
      const db = drizzle(pool, { schema, casing: 'snake_case' });
      const [org] = await db
        .insert(schema.organizations)
        .values({ type: 'manufacturer', name: 'Legacy synthetic company', bin: '000000000000' })
        .returning();
      const [profile] = await db.insert(schema.manufacturerProfiles).values({ organizationId: org!.id }).returning();
      const main = (
        await pool.query<{ id: string; section_revision_id: string }>(
          'select id,section_revision_id from main_information where organization_id=$1',
          [org!.id],
        )
      ).rows[0]!;
      const identity = randomUUID();
      await db
        .insert(schema.productionSiteIdentity)
        .values({ id: identity, profileId: profile!.id, organizationId: org!.id });
      await db
        .insert(schema.productionSite)
        .values({
          mainInformationId: main.id,
          organizationId: org!.id,
          identityId: identity,
          address: 'Legacy edited factory',
          city: 'Legacy city',
        });
      await pool.query(
        "update main_information set company_phone=NULL,contact_email='legacy@synthetic.local',legal_name='Legacy source spelling' where id=$1",
        [main.id],
      );
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("update section_revision set state='submitted',submitted_at=now() where id=$1", [
          main.section_revision_id,
        ]);
        await client.query("update section_revision set state='verified' where id=$1", [main.section_revision_id]);
        await client.query(
          'update profile_section set working_revision_id=NULL,verified_revision_id=$1 where working_revision_id=$1',
          [main.section_revision_id],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const before = (await pool.query('select * from main_information where id=$1', [main.id])).rows[0];
      await migrateThrough(pool, '0026_stage4b_main_source_ownership');
      expect((await pool.query('select * from main_information where id=$1', [main.id])).rows[0]).toEqual(before);
      expect(
        (await db.select().from(mainContactOwnership).where(eq(mainContactOwnership.mainInformationId, main.id))).map(
          (owner) => [owner.field, owner.owner, owner.value],
        ),
      ).toEqual([
        ['companyPhone', 'legacy_unknown', null],
        ['contactEmail', 'legacy_unknown', 'legacy@synthetic.local'],
      ]);
      expect(
        (await db.select().from(mainSiteOwnership).where(eq(mainSiteOwnership.mainInformationId, main.id)))[0],
      ).toMatchObject({ addressOwner: 'legacy_unknown', cityOwner: 'legacy_unknown', regionOwner: 'legacy_unknown' });
      await expect(
        pool.query("update main_contact_ownership set owner='manufacturer' where main_information_id=$1", [main.id]),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await pool.end();
    }
  }, 60000);
});

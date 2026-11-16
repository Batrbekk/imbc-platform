import { randomUUID } from 'node:crypto';
import { SECTION_KINDS, type SectionKind } from '@imbc/contracts';
import { drizzle } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../src/database/schema/index.js';
import {
  selectProfilePublicationSubset,
  validateProfileRevisionGraph,
  type ExactProfileRevisionMap,
  type VerifiedProfileRevisionMap,
} from '../src/modules/profiles/profile-publication-graph.js';
import { copyRevisionContent } from '../src/modules/profiles/revision-copy.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { seedProfileGraph, type ProfileGraph } from './support/profile-graph.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'exact revision graph and dependency-consistent publication subset',
  () => {
    vi.setConfig({ hookTimeout: 60000, testTimeout: 30000 });
    let pool: pg.Pool;
    const exact = (g: ProfileGraph) =>
      Object.fromEntries(SECTION_KINDS.map((kind) => [kind, g.revisions[kind]!])) as ExactProfileRevisionMap;
    const scope = (g: ProfileGraph) => ({ profileId: g.profile, organizationId: g.org });
    const tx = async <T>(run: (client: pg.PoolClient) => Promise<T>) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await run(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    };
    const base = async () => {
      const g = await seedProfileGraph(pool);
      await tx(async (client) => {
        await client.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [g.profile]);
        await client.query(
          "UPDATE section_revision SET state='submitted',submitted_at=now() WHERE organization_id=$1",
          [g.org],
        );
        await client.query("UPDATE section_revision SET state='verified' WHERE organization_id=$1", [g.org]);
        await client.query(
          'UPDATE profile_section s SET verified_revision_id=r.id FROM section_revision r WHERE r.profile_section_id=s.id AND s.profile_id=$1',
          [g.profile],
        );
      });
      return g;
    };
    const copies = async (g: ProfileGraph, kinds: readonly SectionKind[] = SECTION_KINDS) =>
      tx(async (client) => {
        const result = { ...exact(g) };
        const sections = (
          await client.query<{ id: string; kind: SectionKind }>(
            'SELECT id,kind FROM profile_section WHERE profile_id=$1',
            [g.profile],
          )
        ).rows;
        for (const kind of kinds) {
          const s = sections.find((section) => section.kind === kind)!;
          const revision = (
            await client.query<{ id: string }>(
              'INSERT INTO section_revision (profile_section_id,organization_id,revision_number) VALUES ($1,$2,2) RETURNING id',
              [s.id, g.org],
            )
          ).rows[0]!.id;
          await copyRevisionContent(drizzle(client, { schema }), kind, g.revisions[kind]!, revision, g.org);
          await client.query('UPDATE profile_section SET working_revision_id=$1 WHERE id=$2', [revision, s.id]);
          result[kind] = revision;
        }
        return result;
      });
    const freeze = async (g: ProfileGraph, revisions: ExactProfileRevisionMap) =>
      tx(async (client) => {
        await client.query(
          'UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1 AND working_revision_id=ANY($2::uuid[])',
          [g.profile, Object.values(revisions)],
        );
        await client.query(
          "UPDATE section_revision SET state='submitted',submitted_at=now() WHERE id=ANY($1::uuid[]) AND state='working'",
          [Object.values(revisions)],
        );
      });
    const validate = (g: ProfileGraph, revisions: ExactProfileRevisionMap) =>
      validateProfileRevisionGraph(drizzle(pool, { schema }), { ...scope(g), revisions });
    const choose = (
      g: ProfileGraph,
      candidates: ExactProfileRevisionMap,
      acceptedKinds: readonly SectionKind[],
      verified: VerifiedProfileRevisionMap = exact(g),
    ) =>
      selectProfilePublicationSubset(drizzle(pool, { schema }), { ...scope(g), candidates, verified, acceptedKinds });
    const product = async (revision: string) =>
      (
        await pool.query<{ id: string; identity_id: string }>(
          'SELECT id,identity_id FROM product_line WHERE section_revision_id=$1 ORDER BY position_in_list,id',
          [revision],
        )
      ).rows[0]!;
    const siteSwap = async (g: ProfileGraph, candidates: ExactProfileRevisionMap) => {
      const identity = (
        await pool.query<{ id: string }>(
          'INSERT INTO production_site_identity (profile_id,organization_id) VALUES ($1,$2) RETURNING id',
          [g.profile, g.org],
        )
      ).rows[0]!.id;
      const main = (
        await pool.query<{ id: string }>('SELECT id FROM main_information WHERE section_revision_id=$1', [
          candidates.main_information,
        ])
      ).rows[0]!.id;
      await pool.query('DELETE FROM production_site WHERE main_information_id=$1', [main]);
      await pool.query(
        'INSERT INTO production_site (main_information_id,organization_id,identity_id) VALUES ($1,$2,$3)',
        [main, g.org, identity],
      );
      await pool.query('UPDATE product_line SET production_site_identity_id=$1 WHERE section_revision_id=$2', [
        identity,
        candidates.products,
      ]);
    };
    const unlinkCertificates = async (candidates: ExactProfileRevisionMap) => {
      await pool.query('UPDATE certificate SET "group"=\'company\' WHERE section_revision_id=$1', [
        candidates.certificates,
      ]);
      await pool.query(
        'DELETE FROM product_line_certificate WHERE product_line_id IN (SELECT id FROM product_line WHERE section_revision_id=$1)',
        [candidates.products],
      );
    };

    beforeAll(async () => {
      pool = openTestPool();
      await resetDatabase(pool);
      await migrateThrough(pool);
    });
    afterAll(async () => {
      await pool?.end();
    });

    it('validates seven exact scoped revisions, optional partial equipment and held product certificate links', async () => {
      const g = await base();
      expect(await validate(g, exact(g))).toEqual({ valid: true, issues: [] });
      const candidates = await copies(g, ['production']);
      await pool.query(
        'UPDATE equipment_item SET name=NULL,equipment_type_id=NULL,quantity=NULL WHERE section_revision_id=$1',
        [candidates.production],
      );
      expect(await validate(g, candidates)).toEqual({ valid: true, issues: [] });
      await pool.query(
        'DELETE FROM equipment_product_line WHERE equipment_item_id IN (SELECT id FROM equipment_item WHERE section_revision_id=$1)',
        [candidates.production],
      );
      expect((await validate(g, candidates)).valid).toBe(true);
    });
    it('rejects missing, extra, wrong-kind and foreign revision IDs without resolving another snapshot', async () => {
      const g = await base();
      const other = await base();
      for (const revisions of [
        { ...exact(g), contacts: undefined },
        { ...exact(g), extra: randomUUID() },
        { ...exact(g), contacts: g.revisions.documents },
        { ...exact(g), documents: other.revisions.documents },
      ])
        expect(await validate(g, revisions as unknown as ExactProfileRevisionMap)).toMatchObject({
          valid: false,
          issues: [expect.objectContaining({ code: 'revision_scope_invalid' })],
        });
    });
    it('requires a site row in exact Main, not merely an own stable site identity', async () => {
      const g = await base();
      const candidates = await copies(g, ['products']);
      const unused = (
        await pool.query<{ id: string }>(
          'INSERT INTO production_site_identity (profile_id,organization_id) VALUES ($1,$2) RETURNING id',
          [g.profile, g.org],
        )
      ).rows[0]!.id;
      await pool.query('UPDATE product_line SET production_site_identity_id=$1 WHERE section_revision_id=$2', [
        unused,
        candidates.products,
      ]);
      expect(await validate(g, candidates)).toMatchObject({
        valid: false,
        issues: [{ kind: 'products', path: 'products.0.productionSiteIdentityId', code: 'site_not_in_revision_graph' }],
      });
    });
    it('requires a held product certificate row in exact Certificates, not an identity alone', async () => {
      const g = await base();
      const candidates = await copies(g, ['products']);
      const unused = (
        await pool.query<{ id: string }>(
          'INSERT INTO certificate_identity (profile_id,organization_id) VALUES ($1,$2) RETURNING id',
          [g.profile, g.org],
        )
      ).rows[0]!.id;
      await pool.query(
        'INSERT INTO product_line_certificate (product_line_id,organization_id,certificate_identity_id) VALUES ($1,$2,$3)',
        [(await product(candidates.products)).id, g.org, unused],
      );
      expect(await validate(g, candidates)).toMatchObject({
        valid: false,
        issues: [
          { kind: 'products', path: 'products.0.certificateIdentityIds', code: 'certificate_not_in_revision_graph' },
        ],
      });
    });
    it.each(['company', 'other', 'absence'])('excludes %s certificate from product links', async (kind) => {
      const g = await base();
      const candidates = await copies(g, ['certificates']);
      if (kind === 'absence')
        await pool.query('UPDATE certificate SET not_held=true,file_object_id=NULL WHERE section_revision_id=$1', [
          candidates.certificates,
        ]);
      else
        await pool.query('UPDATE certificate SET "group"=$1 WHERE section_revision_id=$2', [
          kind,
          candidates.certificates,
        ]);
      expect((await validate(g, candidates)).issues).toContainEqual({
        kind: 'products',
        path: 'products.0.certificateIdentityIds',
        code: 'certificate_not_in_revision_graph',
      });
    });
    it('requires equipment target products in exact Products despite an own persisted identity', async () => {
      const g = await base();
      const candidates = await copies(g, ['production']);
      const unused = (
        await pool.query<{ id: string }>(
          'INSERT INTO product_line_identity (profile_id,organization_id) VALUES ($1,$2) RETURNING id',
          [g.profile, g.org],
        )
      ).rows[0]!.id;
      const equipment = (
        await pool.query<{ id: string }>('SELECT id FROM equipment_item WHERE section_revision_id=$1', [
          candidates.production,
        ])
      ).rows[0]!.id;
      await pool.query(
        'INSERT INTO equipment_product_line (equipment_item_id,organization_id,product_line_identity_id) VALUES ($1,$2,$3)',
        [equipment, g.org, unused],
      );
      expect(await validate(g, candidates)).toMatchObject({
        valid: false,
        issues: [{ kind: 'production', path: 'equipment.0.productIdentityIds', code: 'product_not_in_revision_graph' }],
      });
    });
    it('keeps historical graph exact after newer working Main/Certificates become incompatible', async () => {
      const g = await base();
      const candidates = await copies(g, ['main_information', 'certificates']);
      await pool.query(
        'DELETE FROM production_site WHERE main_information_id IN (SELECT id FROM main_information WHERE section_revision_id=$1)',
        [candidates.main_information],
      );
      await pool.query('UPDATE certificate SET "group"=\'company\' WHERE section_revision_id=$1', [
        candidates.certificates,
      ]);
      expect((await validate(g, candidates)).valid).toBe(false);
      expect(await validate(g, exact(g))).toEqual({ valid: true, issues: [] });
    });
    it('defers accepted Main site removal when Products is rejected, while publishing independent Contacts', async () => {
      const g = await base();
      const candidates = await copies(g);
      await siteSwap(g, candidates);
      await freeze(g, candidates);
      expect((await validate(g, candidates)).valid).toBe(true);
      const result = await choose(g, candidates, ['main_information', 'contacts']);
      expect(result).toMatchObject({ publishKinds: ['contacts'], retainKinds: ['main_information'], issues: [] });
      expect(result.revisions).toEqual({ ...exact(g), contacts: candidates.contacts });
    });
    it('defers accepted certificate conversion when Products unlink is rejected', async () => {
      const g = await base();
      const candidates = await copies(g);
      await unlinkCertificates(candidates);
      await freeze(g, candidates);
      const result = await choose(g, candidates, ['certificates', 'contacts']);
      expect(result).toMatchObject({ publishKinds: ['contacts'], retainKinds: ['certificates'], issues: [] });
      expect(result.revisions!.certificates).toBe(g.revisions.certificates);
    });
    it('publishes coupled accepted Main+Products jointly without greedy order dependence', async () => {
      const g = await base();
      const candidates = await copies(g);
      await siteSwap(g, candidates);
      await freeze(g, candidates);
      expect((await choose(g, candidates, ['main_information'])).publishKinds).toEqual([]);
      expect((await choose(g, candidates, ['products'])).publishKinds).toEqual([]);
      for (const accepted of [
        ['products', 'main_information'],
        ['main_information', 'products'],
      ] as const) {
        const result = await choose(g, candidates, accepted);
        expect(result).toMatchObject({ publishKinds: ['main_information', 'products'], retainKinds: [], issues: [] });
        expect(result.revisions).toEqual({
          ...exact(g),
          main_information: candidates.main_information,
          products: candidates.products,
        });
      }
    });
    it('publishes coupled certificate conversion and product unlink together', async () => {
      const g = await base();
      const candidates = await copies(g);
      await unlinkCertificates(candidates);
      await freeze(g, candidates);
      const result = await choose(g, candidates, ['certificates', 'products']);
      expect(result).toMatchObject({ publishKinds: ['products', 'certificates'], retainKinds: [] });
      expect((await validate(g, result.revisions!)).valid).toBe(true);
    });
    it('publishes product replacement and equipment relinking jointly and preserves both rejected dependencies', async () => {
      const g = await base();
      const candidates = await copies(g);
      const previous = await product(candidates.products);
      const nextIdentity = (
        await pool.query<{ id: string }>(
          'INSERT INTO product_line_identity (profile_id,organization_id) VALUES ($1,$2) RETURNING id',
          [g.profile, g.org],
        )
      ).rows[0]!.id;
      await pool.query('DELETE FROM product_line_certificate WHERE product_line_id=$1', [previous.id]);
      await pool.query('DELETE FROM product_line_kpved WHERE product_line_id=$1', [previous.id]);
      await pool.query('DELETE FROM product_line WHERE id=$1', [previous.id]);
      await pool.query('INSERT INTO product_line (section_revision_id,organization_id,identity_id) VALUES ($1,$2,$3)', [
        candidates.products,
        g.org,
        nextIdentity,
      ]);
      await pool.query(
        'UPDATE equipment_product_line SET product_line_identity_id=$1 WHERE equipment_item_id IN (SELECT id FROM equipment_item WHERE section_revision_id=$2)',
        [nextIdentity, candidates.production],
      );
      await freeze(g, candidates);
      expect((await validate(g, candidates)).valid).toBe(true);
      expect(await choose(g, candidates, ['products'])).toMatchObject({ publishKinds: [], retainKinds: ['products'] });
      expect(await choose(g, candidates, ['production'])).toMatchObject({
        publishKinds: [],
        retainKinds: ['production'],
      });
      expect(await choose(g, candidates, ['production', 'products'])).toMatchObject({
        publishKinds: ['products', 'production'],
        retainKinds: [],
      });
    });
    it('publishes initial profile only with all seven accepted coherent sections, retaining Returned partial acceptance', async () => {
      const g = await base();
      const candidates = await copies(g);
      await freeze(g, candidates);
      const absent = Object.fromEntries(SECTION_KINDS.map((kind) => [kind, null])) as VerifiedProfileRevisionMap;
      expect(await choose(g, candidates, ['contacts', 'certificates'], absent)).toEqual({
        publishKinds: [],
        retainKinds: ['contacts', 'certificates'],
        revisions: null,
        issues: [],
      });
      expect(await choose(g, candidates, SECTION_KINDS, absent)).toEqual({
        publishKinds: [...SECTION_KINDS],
        retainKinds: [],
        revisions: candidates,
        issues: [],
      });
      expect((await choose(g, candidates, ['contacts'], { ...exact(g), documents: null })).revisions).toBeNull();
    });
    it('rejects incoherent initial all-accepted graph and a foreign old baseline', async () => {
      const g = await base();
      const other = await base();
      const candidates = await copies(g);
      await pool.query(
        'DELETE FROM production_site WHERE main_information_id IN (SELECT id FROM main_information WHERE section_revision_id=$1)',
        [candidates.main_information],
      );
      const absent = Object.fromEntries(SECTION_KINDS.map((kind) => [kind, null])) as VerifiedProfileRevisionMap;
      expect(await choose(g, candidates, SECTION_KINDS, absent)).toMatchObject({
        revisions: null,
        retainKinds: [...SECTION_KINDS],
        issues: [expect.objectContaining({ code: 'site_not_in_revision_graph' })],
      });
      expect(
        await choose(g, exact(g), SECTION_KINDS, { ...exact(g), documents: other.revisions.documents! }),
      ).toMatchObject({
        revisions: null,
        issues: [expect.objectContaining({ kind: 'documents', code: 'revision_scope_invalid' })],
      });
    });
    it('uses deterministic SECTION_KINDS tie-break between equally large coherent accepted subsets', async () => {
      const g = await seedProfileGraph(pool);
      const extraIdentity = (
        await pool.query<{ id: string }>(
          'INSERT INTO production_site_identity (profile_id,organization_id) VALUES ($1,$2) RETURNING id',
          [g.profile, g.org],
        )
      ).rows[0]!.id;
      await pool.query(
        'INSERT INTO production_site (main_information_id,organization_id,identity_id,position_in_list) VALUES ($1,$2,$3,1)',
        [g.rows.main_information!.id, g.org, extraIdentity],
      );
      await tx(async (client) => {
        await client.query('UPDATE profile_section SET working_revision_id=NULL WHERE profile_id=$1', [g.profile]);
        await client.query(
          "UPDATE section_revision SET state='submitted',submitted_at=now() WHERE organization_id=$1",
          [g.org],
        );
        await client.query("UPDATE section_revision SET state='verified' WHERE organization_id=$1", [g.org]);
      });
      const candidates = await copies(g);
      await pool.query(
        'DELETE FROM production_site WHERE identity_id=$1 AND main_information_id IN (SELECT id FROM main_information WHERE section_revision_id=$2)',
        [extraIdentity, candidates.main_information],
      );
      await pool.query('UPDATE product_line SET production_site_identity_id=$1 WHERE section_revision_id=$2', [
        extraIdentity,
        candidates.products,
      ]);
      for (const accepted of [
        ['products', 'main_information'],
        ['main_information', 'products'],
      ] as const)
        expect(await choose(g, candidates, accepted)).toMatchObject({
          publishKinds: ['main_information'],
          retainKinds: ['products'],
        });
    });
    it('reuses unchanged exact accepted revisions and never mutates pointers, decisions or revisions', async () => {
      const g = await base();
      const candidates = await copies(g, ['contacts']);
      const before = (
        await pool.query('SELECT row_to_json(s) AS row FROM profile_section s WHERE profile_id=$1 ORDER BY kind', [
          g.profile,
        ])
      ).rows;
      const revisionsBefore = (await pool.query('SELECT count(*)::int AS count FROM section_revision')).rows[0]!.count;
      const decisionsBefore = (await pool.query('SELECT count(*)::int AS count FROM review_decision')).rows[0]!.count;
      const result = await choose(g, candidates, ['contacts', 'products']);
      expect(result).toMatchObject({ publishKinds: ['contacts', 'products'], retainKinds: [], issues: [] });
      expect(result.revisions!.products).toBe(g.revisions.products);
      expect(
        (
          await pool.query('SELECT row_to_json(s) AS row FROM profile_section s WHERE profile_id=$1 ORDER BY kind', [
            g.profile,
          ])
        ).rows,
      ).toEqual(before);
      expect((await pool.query('SELECT count(*)::int AS count FROM section_revision')).rows[0]!.count).toBe(
        revisionsBefore,
      );
      expect((await pool.query('SELECT count(*)::int AS count FROM review_decision')).rows[0]!.count).toBe(
        decisionsBefore,
      );
      expect(await choose(g, candidates, [])).toEqual({
        publishKinds: [],
        retainKinds: [],
        revisions: exact(g),
        issues: [],
      });
    });
    it('loads over a thousand product references in one scoped batch per operation', async () => {
      const g = await base();
      const candidates = await copies(g, ['products']);
      await pool.query(
        `WITH identities AS (
      INSERT INTO product_line_identity (profile_id,organization_id) SELECT $1,$2 FROM generate_series(1,1001) RETURNING id
    ) INSERT INTO product_line (section_revision_id,organization_id,identity_id,production_site_identity_id,position_in_list)
      SELECT $3,$2,id,$4,100+row_number() OVER () FROM identities`,
        [g.profile, g.org, candidates.products, g.rows.production_site!.identity_id],
      );
      const db = drizzle(pool, { schema });
      const calls = vi.spyOn(db, 'execute');
      try {
        expect((await validateProfileRevisionGraph(db, { ...scope(g), revisions: candidates })).valid).toBe(true);
        expect(calls).toHaveBeenCalledTimes(1);
        expect(
          (
            await selectProfilePublicationSubset(db, {
              ...scope(g),
              candidates,
              verified: exact(g),
              acceptedKinds: ['products'],
            })
          ).publishKinds,
        ).toEqual(['products']);
        expect(calls).toHaveBeenCalledTimes(2);
      } finally {
        calls.mockRestore();
      }
    });
  },
);

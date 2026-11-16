import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { FilePurpose, Role, SectionKind } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../src/common/audit.service.js';
import type { Env } from '../src/config/env.js';
import type { Database } from '../src/database/database.module.js';
import * as schema from '../src/database/schema/index.js';
import { withQueueTransaction } from '../src/database/transaction.js';
import type { AuthContext, AuthUser } from '../src/modules/auth/auth.types.js';
import { DictionariesService } from '../src/modules/dictionaries/dictionaries.service.js';
import { manufacturerFileOwners } from '../src/modules/files/file-owner.js';
import { FILE_READ_RULES } from '../src/modules/files/file-access.js';
import { FilesService } from '../src/modules/files/files.service.js';
import { captureRevisionFileVersions, frozenRevisionFileVersion } from '../src/modules/files/revision-file-snapshot.js';
import type { AcceptedUpload } from '../src/modules/files/upload.js';
import { migrateThrough, openTestPool, resetDatabase } from './support/database.js';
import { MemoryObjectStorage } from './support/memory-storage.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const UPLOADER = '00000000-0000-4000-8000-0000000000f1';
type Profile = { organizationId: string; profileId: string };
type OwnerKind = 'chart' | 'cv' | 'extract' | 'process_photo' | 'equipment_photo' | 'certificate' | 'document';
const cases: { purpose: FilePurpose; owner: OwnerKind; section: SectionKind }[] = [
  { purpose: 'organisation_chart', owner: 'chart', section: 'personnel' },
  { purpose: 'cv', owner: 'cv', section: 'personnel' },
  { purpose: 'unified_register_extract', owner: 'extract', section: 'products' },
  { purpose: 'production_photo', owner: 'process_photo', section: 'production' },
  { purpose: 'production_photo', owner: 'equipment_photo', section: 'production' },
  { purpose: 'certificate_file', owner: 'certificate', section: 'certificates' },
  { purpose: 'conformity_certificate', owner: 'certificate', section: 'certificates' },
  { purpose: 'document_file', owner: 'document', section: 'documents' },
];

describe.skipIf(!databaseUrl)('file owner graph and immutable version selection (GEN-09, DATA-04–07)', () => {
  vi.setConfig({ testTimeout: 30000 });
  let pool: pg.Pool;
  let db: Database;
  let service: FilesService;
  let dictionaries: DictionariesService;
  let admin: AuthUser;

  const auth = (role: Role, organizationId: string) =>
    ({ user: { id: randomUUID(), role, organizationId } }) as AuthContext;
  const profile = async (): Promise<Profile> => {
    const organizationId = (
      await pool.query<{ id: string }>(
        "insert into organizations(type,name,bin) values ('manufacturer','Fixture', $1) returning id",
        [String(Math.floor(Math.random() * 1e12)).padStart(12, '0')],
      )
    ).rows[0]!.id;
    const profileId = (
      await pool.query<{ id: string }>('insert into manufacturer_profile(organization_id) values ($1) returning id', [
        organizationId,
      ])
    ).rows[0]!.id;
    return { organizationId, profileId };
  };
  const revision = async (p: Profile, kind: SectionKind) => {
    return (
      await pool.query<{ id: string }>(
        'select r.id from profile_section s join section_revision r on r.id=s.working_revision_id where s.profile_id=$1 and s.organization_id=$2 and s.kind=$3',
        [p.profileId, p.organizationId, kind],
      )
    ).rows[0]!.id;
  };
  const file = async (p: Profile, purpose: FilePurpose, scanState = 'passed') => {
    const fileObjectId = (
      await pool.query<{ id: string }>(
        "insert into file_object(organization_id,purpose,data_class) values ($1,$2,'b_manufacturer') returning id",
        [p.organizationId, purpose],
      )
    ).rows[0]!.id;
    const versionId = await version(fileObjectId, 1, scanState);
    return { fileObjectId, versionId };
  };
  const version = async (fileObjectId: string, number: number, scanState = 'passed') =>
    (
      await pool.query<{ id: string }>(
        `insert into file_version(file_object_id,version_number,original_name,byte_size,declared_media_type,detected_media_type,checksum,scan_state,storage_key)
     values ($1,$2,$3,10,'application/pdf','application/pdf',$4,$5,$6) returning id`,
        [fileObjectId, number, `v${number}.pdf`, '0'.repeat(64), scanState, randomUUID()],
      )
    ).rows[0]!.id;
  const attach = async (p: Profile, revisionId: string, fileId: string, owner: OwnerKind, group = 'product') => {
    const args = [revisionId, p.organizationId, fileId];
    if (owner === 'chart' || owner === 'cv') {
      const parent = (
        await pool.query<{ id: string }>(
          'insert into personnel(section_revision_id,organization_id) values ($1,$2) returning id',
          args.slice(0, 2),
        )
      ).rows[0]!.id;
      const table = owner === 'chart' ? 'personnel_org_chart' : 'personnel_cv';
      return (
        await pool.query<{ id: string }>(
          `insert into ${table}(personnel_id,organization_id,file_object_id) values ($1,$2,$3) returning id`,
          [parent, p.organizationId, fileId],
        )
      ).rows[0]!.id;
    }
    if (owner === 'extract')
      return (
        await pool.query<{ id: string }>(
          'insert into products_section(section_revision_id,organization_id,unified_register_extract_id) values ($1,$2,$3) returning id',
          args,
        )
      ).rows[0]!.id;
    if (owner === 'process_photo') {
      const parent = (
        await pool.query<{ id: string }>(
          'insert into production(section_revision_id,organization_id) values ($1,$2) returning id',
          args.slice(0, 2),
        )
      ).rows[0]!.id;
      return (
        await pool.query<{ id: string }>(
          'insert into production_photo(production_id,organization_id,file_object_id) values ($1,$2,$3) returning id',
          [parent, p.organizationId, fileId],
        )
      ).rows[0]!.id;
    }
    if (owner === 'equipment_photo')
      return (
        await pool.query<{ id: string }>(
          'insert into equipment_item(section_revision_id,organization_id,photo_file_id) values ($1,$2,$3) returning id',
          args,
        )
      ).rows[0]!.id;
    if (owner === 'certificate') {
      const identity = (
        await pool.query<{ id: string }>(
          'insert into certificate_identity(profile_id,organization_id) values ($1,$2) returning id',
          [p.profileId, p.organizationId],
        )
      ).rows[0]!.id;
      return (
        await pool.query<{ id: string }>(
          'insert into certificate(section_revision_id,organization_id,file_object_id,identity_id,"group") values ($1,$2,$3,$4,$5) returning id',
          [...args, identity, group],
        )
      ).rows[0]!.id;
    }
    return (
      await pool.query<{ id: string }>(
        'insert into document(section_revision_id,organization_id,file_object_id) values ($1,$2,$3) returning id',
        args,
      )
    ).rows[0]!.id;
  };
  const freeze = async (revisionId: string) => db.transaction((tx) => freezeTx(tx as unknown as Database, revisionId));
  const blocked = async () =>
    expect(
      (
        await pool.query<{ count: number }>(
          'select count(*)::int as count from pg_stat_activity where datname=current_database() and cardinality(pg_blocking_pids(pid))>0',
        )
      ).rows[0]!.count,
    ).toBeGreaterThan(0);

  beforeAll(async () => {
    pool = openTestPool();
    await resetDatabase(pool);
    await migrateThrough(pool);
    db = drizzle(pool, { schema, casing: 'snake_case' });
    const uploaderProfile = await profile();
    await pool.query(
      "insert into user_accounts(id,organization_id,email,role,state) values ($1,$2,'uploader@factory.local','manufacturer','active')",
      [UPLOADER, uploaderProfile.organizationId],
    );
    service = new FilesService(
      db,
      { send: vi.fn().mockResolvedValue('job') } as unknown as PgBoss,
      new MemoryObjectStorage(),
      {} as Env,
      { record: vi.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    );
    const imbcId = (await pool.query<{ id: string }>("select id from organizations where type='imbc'")).rows[0]!.id;
    const adminId = (
      await pool.query<{ id: string }>(
        "insert into user_accounts(organization_id,email,role,state) values ($1,'admin@imbc.local','administrator','active') returning id",
        [imbcId],
      )
    ).rows[0]!.id;
    admin = {
      id: adminId,
      organizationId: imbcId,
      role: 'administrator',
      organizationType: 'imbc',
      email: 'admin@imbc.local',
      fullName: null,
      locale: 'en',
    };
    dictionaries = new DictionariesService(db, pool, new AuditService(db));
  }, 120000);
  afterAll(async () => {
    await pool?.end();
  });

  it.each(cases)(
    '$purpose via $owner: saved Draft grants SME/director access; all parent and section links resolve',
    async ({ purpose, owner, section }) => {
      const p = await profile();
      const r = await revision(p, section);
      const f = await file(p, purpose);
      const ownerId = await attach(p, r, f.fileObjectId, owner);
      expect(
        await manufacturerFileOwners(db, { id: f.fileObjectId, purpose, organizationId: p.organizationId }),
      ).toMatchObject([
        { ownerId, sectionRevisionId: r, organizationId: p.organizationId, kind: section, state: 'working' },
      ]);
      for (const role of ['expert', 'director'] as const)
        expect(await service.describe(auth(role, randomUUID()), f.fileObjectId, null, null)).toMatchObject({
          versionNumber: 1,
        });
    },
  );

  it('own orphan preview is permitted; orphan SME/director and administrator/operator/observer are denied before scan', async () => {
    const p = await profile();
    const f = await file(p, 'cv', 'pending');
    await expect(
      service.describe(auth('manufacturer', p.organizationId), f.fileObjectId, null, null),
    ).rejects.toMatchObject({ code: 'file_pending_scan' });
    for (const role of ['expert', 'director', 'administrator', 'operator', 'observer'] as const)
      await expect(service.describe(auth(role, p.organizationId), f.fileObjectId, null, null)).rejects.toMatchObject({
        code: 'forbidden',
      });
    await expect(
      service.describe(auth('manufacturer', randomUUID()), f.fileObjectId, null, null),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('denial releases its read checkout before real audit with a one-connection pool (GEN-09, AUD-01)', async () => {
    const p = await profile();
    const f = await file(p, 'cv');
    // A finite connection wait also makes cleanup bounded if the regression deadlocks before the fix.
    const singlePool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 2000 });
    const singleDb = drizzle(singlePool, { schema, casing: 'snake_case' });
    const files = new FilesService(
      singleDb,
      {} as PgBoss,
      new MemoryObjectStorage(),
      {} as Env,
      new AuditService(singleDb),
    );
    const denied = files.describe({ user: admin } as AuthContext, f.fileObjectId, null, '192.0.2.17');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Denied file read exceeded one-second deadline')), 1000);
    });
    try {
      await expect(Promise.race([denied, deadline])).rejects.toMatchObject({ code: 'forbidden' });
      const { rows } = await singlePool.query<{
        outcome: string;
        user_id: string;
        organization_id: string;
        ip: string;
      }>(
        "select outcome,user_id,organization_id,host(ip) as ip from audit_entries where action='file.read' and object_type='file_object' and object_id=$1",
        [f.fileObjectId],
      );
      expect(rows).toEqual([
        { outcome: 'denied', user_id: admin.id, organization_id: admin.organizationId, ip: '192.0.2.17' },
      ]);
      expect(singlePool.totalCount).toBe(1);
      expect(singlePool.idleCount).toBe(1);
    } finally {
      clearTimeout(timer);
      await denied.catch(() => undefined);
      await singlePool.end();
    }
  });

  it('purpose mismatch grants no reviewer access and cannot silently disappear from the submission snapshot', async () => {
    const p = await profile();
    const r = await revision(p, 'production');
    const f = await file(p, 'cv');
    await attach(p, r, f.fileObjectId, 'equipment_photo');
    await expect(service.describe(auth('expert', p.organizationId), f.fileObjectId, null, null)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      db.transaction((tx) =>
        captureRevisionFileVersions(tx as unknown as Database, {
          sectionRevisionId: r,
          organizationId: p.organizationId,
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('conformity_certificate is accepted only for certificate.product, not company/other or an absence declaration', async () => {
    for (const group of ['company', 'other']) {
      const p = await profile();
      const r = await revision(p, 'certificates');
      const f = await file(p, 'conformity_certificate');
      await attach(p, r, f.fileObjectId, 'certificate', group);
      await expect(
        service.describe(auth('director', p.organizationId), f.fileObjectId, null, null),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    const p = await profile();
    const r = await revision(p, 'certificates');
    const f = await file(p, 'certificate_file');
    const ownerId = await attach(p, r, f.fileObjectId, 'certificate');
    await expect(pool.query('update certificate set not_held=true where id=$1', [ownerId])).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('tenant FK rejects a file from another organisation and the original file remains orphaned', async () => {
    const p = await profile();
    const other = await profile();
    const r = await revision(p, 'documents');
    const f = await file(other, 'document_file');
    await expect(attach(p, r, f.fileObjectId, 'document')).rejects.toMatchObject({ code: '23503' });
    await expect(service.describe(auth('expert', p.organizationId), f.fileObjectId, null, null)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('frozen default/explicit reads use the captured version after replacement; manufacturer generic preview remains latest', async () => {
    const p = await profile();
    const r = await revision(p, 'documents');
    const f = await file(p, 'document_file');
    await attach(p, r, f.fileObjectId, 'document');
    await db.transaction(async (tx) => {
      await captureRevisionFileVersions(tx as unknown as Database, {
        sectionRevisionId: r,
        organizationId: p.organizationId,
      });
      await freezeTx(tx as unknown as Database, r);
    });
    const secondVersion = await version(f.fileObjectId, 2, 'pending');
    for (const role of ['expert', 'director'] as const) {
      expect(await service.describe(auth(role, p.organizationId), f.fileObjectId, null, null)).toMatchObject({
        versionNumber: 1,
      });
      await expect(service.describe(auth(role, p.organizationId), f.fileObjectId, 2, null)).rejects.toMatchObject({
        code: 'not_found',
      });
    }
    await expect(
      service.describe(auth('manufacturer', p.organizationId), f.fileObjectId, null, null),
    ).rejects.toMatchObject({ code: 'file_pending_scan' });
    await pool.query("update file_version set scan_state='passed',scanned_at=now() where id=$1", [secondVersion]);
    expect(await service.describe(auth('manufacturer', p.organizationId), f.fileObjectId, null, null)).toMatchObject({
      versionNumber: 2,
    });
    expect(
      await frozenRevisionFileVersion(db, {
        sectionRevisionId: r,
        organizationId: p.organizationId,
        fileObjectId: f.fileObjectId,
      }),
    ).toMatchObject({ fileVersionId: f.versionId, versionNumber: 1 });
  });

  it('freeze without snapshot fails closed even after a late scan passes', async () => {
    const p = await profile();
    const r = await revision(p, 'documents');
    const f = await file(p, 'document_file', 'pending');
    await attach(p, r, f.fileObjectId, 'document');
    await freeze(r);
    await pool.query("update file_version set scan_state='passed',scanned_at=now() where id=$1", [f.versionId]);
    await expect(service.describe(auth('expert', p.organizationId), f.fileObjectId, null, null)).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      await frozenRevisionFileVersion(db, {
        sectionRevisionId: r,
        organizationId: p.organizationId,
        fileObjectId: f.fileObjectId,
      }),
    ).toBeNull();
  });

  it('a freeze and replacement between the owner decision and version read cannot leak the post-submission version', async () => {
    const p = await profile();
    const r = await revision(p, 'documents');
    const f = await file(p, 'document_file');
    await attach(p, r, f.fileObjectId, 'document');
    const original = FILE_READ_RULES.document_file;
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entered = vi.fn();
    FILE_READ_RULES.document_file = async (context) => {
      const decision = await original(context);
      entered();
      await gate;
      return decision;
    };
    const pending = service.describe(auth('expert', p.organizationId), f.fileObjectId, null, null);
    try {
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      await db.transaction(async (tx) => {
        await captureRevisionFileVersions(tx as unknown as Database, {
          sectionRevisionId: r,
          organizationId: p.organizationId,
        });
        await freezeTx(tx as unknown as Database, r);
      });
      await version(f.fileObjectId, 2);
    } finally {
      FILE_READ_RULES.document_file = original;
      finish();
    }
    expect(await pending).toMatchObject({ versionNumber: 1 });
    expect(await service.describe(auth('expert', p.organizationId), f.fileObjectId, null, null)).toMatchObject({
      versionNumber: 1,
    });
  });

  it('several product lines reuse one certificate owner and one captured file, without a second product attachment', async () => {
    const p = await profile();
    const certificateRevision = await revision(p, 'certificates');
    const productRevision = await revision(p, 'products');
    const f = await file(p, 'conformity_certificate');
    const ownerId = await attach(p, certificateRevision, f.fileObjectId, 'certificate');
    const identity = (
      await pool.query<{ id: string }>('select identity_id as id from certificate where id=$1', [ownerId])
    ).rows[0]!.id;
    for (let index = 0; index < 2; index++) {
      const productIdentity = (
        await pool.query<{ id: string }>(
          'insert into product_line_identity(profile_id,organization_id) values ($1,$2) returning id',
          [p.profileId, p.organizationId],
        )
      ).rows[0]!.id;
      const productId = (
        await pool.query<{ id: string }>(
          'insert into product_line(section_revision_id,organization_id,identity_id) values ($1,$2,$3) returning id',
          [productRevision, p.organizationId, productIdentity],
        )
      ).rows[0]!.id;
      await pool.query(
        'insert into product_line_certificate(product_line_id,organization_id,certificate_identity_id) values ($1,$2,$3)',
        [productId, p.organizationId, identity],
      );
    }
    expect(
      await manufacturerFileOwners(db, {
        id: f.fileObjectId,
        purpose: 'conformity_certificate',
        organizationId: p.organizationId,
      }),
    ).toMatchObject([{ ownerId, sectionRevisionId: certificateRevision }]);
    await db.transaction(async (tx) => {
      expect(
        await captureRevisionFileVersions(tx as unknown as Database, {
          sectionRevisionId: productRevision,
          organizationId: p.organizationId,
        }),
      ).toEqual([]);
      expect(
        await captureRevisionFileVersions(tx as unknown as Database, {
          sectionRevisionId: certificateRevision,
          organizationId: p.organizationId,
        }),
      ).toMatchObject([{ fileObjectId: f.fileObjectId, fileVersionId: f.versionId }]);
      await freezeTx(tx as unknown as Database, productRevision);
      await freezeTx(tx as unknown as Database, certificateRevision);
    });
    expect(
      (await pool.query('select * from revision_file_version where file_object_id=$1', [f.fileObjectId])).rowCount,
    ).toBe(1);
  });

  it('a replacement holding file_object is seen after the snapshot lock wait; latest pending cannot capture an older passed version', async () => {
    const p = await profile();
    const r = await revision(p, 'documents');
    const f = await file(p, 'document_file');
    await attach(p, r, f.fileObjectId, 'document');
    const client = await pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await client.query('begin');
      await client.query('select id from file_object where id=$1 for update', [f.fileObjectId]);
      await client.query(
        `insert into file_version(file_object_id,version_number,original_name,byte_size,declared_media_type,checksum,scan_state,storage_key) values($1,2,'v2.pdf',10,'application/pdf',$2,'pending',$3)`,
        [f.fileObjectId, '0'.repeat(64), randomUUID()],
      );
      pending = db
        .transaction((tx) =>
          captureRevisionFileVersions(tx as unknown as Database, {
            sectionRevisionId: r,
            organizationId: p.organizationId,
          }),
        )
        .catch((error: unknown) => error);
      await vi.waitFor(blocked);
      await client.query('commit');
      expect(await pending).toMatchObject({ code: 'file_pending_scan' });
      expect((await pool.query('select * from revision_file_version where section_revision_id=$1', [r])).rowCount).toBe(
        0,
      );
    } finally {
      await client.query('rollback');
      client.release();
      await pending;
    }
  });

  it('snapshot holds the same lock as recordVersion until freezing commits; later replacement cannot alter reviewer content', async () => {
    const p = await profile();
    const r = await revision(p, 'documents');
    const f = await file(p, 'document_file');
    await attach(p, r, f.fileObjectId, 'document');
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entered = vi.fn();
    const snapshot = db.transaction(async (tx) => {
      await captureRevisionFileVersions(tx as unknown as Database, {
        sectionRevisionId: r,
        organizationId: p.organizationId,
      });
      entered();
      await gate;
      await freezeTx(tx as unknown as Database, r);
    });
    // Observe failures immediately even while the test is waiting for the held transaction to enter its gate.
    void snapshot.catch(() => undefined);
    let replacement: ReturnType<FilesService['recordVersion']> | undefined;
    try {
      await vi.waitFor(() => expect(entered).toHaveBeenCalledOnce());
      replacement = withQueueTransaction(pool, (tx, queueDb) =>
        service.recordVersion(tx, queueDb, f.fileObjectId, {
          uploadedBy: UPLOADER,
          storageKey: randomUUID(),
          upload: {
            originalName: 'v2.pdf',
            bytes: Buffer.alloc(10),
            mediaType: 'application/pdf',
            declaredMediaType: 'application/pdf',
            checksum: '0'.repeat(64),
          } as AcceptedUpload,
        }),
      );
      await vi.waitFor(blocked);
    } finally {
      finish();
      await Promise.allSettled([snapshot, ...(replacement ? [replacement] : [])]);
    }
    await snapshot;
    const second = await replacement!;
    expect(second.versionNumber).toBe(2);
    await pool.query("update file_version set scan_state='passed' where id=$1", [second.versionId]);
    expect(await service.describe(auth('expert', p.organizationId), f.fileObjectId, null, null)).toMatchObject({
      versionNumber: 1,
    });
  });

  it('new site, OKED/KPVED, unit and submission-requirement FKs protect deletion; service maps 23503 to 409 and preserves entries', async () => {
    const entry = async (code: string) => {
      const dictionaryId = (
        await pool.query<{ id: string }>(
          'insert into dictionary(code,name) values ($1,$1) on conflict(code) do update set name=excluded.name returning id',
          [code],
        )
      ).rows[0]!.id;
      return (
        await pool.query<{ id: string }>(
          'insert into dictionary_entry(dictionary_id,code) values ($1,$2) returning id',
          [dictionaryId, `task7-${randomUUID()}`],
        )
      ).rows[0]!.id;
    };
    const p = await profile();
    const mainRevision = await revision(p, 'main_information');
    const mainId = (
      await pool.query<{ id: string }>(
        'select id from main_information where section_revision_id=$1 and organization_id=$2',
        [mainRevision, p.organizationId],
      )
    ).rows[0]!.id;
    const siteIdentity = (
      await pool.query<{ id: string }>(
        'insert into production_site_identity(profile_id,organization_id) values ($1,$2) returning id',
        [p.profileId, p.organizationId],
      )
    ).rows[0]!.id;
    const region = await entry('region');
    await pool.query(
      'insert into production_site(main_information_id,organization_id,identity_id,region_id) values ($1,$2,$3,$4)',
      [mainId, p.organizationId, siteIdentity, region],
    );
    const oked = await entry('oked');
    await pool.query(
      "insert into main_information_oked(main_information_id,organization_id,code,oked_entry_id) values ($1,$2,'00001',$3)",
      [mainId, p.organizationId, oked],
    );
    const productRevision = await revision(p, 'products');
    const productIdentity = (
      await pool.query<{ id: string }>(
        'insert into product_line_identity(profile_id,organization_id) values ($1,$2) returning id',
        [p.profileId, p.organizationId],
      )
    ).rows[0]!.id;
    const unit = await entry('unit');
    const productId = (
      await pool.query<{ id: string }>(
        'insert into product_line(section_revision_id,organization_id,identity_id,capacity_unit_id) values ($1,$2,$3,$4) returning id',
        [productRevision, p.organizationId, productIdentity, unit],
      )
    ).rows[0]!.id;
    const kpved = await entry('kpved');
    await pool.query(
      "insert into product_line_kpved(product_line_id,organization_id,code,kpved_entry_id) values ($1,$2,'00.1',$3)",
      [productId, p.organizationId, kpved],
    );
    const requirement = await entry('document_type');
    await pool.query(
      'insert into submission_requirement(section_revision_id,organization_id,dictionary_entry_id,captured_at) values ($1,$2,$3,now())',
      [productRevision, p.organizationId, requirement],
    );
    for (const [code, id] of [
      ['region', region],
      ['oked', oked],
      ['kpved', kpved],
      ['document_type', requirement],
    ]) {
      await expect(dictionaries.remove(admin, code!, id!)).rejects.toMatchObject({ code: 'entry_in_use' });
      expect((await pool.query('select id from dictionary_entry where id=$1', [id])).rowCount).toBe(1);
    }
    // Unit is a technical reference in 3а, outside the 12-list administrator contract until its later expansion.
    await expect(pool.query('delete from dictionary_entry where id=$1', [unit])).rejects.toMatchObject({
      code: '23503',
    });
    expect((await pool.query('select id from dictionary_entry where id=$1', [unit])).rowCount).toBe(1);
  });
});

// Parameterized SQL reused inside the submission transaction; no HTTP submit is introduced by this test.
const freezeTx = async (tx: Database, revisionId: string) => {
  await tx.execute(sql`update profile_section set working_revision_id=null where working_revision_id=${revisionId}`);
  await tx.execute(sql`update section_revision set state='submitted',submitted_at=now() where id=${revisionId}`);
};

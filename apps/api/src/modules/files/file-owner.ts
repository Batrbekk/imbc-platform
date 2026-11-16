import type { FilePurpose, SectionKind } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';

export type ManufacturerFileOwner = {
  ownerId: string;
  sectionRevisionId: string;
  organizationId: string;
  kind: SectionKind;
  state: 'working' | 'submitted' | 'verified' | 'rejected' | 'superseded';
  submittedAt: Date | null;
};

export type RevisionOwnedFile = {
  fileObjectId: string;
  valid: boolean;
};

/**
 * One owner graph for access and the future submission snapshot (GEN-09, DATA-05).
 * Child joins include their tenant; the outer joins also check revision, section kind and profile tenant.
 * Equipment and process photographs share production_photo. Reusable product certificates remain owned by
 * the certificate revision: product_line_certificate points to its identity and creates no second file.
 * conformity_certificate is a compatibility purpose for a held certificate in the product group only.
 */
const owners = sql`
  select o.id as owner_id, o.file_object_id, o.organization_id, p.section_revision_id,
         'personnel'::text as section_kind, array['organisation_chart']::text[] as purposes
    from personnel_org_chart o join personnel p on p.id = o.personnel_id and p.organization_id = o.organization_id
  union all
  select o.id, o.file_object_id, o.organization_id, p.section_revision_id, 'personnel', array['cv']::text[]
    from personnel_cv o join personnel p on p.id = o.personnel_id and p.organization_id = o.organization_id
  union all
  select o.id, o.unified_register_extract_id, o.organization_id, o.section_revision_id,
         'products', array['unified_register_extract']::text[]
    from products_section o where o.unified_register_extract_id is not null
  union all
  select o.id, o.file_object_id, o.organization_id, p.section_revision_id,
         'production', array['production_photo']::text[]
    from production_photo o join production p on p.id = o.production_id and p.organization_id = o.organization_id
  union all
  select o.id, o.photo_file_id, o.organization_id, o.section_revision_id,
         'production', array['production_photo']::text[]
    from equipment_item o where o.photo_file_id is not null
  union all
  select o.id, o.file_object_id, o.organization_id, o.section_revision_id, 'certificates',
         case when o.not_held then array[]::text[]
              when o."group" = 'product' then array['certificate_file', 'conformity_certificate']::text[]
              else array['certificate_file']::text[] end
    from certificate o join certificate_identity i on i.id = o.identity_id and i.organization_id = o.organization_id
   where o.file_object_id is not null
  union all
  select o.id, o.file_object_id, o.organization_id, o.section_revision_id, 'documents', array['document_file']::text[]
    from document o where o.file_object_id is not null`;

const ownerRevisions = sql`
  from (${owners}) o
  join section_revision r on r.id = o.section_revision_id and r.organization_id = o.organization_id
  join profile_section s on s.id = r.profile_section_id and s.organization_id = r.organization_id
                       and s.kind::text = o.section_kind
  join manufacturer_profile p on p.id = s.profile_id and p.organization_id = s.organization_id`;

/** Persisted, purpose-compatible owners; a file id alone never grants SME/director access (GEN-09, ADM-06). */
export async function manufacturerFileOwners(
  tx: Database,
  file: { id: string; organizationId: string; purpose: FilePurpose },
): Promise<ManufacturerFileOwner[]> {
  const { rows } = await tx.execute<ManufacturerFileOwner>(sql`
    select o.owner_id as "ownerId", r.id as "sectionRevisionId", r.organization_id as "organizationId",
           s.kind as kind, r.state as state, r.submitted_at as "submittedAt"
    ${ownerRevisions}
    where o.file_object_id = ${file.id} and o.organization_id = ${file.organizationId}
      and ${file.purpose} = any(o.purposes)`);
  return rows;
}

/**
 * Every nonempty file reference of this revision, including invalid purposes so submission fails closed.
 * Used inside the same transaction that freezes the revision; tenant FKs additionally reject malformed links.
 */
export async function revisionOwnedFiles(
  tx: Database,
  sectionRevisionId: string,
  organizationId: string,
): Promise<RevisionOwnedFile[]> {
  const { rows } = await tx.execute<RevisionOwnedFile>(sql`
    select o.file_object_id as "fileObjectId",
           coalesce(f.purpose::text = any(o.purposes) and f.data_class = 'b_manufacturer'
             and f.purge_requested_at is null, false) as valid
    ${ownerRevisions}
    left join file_object f on f.id = o.file_object_id and f.organization_id = o.organization_id
    where r.id = ${sectionRevisionId} and r.organization_id = ${organizationId}`);
  return rows;
}

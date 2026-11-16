import { COMMODITY_GROUPS, SECTION_KINDS, normalizeCompanyName, type SectionKind } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { MainInformationHandler } from '../profiles/main-information.handler.js';
import { ContactsHandler } from '../profiles/contacts.handler.js';
import { PersonnelHandler } from '../profiles/personnel.handler.js';
import { ProductsHandler } from '../profiles/products.handler.js';
import { ProductionHandler } from '../profiles/production.handler.js';
import { CertificatesHandler } from '../profiles/certificates.handler.js';
import { DocumentsHandler } from '../profiles/documents.handler.js';
import { validateProfileRevisionGraph, type ExactProfileRevisionMap } from '../profiles/profile-publication-graph.js';
import { reconcileSiteSurveyPublication } from '../site-survey/survey-publication-state.js';
import type { SurveyPublicationObservation } from '../site-survey/survey-operation.js';

type Scope = { profileId: string; organizationId: string };
type Pointer = { kind: SectionKind; sectionId: string; revisionId: string; state: string };
const unique = (items: (string | null | undefined)[]) => [...new Set(items.filter((s): s is string => Boolean(s)))];

/**
 * A real projection writer, shared by review publication and DD replacement. Caller owns the profile
 * NO KEY UPDATE lock. Only seven exact verified revisions are read: neither working/frozen candidates
 * nor latest EO/Adata values can enter catalog search, page, exports or pull API.
 */
export async function rebuildVerifiedCatalogProjection(
  tx: Database, scope: Scope, surveyObservation?: SurveyPublicationObservation,
): Promise<boolean> {
  // Survey generations are independent of DD visibility, including a hidden profile's deferred notice.
  const survey = await reconcileSiteSurveyPublication(tx, scope, surveyObservation);
  const profile = (
    await tx.execute<{
      status: string;
      result: string | null;
      verifiedAt: string | null;
      updateStatus: string;
      pendingChanges: boolean;
      bin: string;
      checkedOn: string | null;
      enhancedDone: boolean;
    }>(sql`
    select p.status,d.result,to_char(p.verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "verifiedAt",
      coalesce(p.update_status,'active') as "updateStatus",p.has_pending_changes as "pendingChanges",o.bin,
      d.checked_on::text as "checkedOn",coalesce(d.enhanced='done',false) as "enhancedDone"
    from manufacturer_profile p join organizations o on o.id=p.organization_id
    left join due_diligence_record d on d.profile_id=p.id and d.organization_id=p.organization_id
    where p.id=${scope.profileId} and p.organization_id=${scope.organizationId}`)
  ).rows[0];
  const hide = async () => {
    await tx.execute(sql`delete from catalog_visible where profile_id=${scope.profileId}`);
    return false;
  };
  if (
    !profile ||
    profile.status !== 'verified' ||
    !['green', 'amber'].includes(profile.result ?? '') ||
    !profile.verifiedAt
  )
    return hide();
  const pointers = (
    await tx.execute<Pointer>(sql`
    select s.kind,s.id as "sectionId",r.id as "revisionId",r.state
    from profile_section s join section_revision r on r.id=s.verified_revision_id
      and r.profile_section_id=s.id and r.organization_id=s.organization_id
    where s.profile_id=${scope.profileId} and s.organization_id=${scope.organizationId}
    order by s.kind for share of s,r`)
  ).rows;
  if (
    pointers.length !== SECTION_KINDS.length ||
    new Set(pointers.map((p) => p.kind)).size !== SECTION_KINDS.length ||
    pointers.some((p) => p.state !== 'verified')
  )
    return hide();
  const revisions = Object.fromEntries(pointers.map((p) => [p.kind, p.revisionId])) as ExactProfileRevisionMap;
  if (!(await validateProfileRevisionGraph(tx, { ...scope, revisions })).valid) return hide();
  const context = (kind: SectionKind) => ({
    ...scope,
    sectionId: pointers.find((p) => p.kind === kind)!.sectionId,
    revisionId: revisions[kind],
  });
  // Reads are deliberately sequential on a single SQL connection, with the revision pins held throughout.
  const main = await new MainInformationHandler().read(tx, context('main_information'));
  const contacts = await new ContactsHandler().read(tx, context('contacts'));
  const personnel = await new PersonnelHandler().read(tx, context('personnel'));
  const products = await new ProductsHandler().read(tx, context('products'));
  const production = await new ProductionHandler().read(tx, context('production'));
  const certificates = await new CertificatesHandler().read(tx, context('certificates'));
  const documents = await new DocumentsHandler().read(tx, context('documents'));
  const flags = (
    await tx.execute<{ worksWithCount: number }>(sql`
    select least(3,(select count(distinct operator_org_id)::integer from works_with_marks w
        where w.profile_id=${scope.profileId} and w.works_with and w.state='validated')) as "worksWithCount"`)
  ).rows[0]!;
  const focal = contacts.contacts.find((c) => c.isFocalPoint);
  const nameRu = main.legalInformation.legalName ?? main.legalInformation.alternativeName ?? profile.bin;
  const nameEn = main.legalInformation.alternativeName ?? nameRu;
  const region = main.selectedRegions[0]?.code ?? '';
  const publicCertificates = certificates.certificates.filter((c) => c.status === 'verified' || c.status === 'expired');
  const typeFor = (id: string) =>
    publicCertificates.find((c) => c.identityId === id)?.certificateType?.code ??
    certificates.editable.certificates.find((c) => c.identityId === id)?.customTypeName;
  const certificateTypes = unique(publicCertificates.map((c) => typeFor(c.identityId)));
  const certificateDates = Object.fromEntries(
    certificateTypes.map((type) => {
      const applicable = certificates.editable.certificates.filter(
        (c) => publicCertificates.some((p) => p.identityId === c.identityId) && typeFor(c.identityId) === type,
      );
      const dates = applicable.flatMap((c) => (c.expiresOn ? [c.expiresOn] : [])).sort();
      return [type, applicable.some((c) => c.expiresOn === null) ? null : (dates.at(-1) ?? null)];
    }),
  );
  const commodityGroups = unique(products.selectedReferences.commodityTypes.map((t) => t.group?.code)).filter(
    (g): g is (typeof COMMODITY_GROUPS)[number] => COMMODITY_GROUPS.includes(g as (typeof COMMODITY_GROUPS)[number]),
  );
  const headcount = personnel.totalHeadcount;
  const card = {
    companyPhone: main.editable.companyPhone,
    companyEmail: main.editable.contactEmail,
    focalPoint:
      focal && focal.fullName && focal.position && focal.email && focal.phone
        ? { fullName: focal.fullName, position: focal.position, email: focal.email, phone: focal.phone }
        : null,
    diligence: { checkedOn: profile.checkedOn, enhancedDone: profile.enhancedDone },
    siteSurveySummary: survey.summary,
    verifiedRevisionIds: revisions,
    // Explicit allow-list excludes Main login identity and Class C connector state/evidence.
    verifiedSections: {
      main_information: {
        bin: main.bin,
        editable: main.editable,
        selectedRegions: main.selectedRegions,
        legalInformation: main.legalInformation,
        registry: main.registry,
      },
      contacts: { contacts: contacts.contacts.filter((c) => !c.isFocalPoint) },
      personnel,
      products,
      production,
      certificates,
      documents,
    },
  };
  await tx.execute(sql`
    insert into catalog_visible(profile_id,organization_id,bin,name_en,name_ru,name_normalized,region,
      commodity_groups,commodity_types,tnved_codes,kpved_codes,oked_codes,certificate_types,certificates_valid_until,
      main_tnved,headcount_total,site_surveyed,unified_register,works_with_count,update_status,pending_changes,verified_at,card,refreshed_at)
    values (${scope.profileId},${scope.organizationId},${profile.bin},${nameEn},${nameRu},${normalizeCompanyName(nameRu)},${region},
      ${sql.param(commodityGroups)}::commodity_group[],${sql.param(unique(products.selectedReferences.commodityTypes.map((t) => t.code)))}::text[],
      ${sql.param(unique(products.lines.map((p) => p.tnVedCode)))}::text[],${sql.param(unique(products.lines.flatMap((p) => p.kpved.map((k) => k.code))))}::text[],
      ${sql.param(unique(main.legalInformation.oked.map((o) => o.code)))}::text[],${sql.param(certificateTypes)}::text[],${JSON.stringify(certificateDates)}::jsonb,
      ${products.lines[0]?.tnVedCode ?? null},${headcount},${survey.summary.siteSurveyed},${main.registry.registered === true},${flags.worksWithCount},
      ${profile.updateStatus}::update_status,${profile.pendingChanges},${profile.verifiedAt}::timestamptz,${JSON.stringify(card)}::jsonb,clock_timestamp())
    on conflict(profile_id) do update set organization_id=excluded.organization_id,bin=excluded.bin,name_en=excluded.name_en,
      name_ru=excluded.name_ru,name_normalized=excluded.name_normalized,region=excluded.region,commodity_groups=excluded.commodity_groups,
      commodity_types=excluded.commodity_types,tnved_codes=excluded.tnved_codes,kpved_codes=excluded.kpved_codes,oked_codes=excluded.oked_codes,
      certificate_types=excluded.certificate_types,certificates_valid_until=excluded.certificates_valid_until,main_tnved=excluded.main_tnved,
      headcount_total=excluded.headcount_total,site_surveyed=excluded.site_surveyed,unified_register=excluded.unified_register,
      works_with_count=excluded.works_with_count,update_status=excluded.update_status,pending_changes=excluded.pending_changes,
      verified_at=excluded.verified_at,card=excluded.card,refreshed_at=excluded.refreshed_at`);
  return true;
}

import { SECTION_KINDS, type SectionKind } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import { isUuid } from '../../common/actor-transaction.js';
import type { Database } from '../../database/database.module.js';

export type ExactProfileRevisionMap = Record<SectionKind, string>;
export type VerifiedProfileRevisionMap = Record<SectionKind, string | null>;
export type ProfileGraphIssue = { kind: SectionKind; path: string; code: string };
export type ProfileRevisionGraphValidation = { valid: boolean; issues: ProfileGraphIssue[] };
export type ProfilePublicationSubset = {
  publishKinds: SectionKind[];
  retainKinds: SectionKind[];
  /** Non-null only for a fully scoped, coherent seven-revision publication graph. */
  revisions: ExactProfileRevisionMap | null;
  /** Fatal input/graph errors only. Normal dependency deferral is represented by retainKinds. */
  issues: ProfileGraphIssue[];
};

type FactRow = {
  entity: 'revision' | 'site' | 'product' | 'certificate' | 'product_certificate' | 'equipment' | 'equipment_product';
  revisionId: string;
  kind: SectionKind;
  rowId: string | null;
  identityId: string | null;
  targetId: string | null;
  position: number | null;
  scopeValid: boolean;
  usable: boolean;
};
type Item = { id: string; identityId: string; targetId: string | null; position: number; scopeValid: boolean };
type RevisionFacts = {
  kind: SectionKind;
  sites: Item[];
  products: Item[];
  certificates: Item[];
  equipment: Item[];
  heldCertificates: Set<string>;
  productCertificates: Map<string, string[]>;
  equipmentProducts: Map<string, string[]>;
};
type Scope = { profileId: string; organizationId: string };
const issue = (kind: SectionKind, path: string, code: string): ProfileGraphIssue => ({ kind, path, code });
const uniqueIssues = (issues: ProfileGraphIssue[]) => [
  ...new Map(issues.map((item) => [`${item.kind}:${item.path}:${item.code}`, item])).values(),
];
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const orderedItems = (items: Item[]) => items.sort((a, b) => a.position - b.position || compareIds(a.id, b.id));

function normalizeMap(input: ExactProfileRevisionMap | VerifiedProfileRevisionMap, nullable: boolean) {
  const result = {} as VerifiedProfileRevisionMap;
  const issues: ProfileGraphIssue[] = [];
  if (
    !input ||
    typeof input !== 'object' ||
    Object.keys(input).some((key) => !SECTION_KINDS.includes(key as SectionKind))
  )
    issues.push(issue('main_information', '', 'revision_scope_invalid'));
  for (const kind of SECTION_KINDS) {
    const value = input?.[kind];
    if (value === null && nullable) result[kind] = null;
    else if (typeof value === 'string' && isUuid(value)) result[kind] = value.toLowerCase();
    else {
      result[kind] = null;
      issues.push(issue(kind, '', 'revision_scope_invalid'));
    }
  }
  return { revisions: result, issues };
}

/** One scoped statement collects only the explicitly supplied revisions and their reference facts. */
async function loadFacts(tx: Database, scope: Scope, revisionIds: string[]): Promise<Map<string, RevisionFacts>> {
  const { rows } = await tx.execute<FactRow>(sql`
    with scoped as (
      select r.id, s.kind from section_revision r join profile_section s
        on s.id=r.profile_section_id and s.organization_id=r.organization_id
      where s.profile_id=${scope.profileId} and s.organization_id=${scope.organizationId}
        and r.id=any(${sql.param([...new Set(revisionIds)])}::uuid[])
    )
    select 'revision'::text as entity, r.id as "revisionId", r.kind,
      null::uuid as "rowId", null::uuid as "identityId", null::uuid as "targetId",
      null::integer as position, true as "scopeValid", true as usable from scoped r
    union all
    select 'site', r.id, r.kind, s.id, s.identity_id, null::uuid, s.position_in_list, i.id is not null, true
      from scoped r join main_information m on m.section_revision_id=r.id and m.organization_id=${scope.organizationId}
      join production_site s on s.main_information_id=m.id and s.organization_id=m.organization_id
      left join production_site_identity i on i.id=s.identity_id and i.organization_id=s.organization_id and i.profile_id=${scope.profileId}
    union all
    select 'product', r.id, r.kind, p.id, p.identity_id, p.production_site_identity_id, p.position_in_list, i.id is not null, true
      from scoped r join product_line p on p.section_revision_id=r.id and p.organization_id=${scope.organizationId}
      left join product_line_identity i on i.id=p.identity_id and i.organization_id=p.organization_id and i.profile_id=${scope.profileId}
    union all
    select 'certificate', r.id, r.kind, c.id, c.identity_id, null::uuid, c.position_in_list, i.id is not null,
      coalesce(c."group"='product' and not c.not_held,false)
      from scoped r join certificate c on c.section_revision_id=r.id and c.organization_id=${scope.organizationId}
      left join certificate_identity i on i.id=c.identity_id and i.organization_id=c.organization_id and i.profile_id=${scope.profileId}
    union all
    select 'product_certificate', r.id, r.kind, p.id, null::uuid, l.certificate_identity_id, p.position_in_list, true, true
      from scoped r join product_line p on p.section_revision_id=r.id and p.organization_id=${scope.organizationId}
      join product_line_certificate l on l.product_line_id=p.id and l.organization_id=p.organization_id
    union all
    select 'equipment', r.id, r.kind, e.id, null::uuid, null::uuid, e.position_in_list, true, true
      from scoped r join equipment_item e on e.section_revision_id=r.id and e.organization_id=${scope.organizationId}
    union all
    select 'equipment_product', r.id, r.kind, e.id, null::uuid, l.product_line_identity_id, e.position_in_list, true, true
      from scoped r join equipment_item e on e.section_revision_id=r.id and e.organization_id=${scope.organizationId}
      join equipment_product_line l on l.equipment_item_id=e.id and l.organization_id=e.organization_id`);
  const facts = new Map<string, RevisionFacts>();
  for (const row of rows)
    if (row.entity === 'revision')
      facts.set(row.revisionId, {
        kind: row.kind,
        sites: [],
        products: [],
        certificates: [],
        equipment: [],
        heldCertificates: new Set(),
        productCertificates: new Map(),
        equipmentProducts: new Map(),
      });
  for (const row of rows) {
    const revision = facts.get(row.revisionId);
    if (!revision || row.entity === 'revision' || !row.rowId) continue;
    if (row.entity === 'product_certificate' || row.entity === 'equipment_product') {
      const links = row.entity === 'product_certificate' ? revision.productCertificates : revision.equipmentProducts;
      const targets = links.get(row.rowId) ?? [];
      if (row.targetId) targets.push(row.targetId);
      links.set(row.rowId, targets);
    } else {
      const item: Item = {
        id: row.rowId,
        identityId: row.identityId ?? '',
        targetId: row.targetId,
        position: row.position ?? 0,
        scopeValid: row.scopeValid,
      };
      const items =
        row.entity === 'site'
          ? revision.sites
          : row.entity === 'product'
            ? revision.products
            : row.entity === 'certificate'
              ? revision.certificates
              : revision.equipment;
      items.push(item);
      if (row.entity === 'certificate' && row.scopeValid && row.usable && row.identityId)
        revision.heldCertificates.add(row.identityId);
    }
  }
  for (const revision of facts.values()) {
    for (const items of [revision.sites, revision.products, revision.certificates, revision.equipment])
      orderedItems(items);
    for (const links of [revision.productCertificates, revision.equipmentProducts])
      for (const ids of links.values()) ids.sort(compareIds);
  }
  return facts;
}

function scopedMapIssues(revisions: VerifiedProfileRevisionMap, facts: Map<string, RevisionFacts>) {
  return SECTION_KINDS.flatMap((kind) => {
    const revisionId = revisions[kind];
    return revisionId !== null && facts.get(revisionId)?.kind !== kind
      ? [issue(kind, '', 'revision_scope_invalid')]
      : [];
  });
}

/** Local facts and each of the at most twelve exact revision-pair constraints are computed once. */
function graphEvaluator(facts: Map<string, RevisionFacts>) {
  const local = new Map<string, ProfileGraphIssue[]>();
  const pairs = new Map<string, ProfileGraphIssue[]>();
  for (const [id, revision] of facts) {
    const issues: ProfileGraphIssue[] = [];
    revision.sites.forEach((site, index) => {
      if (!site.scopeValid)
        issues.push(issue('main_information', `productionSites.${index}.identityId`, 'site_identity_scope_invalid'));
    });
    revision.products.forEach((product, index) => {
      if (!product.scopeValid)
        issues.push(issue('products', `products.${index}.identityId`, 'product_identity_scope_invalid'));
    });
    revision.certificates.forEach((certificate, index) => {
      if (!certificate.scopeValid)
        issues.push(issue('certificates', `certificates.${index}.identityId`, 'certificate_identity_scope_invalid'));
    });
    local.set(id, issues);
  }
  const pair = (kind: 'sites' | 'certificates' | 'products', from: string, to: string) => {
    const key = `${kind}:${from}:${to}`;
    const cached = pairs.get(key);
    if (cached) return cached;
    const source = facts.get(from)!;
    const target = facts.get(to)!;
    const issues: ProfileGraphIssue[] = [];
    if (kind === 'sites') {
      const available = new Set(target.sites.filter((site) => site.scopeValid).map((site) => site.identityId));
      source.products.forEach((product, index) => {
        if (product.targetId !== null && !available.has(product.targetId))
          issues.push(issue('products', `products.${index}.productionSiteIdentityId`, 'site_not_in_revision_graph'));
      });
    } else if (kind === 'certificates') {
      source.products.forEach((product, index) => {
        for (const id of source.productCertificates.get(product.id) ?? [])
          if (!target.heldCertificates.has(id))
            issues.push(
              issue('products', `products.${index}.certificateIdentityIds`, 'certificate_not_in_revision_graph'),
            );
      });
    } else {
      const available = new Set(
        target.products.filter((product) => product.scopeValid).map((product) => product.identityId),
      );
      source.equipment.forEach((equipment, index) => {
        for (const id of source.equipmentProducts.get(equipment.id) ?? [])
          if (!available.has(id))
            issues.push(issue('production', `equipment.${index}.productIdentityIds`, 'product_not_in_revision_graph'));
      });
    }
    pairs.set(key, issues);
    return issues;
  };
  const constraints = (revisions: ExactProfileRevisionMap) => [
    ...SECTION_KINDS.map((kind) => local.get(revisions[kind])!),
    pair('sites', revisions.products, revisions.main_information),
    pair('certificates', revisions.products, revisions.certificates),
    pair('products', revisions.production, revisions.products),
  ];
  return {
    valid: (revisions: ExactProfileRevisionMap) => constraints(revisions).every((issues) => issues.length === 0),
    issues: (revisions: ExactProfileRevisionMap) => constraints(revisions).flat(),
  };
}

/** Caller supplies and locks the trusted exact map; no current pointers, latest revisions, or business completeness. */
export async function validateProfileRevisionGraph(
  tx: Database,
  input: Scope & { revisions: ExactProfileRevisionMap },
): Promise<ProfileRevisionGraphValidation> {
  const parsed = normalizeMap(input.revisions, false);
  if (parsed.issues.length) return { valid: false, issues: parsed.issues };
  const revisions = parsed.revisions as ExactProfileRevisionMap;
  const facts = await loadFacts(tx, input, Object.values(revisions));
  const scopeIssues = scopedMapIssues(revisions, facts);
  if (scopeIssues.length) return { valid: false, issues: scopeIssues };
  const issues = uniqueIssues(graphEvaluator(facts).issues(revisions));
  return { valid: issues.length === 0, issues };
}

const kindsForMask = (mask: number) => SECTION_KINDS.filter((_, index) => (mask & (1 << index)) !== 0);
function preferredTie(mask: number, previous: number) {
  for (let index = 0; index < SECTION_KINDS.length; index++) {
    const bit = 1 << index;
    if ((mask & bit) !== (previous & bit)) return (mask & bit) !== 0;
  }
  return false;
}

/**
 * Selects a maximum-cardinality coherent accepted subset, leaving SME outcomes and all pointers untouched.
 * Caller derives acceptedKinds from exact decisions and supplies verified baselines; file/state gates and
 * transaction locks remain its responsibility. This helper neither reads nor infers review decisions.
 */
export async function selectProfilePublicationSubset(
  tx: Database,
  input: Scope & {
    candidates: ExactProfileRevisionMap;
    verified: VerifiedProfileRevisionMap;
    acceptedKinds: readonly SectionKind[];
  },
): Promise<ProfilePublicationSubset> {
  const accepted = new Set(input.acceptedKinds);
  const allAccepted = SECTION_KINDS.filter((kind) => accepted.has(kind));
  const none = (issues: ProfileGraphIssue[] = []): ProfilePublicationSubset => ({
    publishKinds: [],
    retainKinds: allAccepted,
    revisions: null,
    issues: uniqueIssues(issues),
  });
  if (input.acceptedKinds.some((kind) => !SECTION_KINDS.includes(kind)))
    return none([issue('main_information', '', 'publication_input_invalid')]);
  const candidateInput = normalizeMap(input.candidates, false);
  const verifiedInput = normalizeMap(input.verified, true);
  if (candidateInput.issues.length || verifiedInput.issues.length)
    return none([...candidateInput.issues, ...verifiedInput.issues]);
  const candidates = candidateInput.revisions as ExactProfileRevisionMap;
  const verified = verifiedInput.revisions;
  const ids = [...Object.values(candidates), ...Object.values(verified).filter((id): id is string => id !== null)];
  const facts = await loadFacts(tx, input, ids);
  const scopeIssues = [...scopedMapIssues(candidates, facts), ...scopedMapIssues(verified, facts)];
  if (scopeIssues.length) return none(scopeIssues);
  const evaluator = graphEvaluator(facts);
  const completeBaseline = SECTION_KINDS.every((kind) => verified[kind] !== null);
  // Initial/Returned acceptance may be retained, but it never publishes a partial manufacturer graph.
  if (!completeBaseline) {
    if (allAccepted.length !== SECTION_KINDS.length) return none();
    const issues = evaluator.issues(candidates);
    return issues.length
      ? none(issues)
      : { publishKinds: [...SECTION_KINDS], retainKinds: [], revisions: { ...candidates }, issues: [] };
  }
  const acceptedMask = SECTION_KINDS.reduce((mask, kind, index) => mask | (accepted.has(kind) ? 1 << index : 0), 0);
  const mixed = (mask: number) =>
    Object.fromEntries(
      SECTION_KINDS.map((kind, index) => [kind, (mask & (1 << index)) !== 0 ? candidates[kind] : verified[kind]!]),
    ) as ExactProfileRevisionMap;
  let bestMask: number | null = null;
  let bestCount = -1;
  let selected: ExactProfileRevisionMap | null = null;
  for (let mask = 0; mask < 1 << SECTION_KINDS.length; mask++) {
    if ((mask & ~acceptedMask) !== 0) continue;
    const count = kindsForMask(mask).length;
    if (count < bestCount || (count === bestCount && bestMask !== null && !preferredTie(mask, bestMask))) continue;
    const revisions = mixed(mask);
    if (!evaluator.valid(revisions)) continue;
    bestMask = mask;
    bestCount = count;
    selected = revisions;
  }
  if (bestMask === null) return none(evaluator.issues(mixed(acceptedMask)));
  const publishKinds = kindsForMask(bestMask);
  return {
    publishKinds,
    retainKinds: allAccepted.filter((kind) => !publishKinds.includes(kind)),
    revisions: selected,
    issues: [],
  };
}

import { can, type DataClass, type FilePurpose } from '@imbc/contracts';
import { sql } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import type { AuthContext } from '../auth/auth.types.js';
import { orgChartSampleReadRule } from './org-chart-sample.rules.js';
import { manufacturerFileOwners } from './file-owner.js';

/** Allowed selection, not just a boolean: a frozen owner must never fall back to the global latest version. */
export type FileReadDecision =
  { allowed: false } | { allowed: true; versions: 'latest' } | { allowed: true; versions: readonly string[] };

/**
 * Право прочитать файл — то же, что у записи, которой он принадлежит (GEN-09): правило по назначению файла.
 * `tx` — единый снимок чтения для записи-владельца и выбора разрешённой версии.
 */
export type FileReadRule = (ctx: {
  tx: Database;
  auth: AuthContext;
  file: { id: string; organizationId: string | null; purpose: FilePurpose; dataClass: DataClass };
}) => Promise<FileReadDecision>;

/**
 * Own manufacturer files include unattached upload previews. SME/director require a saved owner, including
 * Draft; working owners permit latest, frozen owners only their captured version IDs (GEN-09, DATA-07).
 * A future frozen-section DTO requests its snapshot version explicitly; this generic own-file route is a preview.
 * No submitted_at cutoff: a later scan or replacement cannot create evidence for an already frozen revision.
 */
export const manufacturerFileRule: FileReadRule = async ({ tx, auth, file }) => {
  if (file.organizationId === null || file.dataClass !== 'b_manufacturer') return { allowed: false };
  const scope = can(auth.user.role, 'profile.read');
  if (scope === 'own')
    return file.organizationId === auth.user.organizationId
      ? { allowed: true, versions: 'latest' }
      : { allowed: false };
  if (scope !== 'all') return { allowed: false };

  const owners = await manufacturerFileOwners(tx, { ...file, organizationId: file.organizationId });
  if (owners.some((owner) => owner.state === 'working' && owner.submittedAt === null))
    return { allowed: true, versions: 'latest' };
  if (owners.length === 0) return { allowed: false };
  const { rows } = await tx.execute<{ id: string }>(sql`
    select distinct v.file_version_id as id from revision_file_version v
    where v.section_revision_id = any(${sql.param(owners.map((owner) => owner.sectionRevisionId))}::uuid[])
      and v.organization_id = ${file.organizationId} and v.file_object_id = ${file.id}`);
  return rows.length === 0 ? { allowed: false } : { allowed: true, versions: rows.map((row) => row.id) };
};

/** Назначение, правило которого ещё не построено своим этапом: файл не читает никто. */
export const denyAll: FileReadRule = async () => ({ allowed: false });

/**
 * Правило на каждое из 15 назначений `file_purpose`; по умолчанию — отказ. `organisation_chart_sample` —
 * `orgChartSampleReadRule` (ADM-11, MAN-19, `org-chart-sample.rules.ts`); свои правила заменят этапы 5–8 —
 * отчёты IMBC, оператора, AGAR/CDP и выгрузки.
 */
export const FILE_READ_RULES: Record<FilePurpose, FileReadRule> = {
  organisation_chart: manufacturerFileRule,
  cv: manufacturerFileRule,
  unified_register_extract: manufacturerFileRule,
  conformity_certificate: manufacturerFileRule,
  production_photo: manufacturerFileRule,
  certificate_file: manufacturerFileRule,
  document_file: manufacturerFileRule,
  site_survey_report: denyAll,
  due_diligence_report: denyAll,
  enhanced_due_diligence_report: denyAll,
  operator_visit_file: denyAll,
  technical_requirements: denyAll,
  agar_cdp_report: denyAll,
  organisation_chart_sample: orgChartSampleReadRule,
  export: denyAll,
};

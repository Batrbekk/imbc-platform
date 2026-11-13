import { can, type FilePurpose } from '@imbc/contracts';
import { eq } from 'drizzle-orm';
import type { Database } from '../../database/database.module.js';
import { orgChartSample } from '../../database/schema/index.js';
import type { AuthContext } from '../auth/auth.types.js';

/**
 * Право прочитать файл — то же, что у записи, которой он принадлежит (GEN-09): правило по назначению файла.
 * `tx` — для правил, которым нужна запись-владелец (этап 3: редакция профиля, этап 6: верифицированная).
 */
export type FileReadRule = (ctx: {
  tx: Database;
  auth: AuthContext;
  file: { id: string; organizationId: string | null; purpose: FilePurpose };
}) => Promise<boolean>;

/**
 * Файл секции профиля производителя (класс `b_manufacturer`): `profile.read` — `all` (SME, директор) или `own`
 * и файл своей организации (производитель). Администратор их не читает (ADM-06); оператор и наблюдатель — с
 * этапа 6, по верифицированной редакции. Этап 3 уточняет правило по редакции-владельцу (расхождение 11 плана).
 */
export const manufacturerFileRule: FileReadRule = async ({ auth, file }) => {
  const scope = can(auth.user.role, 'profile.read');
  if (scope === 'all') return true;
  return scope === 'own' && file.organizationId !== null && file.organizationId === auth.user.organizationId;
};

/** Назначение, правило которого ещё не построено своим этапом: файл не читает никто. */
export const denyAll: FileReadRule = async () => false;

/**
 * Образец оргструктуры (ADM-11, MAN-19, расхождение 2 плана этапа 2): администратор и директор
 * (`reference.read`) читают любой образец; производитель (`profile.edit` — `own`) — только текущий: строка
 * `org_chart_sample` этого файла с `is_current`. Прежний образец, образец на проверке и отклонённый ему закрыты;
 * SME, оператору и наблюдателю — закрыт любой.
 */
export const orgChartSampleReadRule: FileReadRule = async ({ tx, auth, file }) => {
  if (can(auth.user.role, 'reference.read')) return true;
  if (can(auth.user.role, 'profile.edit') !== 'own') return false;
  const [sample] = await tx
    .select({ isCurrent: orgChartSample.isCurrent })
    .from(orgChartSample)
    .where(eq(orgChartSample.fileObjectId, file.id));
  return sample?.isCurrent === true;
};

/**
 * Правило на каждое из 15 назначений `file_purpose`; по умолчанию — отказ. `organisation_chart_sample` —
 * `orgChartSampleReadRule` (ADM-11, MAN-19); свои правила заменят этапы 5–8 — отчёты IMBC, оператора,
 * AGAR/CDP и выгрузки.
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

import {
  ACCOUNT_STATES,
  CAPACITY_UNITS,
  COMMODITY_GROUPS,
  CONTACT_ROLES,
  DOCUMENT_STATUSES,
  LOCALES,
  MARK_STATES,
  ORGANIZATION_TYPES,
  PREFILL_FIELDS,
  PREFILL_SOURCES,
  PROFILE_SECTIONS,
  PROFILE_STATUSES,
  PROFILE_TIERS,
  ROLES,
  UPDATE_STATUSES,
} from '@imbc/contracts';
import { pgEnum } from 'drizzle-orm/pg-core';

export const organizationType = pgEnum('organization_type', ORGANIZATION_TYPES);
export const role = pgEnum('role', ROLES);
export const accountState = pgEnum('account_state', ACCOUNT_STATES);
export const profileStatus = pgEnum('profile_status', PROFILE_STATUSES);
export const updateStatus = pgEnum('update_status', UPDATE_STATUSES);
export const profileTier = pgEnum('profile_tier', PROFILE_TIERS);
export const profileSection = pgEnum('profile_section', PROFILE_SECTIONS);
export const documentStatus = pgEnum('document_status', DOCUMENT_STATUSES);
export const commodityGroup = pgEnum('commodity_group', COMMODITY_GROUPS);
export const contactRole = pgEnum('contact_role', CONTACT_ROLES);
export const capacityUnit = pgEnum('capacity_unit', CAPACITY_UNITS);
export const markState = pgEnum('mark_state', MARK_STATES);
export const locale = pgEnum('locale', LOCALES);

export const revisionState = pgEnum('revision_state', ['working', 'submitted', 'verified', 'rejected', 'superseded']);
export const decision = pgEnum('decision', ['verified', 'rejected']);
export const scanState = pgEnum('scan_state', ['pending', 'clean', 'infected', 'type_mismatch']);
export const ddResult = pgEnum('dd_result', ['no_issues', 'findings']);
export const requestState = pgEnum('request_state', ['open', 'closed']);
export const exportFormat = pgEnum('export_format', ['xlsx', 'csv']);
export const subscriptionPeriod = pgEnum('subscription_period', ['daily', 'weekly', 'monthly']);
export const runResult = pgEnum('run_result', ['success', 'failure']);
export const snapshotPeriod = pgEnum('snapshot_period', ['week', 'month']);
export const valueSource = pgEnum('value_source', ['manual', 'migration', 'e_ondiris']);

// Чтение Adata (EXT-01, IMBC-07, MAN-07). Коды коннекторов — из DBML.
export const connectorCode = pgEnum('connector_code', ['adata', 'e_ondiris', 'accounting', 'legal_entity_registry']);
/** Повод попытки (IMBC-07, IMBC-13); в срезе пишется только profile_created. */
export const externalCheckTrigger = pgEnum('external_check_trigger', [
  'profile_created',
  'quarterly',
  'sme_rerun',
  'import',
]);
export const externalCheckState = pgEnum('external_check_state', [
  'queued',
  'polling',
  'received',
  'unavailable',
  'not_configured',
  'quota_exhausted',
]);
export const prefillSource = pgEnum('prefill_source', PREFILL_SOURCES);
export const prefillField = pgEnum('prefill_field', PREFILL_FIELDS);

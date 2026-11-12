-- IMBC platform schema, Phase 1.
-- Generated from docs/data-model/imbc-platform.dbml.
-- The eight partial unique indexes replace plain indexes from the DBML export.
-- A partial index is the form those rules can take in PostgreSQL.
-- Primary keys are uuid. The application assigns UUIDv7.
-- audit_entry is append-only. Partition it by month when the table is created for production.

CREATE TYPE "organization_type" AS ENUM (
  'manufacturer',
  'operator',
  'observer',
  'imbc'
);

CREATE TYPE "account_role" AS ENUM (
  'manufacturer',
  'expert',
  'administrator',
  'director',
  'operator',
  'observer'
);

CREATE TYPE "account_state" AS ENUM (
  'invited',
  'active',
  'inactive',
  'blocked'
);

CREATE TYPE "language_code" AS ENUM (
  'kk',
  'en',
  'ru'
);

CREATE TYPE "profile_status" AS ENUM (
  'draft',
  'submitted',
  'under_review',
  'verified',
  'returned'
);

CREATE TYPE "section_kind" AS ENUM (
  'main_information',
  'contacts',
  'personnel',
  'shareholders',
  'products',
  'production',
  'certificates',
  'documents'
);

CREATE TYPE "revision_state" AS ENUM (
  'working',
  'submitted',
  'verified',
  'rejected'
);

CREATE TYPE "revision_origin" AS ENUM (
  'manufacturer',
  'migration'
);

CREATE TYPE "record_status" AS ENUM (
  'uploaded',
  'under_review',
  'verified',
  'rejected',
  'expired',
  'missing'
);

CREATE TYPE "scan_state" AS ENUM (
  'pending',
  'passed',
  'rejected'
);

CREATE TYPE "capacity_unit" AS ENUM (
  'pieces',
  'tonnes',
  'metres',
  'sets'
);

CREATE TYPE "product_line_source" AS ENUM (
  'manual',
  'e_ondiris',
  'migration'
);

CREATE TYPE "update_freshness" AS ENUM (
  'active',
  'outdated',
  'unresponsive'
);

CREATE TYPE "confirmation_kind" AS ENUM (
  'quarter',
  'section'
);

CREATE TYPE "update_event_kind" AS ENUM (
  'quarter_notice',
  'second_notice',
  'unresponsive_notice'
);

CREATE TYPE "survey_result" AS ENUM (
  'yes',
  'no'
);

CREATE TYPE "survey_source" AS ENUM (
  'migration',
  'expert'
);

CREATE TYPE "diligence_result" AS ENUM (
  'green',
  'amber',
  'red'
);

CREATE TYPE "diligence_mark" AS ENUM (
  'clear',
  'finding',
  'shown_only',
  'no_answer'
);

CREATE TYPE "enhanced_diligence" AS ENUM (
  'done',
  'not_done'
);

CREATE TYPE "mark_state" AS ENUM (
  'waiting',
  'validated',
  'rejected'
);

CREATE TYPE "request_status" AS ENUM (
  'open',
  'closed'
);

CREATE TYPE "subscription_period" AS ENUM (
  'daily',
  'weekly',
  'monthly'
);

CREATE TYPE "export_format" AS ENUM (
  'xlsx',
  'csv'
);

CREATE TYPE "run_result" AS ENUM (
  'success',
  'failure'
);

CREATE TYPE "subscription_state" AS ENUM (
  'active',
  'paused'
);

CREATE TYPE "pause_reason" AS ENUM (
  'user',
  'inactive_account'
);

CREATE TYPE "data_class" AS ENUM (
  'a_register',
  'b_manufacturer',
  'c_imbc',
  'd_operator',
  'e_administration',
  'f_forecast'
);

CREATE TYPE "file_purpose" AS ENUM (
  'organisation_chart',
  'cv',
  'unified_register_extract',
  'conformity_certificate',
  'production_photo',
  'certificate_file',
  'document_file',
  'site_survey_report',
  'due_diligence_report',
  'enhanced_due_diligence_report',
  'operator_visit_file',
  'technical_requirements',
  'agar_cdp_report',
  'organisation_chart_sample',
  'export'
);

CREATE TYPE "technical_requirements_kind" AS ENUM (
  'str',
  'ktre'
);

CREATE TYPE "profile_tier" AS ENUM (
  'tier_1',
  'tier_2'
);

CREATE TYPE "agar_cdp_kind" AS ENUM (
  'agar',
  'cdp'
);

CREATE TYPE "agar_cdp_status" AS ENUM (
  'requested',
  'shortlisted',
  'visit_done',
  'technical_assessment_done',
  'report_issued',
  'recommendations_in_progress',
  'recommendation_issued'
);

CREATE TYPE "snapshot_period" AS ENUM (
  'week',
  'month'
);

CREATE TYPE "snapshot_dimension" AS ENUM (
  'profile_status',
  'update_status',
  'region',
  'commodity_group'
);

CREATE TYPE "catalog_facet" AS ENUM (
  'commodity_group',
  'commodity_type',
  'certificate_type',
  'tn_ved',
  'kpved',
  'oked'
);

CREATE TYPE "import_outcome" AS ENUM (
  'imported',
  'flagged',
  'rejected'
);

CREATE TYPE "connector_code" AS ENUM (
  'adata',
  'e_ondiris',
  'accounting',
  'legal_entity_registry'
);

CREATE TABLE "organization" (
  "id" uuid PRIMARY KEY,
  "type" organization_type NOT NULL,
  "name" text NOT NULL,
  "bin" text,
  "is_major_operator" boolean NOT NULL DEFAULT false,
  "notification_mailbox" text,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "user_account" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "email" text UNIQUE NOT NULL,
  "name" text,
  "role" account_role NOT NULL,
  "state" account_state NOT NULL DEFAULT 'invited',
  "language" language_code NOT NULL DEFAULT 'kk',
  "idp_subject" text UNIQUE,
  "auth_version" int NOT NULL DEFAULT 1,
  "last_sign_in_at" timestamptz,
  "failed_attempt_count" int NOT NULL DEFAULT 0,
  "locked_until" timestamptz,
  "responsibility_accepted_at" timestamptz,
  "platform_terms_accepted_at" timestamptz,
  "personal_data_accepted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "user_session" (
  "id" uuid PRIMARY KEY,
  "user_account_id" uuid NOT NULL,
  "auth_version" int NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "last_seen_at" timestamptz NOT NULL,
  "idle_expires_at" timestamptz NOT NULL,
  "absolute_expires_at" timestamptz NOT NULL,
  "ended_at" timestamptz
);

CREATE TABLE "trusted_device" (
  "id" uuid PRIMARY KEY,
  "user_account_id" uuid NOT NULL,
  "identifier_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "responsibility_acceptance" (
  "id" uuid PRIMARY KEY,
  "user_account_id" uuid NOT NULL,
  "text_version" text NOT NULL,
  "accepted_at" timestamptz NOT NULL
);

CREATE TABLE "api_access" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "issued_by" uuid NOT NULL,
  "issued_at" timestamptz NOT NULL,
  "revoked_by" uuid,
  "revoked_at" timestamptz
);

CREATE TABLE "manufacturer_profile" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid UNIQUE NOT NULL,
  "status" profile_status NOT NULL DEFAULT 'draft',
  "assigned_expert_id" uuid,
  "registered_at" timestamptz,
  "verified_at" timestamptz,
  "completeness_percent" numeric(5,2),
  "heard_about_us" text,
  "migrated" boolean NOT NULL DEFAULT false,
  "bin_check_digit_valid" boolean NOT NULL DEFAULT true,
  "migration_flags" jsonb,
  "accuracy_confirmed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "profile_section" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "kind" section_kind NOT NULL,
  "verified_revision_id" uuid,
  "pending_revision_id" uuid,
  "completeness_percent" numeric(5,2)
);

CREATE TABLE "section_revision" (
  "id" uuid PRIMARY KEY,
  "profile_section_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "revision_number" int NOT NULL,
  "state" revision_state NOT NULL,
  "origin" revision_origin NOT NULL DEFAULT 'manufacturer',
  "author_id" uuid,
  "completeness_percent" numeric(5,2),
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "submitted_at" timestamptz
);

CREATE TABLE "submission_requirement" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "dictionary_entry_id" uuid NOT NULL,
  "captured_at" timestamptz NOT NULL
);

CREATE TABLE "main_information" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid UNIQUE NOT NULL,
  "organization_id" uuid NOT NULL,
  "name_en" text NOT NULL,
  "name_ru" text NOT NULL,
  "legal_form_id" uuid NOT NULL,
  "director_full_name" text,
  "state_registered_on" date,
  "website" text,
  "region_id" uuid NOT NULL,
  "city" text NOT NULL,
  "legal_address" text NOT NULL,
  "production_address" text NOT NULL,
  "company_phone" text NOT NULL,
  "contact_email" text,
  "registry_oked_code" text,
  "registry_oked_name" text,
  "unified_register_registered" boolean NOT NULL,
  "unified_register_first_inclusion_on" date,
  "unified_register_extract_id" uuid
);

CREATE TABLE "main_information_oked" (
  "id" uuid PRIMARY KEY,
  "main_information_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "oked_entry_id" uuid NOT NULL,
  "position" int NOT NULL
);

CREATE TABLE "contact" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "position" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "role_id" uuid NOT NULL,
  "is_focal_point" boolean NOT NULL DEFAULT false,
  "position_in_list" int NOT NULL
);

CREATE TABLE "personnel" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid UNIQUE NOT NULL,
  "organization_id" uuid NOT NULL,
  "managers_count" int NOT NULL,
  "office_staff_count" int NOT NULL,
  "production_workers_count" int NOT NULL,
  "non_kz_managers_count" int NOT NULL,
  "organisation_chart_id" uuid
);

CREATE TABLE "personnel_cv" (
  "id" uuid PRIMARY KEY,
  "personnel_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "file_object_id" uuid NOT NULL,
  "position_in_list" int NOT NULL
);

CREATE TABLE "shareholder" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "share_percent" numeric(5,2) NOT NULL,
  "citizenship_or_country" text NOT NULL,
  "position_in_list" int NOT NULL
);

CREATE TABLE "product_line_identity" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "product_line" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "identity_id" uuid NOT NULL,
  "name_en" text,
  "name_ru" text NOT NULL,
  "commodity_group_id" uuid NOT NULL,
  "commodity_type_id" uuid NOT NULL,
  "tn_ved_code" text NOT NULL,
  "kpved_code" text,
  "kpved_name" text,
  "enstru_code" text,
  "enstru_name" text,
  "capacity_quantity" numeric,
  "capacity_unit" capacity_unit,
  "capacity_text" text,
  "in_country_value_share" numeric(5,2),
  "localization_steps_done" int,
  "localization_steps_total" int,
  "e_ondiris_record_id" uuid,
  "unified_register_registration_number" text,
  "registry_legal_name" text,
  "registry_place_name" text,
  "registry_production_address" text,
  "registry_website" text,
  "registry_phone" text,
  "registry_email" text,
  "unified_register_active" boolean,
  "unified_register_included_on" date,
  "conformity_file_id" uuid,
  "source" product_line_source NOT NULL DEFAULT 'manual',
  "position_in_list" int NOT NULL
);

CREATE TABLE "production" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid UNIQUE NOT NULL,
  "organization_id" uuid NOT NULL,
  "area_sqm" numeric,
  "workshop_count" int,
  "utilisation_percent" numeric(5,2)
);

CREATE TABLE "production_process" (
  "production_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "process_entry_id" uuid NOT NULL,
  PRIMARY KEY ("production_id", "process_entry_id")
);

CREATE TABLE "production_photo" (
  "id" uuid PRIMARY KEY,
  "production_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "file_object_id" uuid NOT NULL,
  "position_in_list" int NOT NULL
);

CREATE TABLE "equipment_item" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "equipment_type_id" uuid NOT NULL,
  "quantity" int NOT NULL,
  "position_in_list" int NOT NULL
);

CREATE TABLE "equipment_product_line" (
  "equipment_item_id" uuid NOT NULL,
  "product_line_identity_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  PRIMARY KEY ("equipment_item_id", "product_line_identity_id")
);

CREATE TABLE "certificate" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "certificate_type_id" uuid NOT NULL,
  "custom_type_name" text,
  "number" text NOT NULL,
  "issuing_body" text NOT NULL,
  "issued_on" date NOT NULL,
  "expires_on" date,
  "status" record_status NOT NULL,
  "file_object_id" uuid
);

CREATE TABLE "document" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "document_type_id" uuid NOT NULL,
  "licence_not_required" boolean NOT NULL DEFAULT false,
  "status" record_status NOT NULL,
  "file_object_id" uuid
);

CREATE TABLE "file_object" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid,
  "purpose" file_purpose NOT NULL,
  "data_class" data_class NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "file_version" (
  "id" uuid PRIMARY KEY,
  "file_object_id" uuid NOT NULL,
  "version_number" int NOT NULL,
  "original_name" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "declared_media_type" text NOT NULL,
  "detected_media_type" text,
  "checksum" text NOT NULL,
  "scan_state" scan_state NOT NULL DEFAULT 'pending',
  "scanned_at" timestamptz,
  "uploaded_at" timestamptz NOT NULL DEFAULT (now()),
  "uploaded_by" uuid,
  "storage_key" text NOT NULL
);

CREATE TABLE "org_chart_sample" (
  "id" uuid PRIMARY KEY,
  "file_object_id" uuid NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "uploaded_at" timestamptz NOT NULL,
  "is_current" boolean NOT NULL DEFAULT true
);

CREATE TABLE "review_assignment" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "expert_id" uuid,
  "assigned_by" uuid,
  "received_at" timestamptz NOT NULL,
  "assigned_at" timestamptz,
  "closed_at" timestamptz
);

CREATE TABLE "review_decision" (
  "id" uuid PRIMARY KEY,
  "review_assignment_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "expert_id" uuid NOT NULL,
  "section_revision_id" uuid,
  "certificate_id" uuid,
  "document_id" uuid,
  "file_version_id" uuid,
  "outcome" record_status NOT NULL,
  "comment" text,
  "decided_at" timestamptz NOT NULL
);

CREATE TABLE "update_status" (
  "profile_id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "state" update_freshness NOT NULL DEFAULT 'active',
  "anchor_on" date NOT NULL,
  "current_quarter_on" date NOT NULL,
  "missed_quarters" int NOT NULL DEFAULT 0,
  "response_due_on" date,
  "outdated_by_certificate" boolean NOT NULL DEFAULT false,
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "update_confirmation" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "kind" confirmation_kind NOT NULL,
  "section_kind" section_kind,
  "confirmed_by" uuid NOT NULL,
  "confirmed_at" timestamptz NOT NULL
);

CREATE TABLE "update_status_event" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "quarter_on" date NOT NULL,
  "kind" update_event_kind NOT NULL,
  "occurred_at" timestamptz NOT NULL
);

CREATE TABLE "certificate_expiry_notice" (
  "id" uuid PRIMARY KEY,
  "file_version_id" uuid NOT NULL,
  "threshold_days" int NOT NULL,
  "sent_at" timestamptz NOT NULL
);

CREATE TABLE "site_survey_record" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "visit_started_on" date NOT NULL,
  "visit_ended_on" date,
  "result" survey_result NOT NULL,
  "file_object_id" uuid,
  "expires_on" date,
  "comment" text,
  "source" survey_source NOT NULL,
  "recorded_by" uuid,
  "recorded_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "due_diligence_record" (
  "profile_id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "checked_on" date NOT NULL,
  "adata_result" diligence_result,
  "result" diligence_result NOT NULL,
  "comment" text,
  "report_file_id" uuid,
  "overridden_by" uuid,
  "overridden_at" timestamptz,
  "enhanced" enhanced_diligence NOT NULL DEFAULT 'not_done',
  "enhanced_comment" text,
  "enhanced_report_file_id" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "due_diligence_check" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "group_name" text NOT NULL,
  "subject_name" text NOT NULL,
  "check_name" text NOT NULL,
  "adata_value" text,
  "mark" diligence_mark NOT NULL,
  "position" int NOT NULL
);

CREATE TABLE "external_check" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "connector" connector_code NOT NULL,
  "is_mock" boolean NOT NULL,
  "latest_attempt_id" uuid
);

CREATE TABLE "external_check_attempt" (
  "id" uuid PRIMARY KEY,
  "external_check_id" uuid NOT NULL,
  "requested_at" timestamptz NOT NULL,
  "value" text,
  "status" text NOT NULL,
  "source" text,
  "is_test_data" boolean NOT NULL DEFAULT false,
  "unavailable" boolean NOT NULL DEFAULT false
);

CREATE TABLE "e_ondiris_record" (
  "id" uuid PRIMARY KEY,
  "bin" text NOT NULL,
  "registration_number" text NOT NULL,
  "legal_name" text,
  "oked_code" text,
  "oked_name" text,
  "place_name" text,
  "production_address" text,
  "website" text,
  "phone" text,
  "email" text,
  "product_name" text,
  "production_capacity" text,
  "tn_ved_code" text,
  "kpved_code" text,
  "kpved_name" text,
  "enstru_code" text,
  "enstru_name" text,
  "in_country_value_share" numeric(5,2),
  "localization_level" text,
  "included_on" date,
  "active" boolean,
  "content_hash" text NOT NULL,
  "pulled_at" timestamptz NOT NULL
);

CREATE TABLE "imbc_note" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "author_id" uuid,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "imbc_legacy" (
  "profile_id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "eoi_email_sent" text,
  "eoi_receipt_confirmed" text,
  "source" text,
  "eoi_response" text,
  "eoi_response_summary" text,
  "ready_for_site_visit" text,
  "overall_ranking" text,
  "shortlisted_for_cdp_agar" text,
  "lc_lps" text,
  "priority" text,
  "year_added" text,
  "cdp_agar_status" text,
  "cdp_agar_execution" text,
  "general_comments" text,
  "folder_link" text,
  "e_ondiris_note" text
);

CREATE TABLE "site_survey_request" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "requested_by" uuid NOT NULL,
  "requested_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "agar_cdp_record" (
  "id" uuid PRIMARY KEY,
  "product_line_identity_id" uuid UNIQUE NOT NULL,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "kind" agar_cdp_kind NOT NULL,
  "status" agar_cdp_status NOT NULL,
  "report_file_id" uuid,
  "comment" text,
  "requested_by_manufacturer" boolean NOT NULL DEFAULT false,
  "recorded_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "works_with_mark" (
  "id" uuid PRIMARY KEY,
  "operator_organization_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "state" mark_state NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "works_with_mark_change" (
  "id" uuid PRIMARY KEY,
  "works_with_mark_id" uuid NOT NULL,
  "state" mark_state NOT NULL,
  "changed_by" uuid NOT NULL,
  "changed_at" timestamptz NOT NULL,
  "decided_by" uuid,
  "decided_at" timestamptz
);

CREATE TABLE "operator_visit_mark" (
  "id" uuid PRIMARY KEY,
  "operator_organization_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "visited_on" date NOT NULL,
  "file_object_id" uuid,
  "recorded_by" uuid NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT (now()),
  "decision" mark_state NOT NULL DEFAULT 'waiting',
  "decided_by" uuid,
  "decided_at" timestamptz
);

CREATE TABLE "operator_note" (
  "id" uuid PRIMARY KEY,
  "operator_organization_id" uuid NOT NULL,
  "profile_id" uuid NOT NULL,
  "author_id" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "deleted_at" timestamptz
);

CREATE TABLE "imbc_request" (
  "id" uuid PRIMARY KEY,
  "sender_user_id" uuid NOT NULL,
  "operator_organization_id" uuid NOT NULL,
  "profile_id" uuid,
  "subject" text NOT NULL,
  "message" text NOT NULL,
  "status" request_status NOT NULL DEFAULT 'open',
  "reply" text,
  "replied_by" uuid,
  "replied_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "operator_request" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "section_kind" section_kind,
  "free_text" text,
  "status" request_status NOT NULL DEFAULT 'open',
  "reply" text,
  "replied_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "operator_request_party" (
  "operator_request_id" uuid PRIMARY KEY,
  "operator_organization_id" uuid NOT NULL,
  "sender_user_id" uuid NOT NULL
);

CREATE TABLE "export_subscription" (
  "id" uuid PRIMARY KEY,
  "owner_user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "filters" jsonb NOT NULL,
  "format" export_format NOT NULL,
  "period" subscription_period NOT NULL,
  "state" subscription_state NOT NULL DEFAULT 'active',
  "pause_reason" pause_reason,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "export_file" (
  "id" uuid PRIMARY KEY,
  "owner_user_id" uuid NOT NULL,
  "file_object_id" uuid NOT NULL,
  "row_count" int,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "subscription_run" (
  "id" uuid PRIMARY KEY,
  "export_subscription_id" uuid NOT NULL,
  "ran_at" timestamptz NOT NULL,
  "result" run_result NOT NULL,
  "row_count" int,
  "export_file_id" uuid,
  "error" text
);

CREATE TABLE "nda_version" (
  "id" uuid PRIMARY KEY,
  "version_number" int UNIQUE NOT NULL,
  "body" text NOT NULL,
  "published_at" timestamptz NOT NULL,
  "published_by" uuid NOT NULL,
  "is_current" boolean NOT NULL DEFAULT false
);

CREATE TABLE "nda_acceptance" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "nda_version_id" uuid NOT NULL,
  "accepted_at" timestamptz NOT NULL,
  "ip_address" text NOT NULL
);

CREATE TABLE "forecast_version" (
  "id" uuid PRIMARY KEY,
  "imported_at" timestamptz NOT NULL,
  "imported_by" uuid NOT NULL,
  "published_at" timestamptz,
  "published_by" uuid,
  "is_current" boolean NOT NULL DEFAULT false
);

CREATE TABLE "forecast_import_issue" (
  "id" uuid PRIMARY KEY,
  "forecast_version_id" uuid NOT NULL,
  "row_number" int NOT NULL,
  "problem" text NOT NULL
);

CREATE TABLE "forecast_line" (
  "id" uuid PRIMARY KEY,
  "forecast_version_id" uuid NOT NULL,
  "row_number" int NOT NULL,
  "tn_ved_code" text NOT NULL,
  "commodity_group_id" uuid NOT NULL,
  "commodity_type_id" uuid NOT NULL,
  "description" text NOT NULL,
  "unit_of_measure" text NOT NULL,
  "total_quantity" numeric NOT NULL
);

CREATE TABLE "technical_requirements_file" (
  "id" uuid PRIMARY KEY,
  "commodity_group_id" uuid NOT NULL,
  "product_label" text NOT NULL,
  "kind" technical_requirements_kind NOT NULL,
  "file_object_id" uuid NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "uploaded_at" timestamptz NOT NULL,
  "removed_at" timestamptz
);

CREATE TABLE "audit_entry" (
  "id" uuid PRIMARY KEY,
  "occurred_at" timestamptz NOT NULL DEFAULT (now()),
  "user_account_id" uuid,
  "organization_id" uuid,
  "object_type" text NOT NULL,
  "object_id" uuid,
  "action" text NOT NULL,
  "diff" jsonb,
  "refused" boolean NOT NULL DEFAULT false
);

CREATE TABLE "activity_snapshot" (
  "id" uuid PRIMARY KEY,
  "period" snapshot_period NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "new_registrations" int NOT NULL,
  "taken_at" timestamptz NOT NULL
);

CREATE TABLE "activity_snapshot_count" (
  "id" uuid PRIMARY KEY,
  "activity_snapshot_id" uuid NOT NULL,
  "dimension" snapshot_dimension NOT NULL,
  "dimension_key" text NOT NULL,
  "manufacturer_count" int NOT NULL
);

CREATE TABLE "catalog_profile" (
  "profile_id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "bin" text NOT NULL,
  "name_en" text NOT NULL,
  "name_ru" text NOT NULL,
  "region_id" uuid NOT NULL,
  "headcount" int,
  "workshop_count" int,
  "utilisation_percent" numeric(5,2),
  "unified_register_registered" boolean NOT NULL,
  "site_surveyed" boolean NOT NULL,
  "site_surveyed_on" date,
  "current_site_survey_id" uuid,
  "update_status" update_freshness NOT NULL,
  "tier" profile_tier NOT NULL,
  "verified_at" timestamptz,
  "registered_at" timestamptz,
  "pending_changes" boolean NOT NULL,
  "works_with_major_count" int NOT NULL,
  "due_diligence_checked_on" date,
  "enhanced_due_diligence_done" boolean NOT NULL,
  "visible" boolean NOT NULL,
  "refreshed_at" timestamptz NOT NULL
);

CREATE TABLE "catalog_tier3_product" (
  "profile_id" uuid NOT NULL,
  "product_line_identity_id" uuid NOT NULL,
  PRIMARY KEY ("profile_id", "product_line_identity_id")
);

CREATE TABLE "catalog_profile_facet" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "facet" catalog_facet NOT NULL,
  "code" text NOT NULL,
  "dictionary_entry_id" uuid
);

CREATE TABLE "dictionary" (
  "id" uuid PRIMARY KEY,
  "code" text UNIQUE NOT NULL,
  "name" text NOT NULL
);

CREATE TABLE "dictionary_entry" (
  "id" uuid PRIMARY KEY,
  "dictionary_id" uuid NOT NULL,
  "code" text NOT NULL,
  "parent_entry_id" uuid,
  "mandatory" boolean,
  "custom_name_allowed" boolean NOT NULL DEFAULT false,
  "sort_order" int NOT NULL DEFAULT 0,
  "retired_at" timestamptz
);

CREATE TABLE "dictionary_entry_translation" (
  "dictionary_entry_id" uuid NOT NULL,
  "language" language_code NOT NULL,
  "name" text NOT NULL,
  PRIMARY KEY ("dictionary_entry_id", "language")
);

CREATE TABLE "notification_rule" (
  "id" uuid PRIMARY KEY,
  "code" text UNIQUE NOT NULL,
  "event" text NOT NULL,
  "recipient_rule" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true
);

CREATE TABLE "notification" (
  "id" uuid PRIMARY KEY,
  "rule_code" text NOT NULL,
  "recipient_email" text NOT NULL,
  "user_account_id" uuid,
  "language" language_code NOT NULL,
  "dedup_key" text UNIQUE NOT NULL,
  "related_object_type" text,
  "related_object_id" uuid,
  "sent_at" timestamptz NOT NULL
);

CREATE TABLE "policy_rule" (
  "id" uuid PRIMARY KEY,
  "role" account_role NOT NULL,
  "data_class" data_class NOT NULL,
  "action" text NOT NULL,
  "condition" text NOT NULL,
  "effect" text NOT NULL
);

CREATE TABLE "import_batch" (
  "id" uuid PRIMARY KEY,
  "source_filename" text NOT NULL,
  "trial" boolean NOT NULL DEFAULT true,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "started_by" uuid
);

CREATE TABLE "import_row" (
  "id" uuid PRIMARY KEY,
  "import_batch_id" uuid NOT NULL,
  "bin" text NOT NULL,
  "excel_row_number" int NOT NULL,
  "outcome" import_outcome NOT NULL,
  "reason" text,
  "raw" jsonb NOT NULL,
  "flags" jsonb
);

CREATE TABLE "import_resolution" (
  "id" uuid PRIMARY KEY,
  "import_row_id" uuid,
  "kind" text NOT NULL,
  "detail" text NOT NULL,
  "file_object_id" uuid,
  "resolved_at" timestamptz,
  "resolved_by" uuid
);

CREATE TABLE "migration_invitation_run" (
  "id" uuid PRIMARY KEY,
  "started_by" uuid NOT NULL,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "report" jsonb NOT NULL
);

CREATE UNIQUE INDEX ON "organization" ("bin");

-- One account on a manufacturer organisation. Role is the local condition a partial index can see.
CREATE UNIQUE INDEX "user_account_one_per_manufacturer" ON "user_account" ("organization_id") WHERE "role" = 'manufacturer';

CREATE UNIQUE INDEX ON "user_account" ("id", "organization_id");

CREATE UNIQUE INDEX ON "trusted_device" ("user_account_id", "identifier_hash");

-- One live pull-API key per operator organisation. Revoked keys stay.
CREATE UNIQUE INDEX "api_access_one_live_key" ON "api_access" ("organization_id") WHERE "revoked_at" IS NULL;

CREATE UNIQUE INDEX ON "manufacturer_profile" ("id", "organization_id");

CREATE UNIQUE INDEX ON "profile_section" ("profile_id", "kind");

CREATE UNIQUE INDEX ON "profile_section" ("id", "organization_id");

CREATE UNIQUE INDEX ON "section_revision" ("profile_section_id", "revision_number");

CREATE UNIQUE INDEX ON "section_revision" ("id", "organization_id");

-- One working revision per section. Submitted and verified revisions stay.
CREATE UNIQUE INDEX "section_revision_one_working" ON "section_revision" ("profile_section_id") WHERE "state" = 'working';

CREATE UNIQUE INDEX ON "submission_requirement" ("section_revision_id", "dictionary_entry_id");

CREATE UNIQUE INDEX ON "main_information" ("id", "organization_id");

CREATE UNIQUE INDEX ON "main_information" ("section_revision_id", "organization_id");

CREATE UNIQUE INDEX ON "main_information_oked" ("main_information_id", "oked_entry_id");

CREATE UNIQUE INDEX ON "contact" ("section_revision_id", "email");

CREATE UNIQUE INDEX ON "contact" ("section_revision_id", "phone");

-- Exactly one focal point on a contact revision.
CREATE UNIQUE INDEX "contact_one_focal_point" ON "contact" ("section_revision_id") WHERE "is_focal_point";

CREATE UNIQUE INDEX ON "personnel" ("id", "organization_id");

CREATE UNIQUE INDEX ON "product_line_identity" ("id", "organization_id");

CREATE INDEX ON "product_line" ("organization_id", "unified_register_registration_number");

CREATE INDEX ON "product_line" ("organization_id", "tn_ved_code");

CREATE UNIQUE INDEX ON "production" ("id", "organization_id");

CREATE UNIQUE INDEX ON "equipment_item" ("id", "organization_id");

CREATE UNIQUE INDEX ON "file_object" ("id", "organization_id");

CREATE UNIQUE INDEX ON "file_version" ("file_object_id", "version_number");

CREATE UNIQUE INDEX "org_chart_sample_one_current" ON "org_chart_sample" ("is_current") WHERE "is_current";

CREATE UNIQUE INDEX ON "update_status_event" ("profile_id", "quarter_on", "kind");

CREATE UNIQUE INDEX ON "certificate_expiry_notice" ("file_version_id", "threshold_days");

CREATE UNIQUE INDEX ON "due_diligence_check" ("profile_id", "position");

CREATE UNIQUE INDEX ON "external_check" ("profile_id", "connector");

CREATE UNIQUE INDEX ON "e_ondiris_record" ("bin", "registration_number");

CREATE INDEX ON "e_ondiris_record" ("bin");

CREATE UNIQUE INDEX ON "works_with_mark" ("operator_organization_id", "profile_id");

CREATE UNIQUE INDEX "nda_version_one_current" ON "nda_version" ("is_current") WHERE "is_current";

CREATE UNIQUE INDEX ON "nda_acceptance" ("profile_id", "nda_version_id");

CREATE UNIQUE INDEX "forecast_version_one_current" ON "forecast_version" ("is_current") WHERE "is_current";

CREATE UNIQUE INDEX ON "forecast_line" ("forecast_version_id", "row_number");

CREATE INDEX ON "forecast_line" ("forecast_version_id", "tn_ved_code");

-- One live STR and one live KTRE per product. Removed files stay.
CREATE UNIQUE INDEX "technical_requirements_file_one_live" ON "technical_requirements_file" ("commodity_group_id", "product_label", "kind") WHERE "removed_at" IS NULL;

CREATE UNIQUE INDEX ON "activity_snapshot" ("period", "period_start");

CREATE UNIQUE INDEX ON "activity_snapshot_count" ("activity_snapshot_id", "dimension", "dimension_key");

CREATE UNIQUE INDEX ON "catalog_profile_facet" ("profile_id", "facet", "code");

CREATE UNIQUE INDEX ON "dictionary_entry" ("dictionary_id", "code");

CREATE UNIQUE INDEX ON "policy_rule" ("role", "data_class", "action", "condition");

CREATE UNIQUE INDEX ON "import_row" ("import_batch_id", "excel_row_number");

COMMENT ON TABLE "organization" IS 'A manufacturer organisation has one profile and one account. An operator, observer, or IMBC organisation has one account per person.';

COMMENT ON COLUMN "organization"."id" IS 'UUIDv7';

COMMENT ON COLUMN "organization"."name" IS 'Registration name, or the name the administrator gives an operator, an observer, or IMBC. Operators read the manufacturer names from main_information.';

COMMENT ON COLUMN "organization"."bin" IS '12 digits. Required for a manufacturer, empty otherwise. Immutable. One BIN is one manufacturer organisation.';

COMMENT ON COLUMN "organization"."is_major_operator" IS 'NCOC, TCO, and KPO at go-live. The administrator can mark others. The works-with count is out of these organisations.';

COMMENT ON COLUMN "organization"."notification_mailbox" IS 'Set on the IMBC organisation. IMBC emails go here.';

COMMENT ON TABLE "user_account" IS 'Inactive means no sign-in for three months and is unrelated to profile update status. A blocked account is an administrator action.';

COMMENT ON COLUMN "user_account"."email" IS 'Login. For a manufacturer this is the company mailbox. Only an administrator changes it.';

COMMENT ON COLUMN "user_account"."name" IS 'The person, for every account except the manufacturer account.';

COMMENT ON COLUMN "user_account"."idp_subject" IS 'Subject in the OpenID Connect provider. Credentials stay there.';

COMMENT ON COLUMN "user_account"."auth_version" IS 'Incremented when the account is blocked or its role changes, which ends open sessions.';

COMMENT ON COLUMN "user_account"."locked_until" IS 'Fifteen minutes after ten failed sign-ins. This is not state blocked.';

COMMENT ON COLUMN "user_account"."responsibility_accepted_at" IS 'Latest acceptance. Empty until the first sign-in dialog is accepted.';

COMMENT ON COLUMN "user_account"."platform_terms_accepted_at" IS 'Manufacturer registration.';

COMMENT ON COLUMN "user_account"."personal_data_accepted_at" IS 'Manufacturer registration.';

COMMENT ON TABLE "user_session" IS 'BFF session. The browser holds the cookie. Tokens do not leave the server.';

COMMENT ON COLUMN "user_session"."idle_expires_at" IS '30 minutes without activity.';

COMMENT ON COLUMN "user_session"."absolute_expires_at" IS '12 hours after sign-in.';

COMMENT ON COLUMN "trusted_device"."expires_at" IS '30 days, after which the email code is required again.';

COMMENT ON TABLE "responsibility_acceptance" IS 'Append-only. Who accepted responsibility for their credentials, which text, and when. No signature image.';

COMMENT ON TABLE "api_access" IS 'Pull API credential. Read-only, same field set for every operator, no push.';

COMMENT ON COLUMN "api_access"."organization_id" IS 'An operator organisation.';

COMMENT ON TABLE "manufacturer_profile" IS 'One profile per manufacturer organisation. Created at registration once the password is set, or by migration, as Draft. Pending changes are not a status: the profile stays verified while a section has a pending revision.';

COMMENT ON COLUMN "manufacturer_profile"."assigned_expert_id" IS 'Mirrors the open review assignment.';

COMMENT ON COLUMN "manufacturer_profile"."registered_at" IS 'Set when the password is set and the profile is created.';

COMMENT ON COLUMN "manufacturer_profile"."completeness_percent" IS 'Computed. Average of the seven sections other than production. Send for review needs 100.';

COMMENT ON COLUMN "manufacturer_profile"."heard_about_us" IS 'Class B. IMBC only. Never shown to operators or observers.';

COMMENT ON COLUMN "manufacturer_profile"."bin_check_digit_valid" IS 'A migrated BIN that fails the check digit is flagged, not rejected.';

COMMENT ON COLUMN "manufacturer_profile"."migration_flags" IS 'OUT OF, N/A, unmapped values, duplicate candidates. Kept for IMBC.';

COMMENT ON COLUMN "manufacturer_profile"."accuracy_confirmed_at" IS 'Last time the manufacturer confirmed the data is accurate, on send.';

COMMENT ON TABLE "profile_section" IS 'Eight sections. The working revision is the section_revision of this section whose state is working. At most one.';

COMMENT ON COLUMN "profile_section"."verified_revision_id" IS 'What operators, observers, exports, and the pull API read.';

COMMENT ON COLUMN "profile_section"."pending_revision_id" IS 'Submitted revision waiting for the expert.';

COMMENT ON COLUMN "profile_section"."completeness_percent" IS 'Computed from the working revision. Production is stored and then left out of the profile average.';

COMMENT ON TABLE "section_revision" IS 'Copy-on-write. The next edit copies rows into a new working revision. A verified revision stays as history when a newer one replaces it. Class A while it is the verified revision, class B while it is working, pending, or rejected.';

COMMENT ON COLUMN "section_revision"."submitted_at" IS 'Set when the revision is frozen. A submitted or verified revision is never overwritten.';

COMMENT ON TABLE "submission_requirement" IS 'Mandatory certificate and document types, copied from the reference lists at the moment of send, so a later change to those lists does not rewrite a frozen revision.';

COMMENT ON TABLE "main_information" IS 'BIN and the login email are not copied here. BIN lives on organization and the manufacturer cannot change it. The login is the manufacturer account. Where the legal name or the kind of activity is returned by both e-Ondiris and Adata, e-Ondiris is kept, and it is not translated. A later read does not replace a value the manufacturer has saved. name_en and name_ru stay because the export lists both.';

COMMENT ON COLUMN "main_information"."director_full_name" IS 'Prefilled from Adata. The manufacturer confirms it. Required before submit.';

COMMENT ON COLUMN "main_information"."state_registered_on" IS 'Date of state registration. Prefilled from Adata. Required before submit.';

COMMENT ON COLUMN "main_information"."legal_address" IS 'Prefilled from Adata.';

COMMENT ON COLUMN "main_information"."production_address" IS 'Prefilled from e-Ondiris when still empty. A later pull does not replace a value the manufacturer has saved.';

COMMENT ON COLUMN "main_information"."company_phone" IS 'e-Ondiris, then Adata, then the manufacturer. The manufacturer can correct it.';

COMMENT ON COLUMN "main_information"."contact_email" IS 'Company contact email. Not the login. e-Ondiris, then Adata, then the manufacturer.';

COMMENT ON COLUMN "main_information"."registry_oked_code" IS 'OKED code from the e-Ondiris read. Shown beside the codes the manufacturer selects. It does not replace them.';

COMMENT ON COLUMN "main_information"."registry_oked_name" IS 'OKED name from the same read.';

COMMENT ON COLUMN "main_information"."unified_register_registered" IS 'Yes when the e-Ondiris read for this BIN returns at least one product.';

COMMENT ON COLUMN "main_information"."unified_register_first_inclusion_on" IS 'The earliest registry inclusion date among the products.';

COMMENT ON COLUMN "main_information"."unified_register_extract_id" IS 'Optional extract file.';

COMMENT ON COLUMN "main_information_oked"."position" IS 'Order the manufacturer chose. The specification does not define a single main OKED.';

COMMENT ON TABLE "contact" IS 'A contact is not an account. A revision needs at least three. The focal point is the contact IMBC and operators deal with first. An observer does not see the focal point.';

COMMENT ON COLUMN "contact"."role_id" IS 'management, technical, or commercial. A role may be used more than once. The three contacts do not have to cover all three roles.';

COMMENT ON TABLE "personnel" IS 'The manufacturer enters the three counts. Adata does not prefill headcount. The total is their sum and is not stored.';

COMMENT ON COLUMN "personnel"."non_kz_managers_count" IS 'Non-Kazakhstan citizens in managerial positions.';

COMMENT ON COLUMN "personnel"."organisation_chart_id" IS 'Mandatory file before submit. The sample file is org_chart_sample, not a template.';

COMMENT ON TABLE "personnel_cv" IS 'Optional. One or more CV files.';

COMMENT ON TABLE "shareholder" IS 'At least one. When the manufacturer has entered none, the shareholders Adata returns prefill the rows. A total other than 100 percent warns and does not block submit.';

COMMENT ON TABLE "product_line_identity" IS 'Stable identity of one product line across copy-on-write revisions. Equipment links point here.';

COMMENT ON TABLE "product_line" IS 'At least one. A pulled line is the e-Ondiris record and cannot be edited or deleted. The manufacturer cannot add another line for that product. A daily pull updates the pulled line and does not replace a company name, an address, an OKED selection, or a contact the manufacturer has saved. The barcode, AGSK-3, NTIN, the registry comment, and the data source are not stored.';

COMMENT ON COLUMN "product_line"."name_en" IS 'Required on a line the manufacturer adds. Empty on a pulled line. The platform does not translate a pulled name.';

COMMENT ON COLUMN "product_line"."name_ru" IS 'Required on a line the manufacturer adds. A pulled line stores the registry product name here, in the spelling e-Ondiris returned.';

COMMENT ON COLUMN "product_line"."commodity_group_id" IS 'IMBC class A to E.';

COMMENT ON COLUMN "product_line"."tn_ved_code" IS 'Text, so leading zeros stay. Ten digits on a pulled line. Chosen from the TN VED list on a line the manufacturer adds.';

COMMENT ON COLUMN "product_line"."kpved_code" IS 'Optional on an added line. Text, so leading zeros stay.';

COMMENT ON COLUMN "product_line"."kpved_name" IS 'The KPVED name from e-Ondiris. Shown with the code.';

COMMENT ON COLUMN "product_line"."enstru_code" IS 'Kept. Shown with its name. The platform does not match tenders.';

COMMENT ON COLUMN "product_line"."capacity_quantity" IS 'Required on a line the manufacturer adds, with capacity_unit. Empty on a pulled line.';

COMMENT ON COLUMN "product_line"."capacity_unit" IS 'Per year. Pieces, tonnes, metres, or sets. Required on an added line.';

COMMENT ON COLUMN "product_line"."capacity_text" IS 'e-Ondiris production capacity as returned, for example 8600.00 кг/год.';

COMMENT ON COLUMN "product_line"."in_country_value_share" IS 'Percent. Optional on an added line, and 0 when the manufacturer adds one. From e-Ondiris on a pulled line.';

COMMENT ON COLUMN "product_line"."localization_steps_done" IS 'Optional. For example 7 of 9. Not a pass or a fail.';

COMMENT ON COLUMN "product_line"."e_ondiris_record_id" IS 'Set on a pulled line. Several revisions may point at one copy row.';

COMMENT ON COLUMN "product_line"."unified_register_registration_number" IS 'e-Ondiris registration_number. One company can have several.';

COMMENT ON COLUMN "product_line"."registry_legal_name" IS 'Producer legal name on this registry row. A pull does not replace the company legal name the manufacturer has saved.';

COMMENT ON COLUMN "product_line"."registry_place_name" IS 'e-Ondiris region_kato. A place name, not a KATO code.';

COMMENT ON COLUMN "product_line"."registry_phone" IS 'Producer phone from the registry. Not the focal point.';

COMMENT ON COLUMN "product_line"."registry_email" IS 'Producer email from the registry. Not the focal point.';

COMMENT ON COLUMN "product_line"."unified_register_active" IS 'e-Ondiris is_active. An excluded or expired entry stays on the line and is marked not active. Empty when the line did not come from the registry.';

COMMENT ON COLUMN "product_line"."unified_register_included_on" IS 'Inclusion date of this product. The company date on main_information is the earliest.';

COMMENT ON TABLE "production" IS 'The whole section is optional and is excluded from profile completeness. An empty section has no row.';

COMMENT ON COLUMN "production"."utilisation_percent" IS '0 to 100.';

COMMENT ON TABLE "equipment_item" IS 'No year and no location.';

COMMENT ON COLUMN "equipment_item"."section_revision_id" IS 'The production section revision.';

COMMENT ON TABLE "equipment_product_line" IS 'Optional link to one or more product lines of the same manufacturer.';

COMMENT ON TABLE "certificate" IS 'Go-live mandatory types are ISO 9001, ISO 14001, and ISO 45001. Named Others include ASME, API, IEC, IECEx, ATEX, and Extract from e-Ondiris. CT-KZ and the industrial certificate for internal circulation are not types. An expired certificate stays on the profile and does not remove Verified. When the update status is active, expiry sets it to outdated. Expiry does not by itself set unresponsive.';

COMMENT ON COLUMN "certificate"."custom_type_name" IS 'Set when the type is Other.';

COMMENT ON COLUMN "certificate"."expires_on" IS 'Empty when the certificate does not expire.';

COMMENT ON COLUMN "certificate"."file_object_id" IS 'Required before a mandatory certificate can be submitted. Replacing the file adds a file_version.';

COMMENT ON TABLE "document" IS 'Registration certificate and charter are mandatory. Licences are mandatory unless licence_not_required is accepted. Financial statements and other documents are optional unless the administrator marks the type mandatory.';

COMMENT ON COLUMN "document"."licence_not_required" IS 'The manufacturer statement for the licence type. The expert accepts or rejects it like a document.';

COMMENT ON TABLE "file_object" IS 'The domain row points here. Bytes live in object storage, quarantine first, then the live bucket after the scan.';

COMMENT ON COLUMN "file_object"."organization_id" IS 'Owning organisation. Empty only for a survey PDF not yet matched to a BIN.';

COMMENT ON TABLE "file_version" IS 'Nobody can open, download, verify, or publish a version until scan_state is passed. Earlier versions stay.';

COMMENT ON COLUMN "file_version"."byte_size" IS 'Up to 25 MB.';

COMMENT ON COLUMN "file_version"."detected_media_type" IS 'From content, not from the file name. Allowed: PDF, JPG, PNG, DOCX, XLSX.';

COMMENT ON TABLE "org_chart_sample" IS 'The file manufacturers may download. It is not a required template.';

COMMENT ON TABLE "review_assignment" IS 'An administrator who assigns sees the manufacturer name and the profile status only. A profile sent again returns to the same expert. Unlock closes the assignment and keeps decisions on sections the manufacturer does not change.';

COMMENT ON COLUMN "review_assignment"."expert_id" IS 'Empty while the profile sits in the unassigned queue.';

COMMENT ON COLUMN "review_assignment"."assigned_by" IS 'The expert who took it, or the administrator who assigned it.';

COMMENT ON COLUMN "review_assignment"."closed_at" IS 'Set on submit result or on unlock.';

COMMENT ON TABLE "review_decision" IS 'Append-only. Exactly one subject. The expert does not edit manufacturer data. A section whose mandatory file is not verified cannot itself be verified. Submit result verifies the profile only when every section is verified. Otherwise the profile is returned.';

COMMENT ON COLUMN "review_decision"."outcome" IS 'verified or rejected.';

COMMENT ON COLUMN "review_decision"."comment" IS 'Required when the outcome is rejected.';

COMMENT ON TABLE "update_status" IS 'Created with the profile. No update-status email goes out until the profile is verified. One ignored notice, plus seven days, makes the profile outdated. A second makes it unresponsive. Unresponsive stays visible to operators, observers, and the map, and sorts below active and outdated profiles. It is not deleted and the account is not blocked. Passing time does not remove Verified. Signing in does not move the clock. At most 50 of NOT-12, NOT-15, and NOT-16 go out in a day. Three months without sign-in does not move this clock.';

COMMENT ON COLUMN "update_status"."anchor_on" IS 'The date that belongs to this profile. Starts as the day the profile was created. Moves when the manufacturer confirms, and when an SME accepts a change to the verified profile.';

COMMENT ON COLUMN "update_status"."current_quarter_on" IS 'Three calendar months from anchor_on, the same day, or the last day of that month. Asia/Almaty. Not one calendar date for every profile.';

COMMENT ON COLUMN "update_status"."response_due_on" IS 'Seven days after NOT-12 or NOT-15 was sent. Empty when no notice is waiting. The seven days start on the day the notice is sent.';

COMMENT ON COLUMN "update_status"."outdated_by_certificate" IS 'True only when a certificate expiry is the sole reason the status is outdated. Replacing that certificate sets the status back to active. A missed quarter clears this.';

COMMENT ON TABLE "update_confirmation" IS 'Append-only. Saving a section, sending changes, and accepting the NDA are not confirmations. Each confirmation is also an audit entry.';

COMMENT ON COLUMN "update_confirmation"."kind" IS 'While active or outdated, one confirmation is enough. Coming back from unresponsive confirms each section. Only the last of those sets the status back to active.';

COMMENT ON TABLE "update_status_event" IS 'Idempotency of the daily job. One NOT-12, one NOT-15, or one NOT-16 per profile and quarter date. A notice that would pass the daily cap of 50 is not written until the day it is sent.';

COMMENT ON TABLE "certificate_expiry_notice" IS 'Replacing the file or the expiry date starts the schedule again, because the key is the file version. A certificate already expired when it is saved does not send the earlier reminders.';

COMMENT ON COLUMN "certificate_expiry_notice"."threshold_days" IS '60, 30, 7, or 0.';

COMMENT ON TABLE "site_survey_record" IS 'A profile is site surveyed while some record has result yes, a signed file, and, when an expiry date is set, that date is still in the future. A record with no expiry date stays site surveyed until IMBC sets a date that has passed. There is no automatic one-year or two-year term. The mark is derived, not stored on the profile. Site surveyed is tier 2. Several records over time.';

COMMENT ON COLUMN "site_survey_record"."file_object_id" IS 'The signed report. A migrated visit may have none, and then the profile is not site surveyed.';

COMMENT ON COLUMN "site_survey_record"."expires_on" IS 'Set by the person who records the survey.';

COMMENT ON COLUMN "site_survey_record"."comment" IS 'Class C. Operators see the report and the dates, not this comment.';

COMMENT ON TABLE "due_diligence_record" IS 'One current record per manufacturer. The check runs when the profile is created, on the same Adata read as the prefill, and again once a quarter from the last check. A BIN in a registration that never becomes a profile is not queried. Red keeps the profile off operator and observer views until an SME sets green or amber. Green and amber do not. Political-exposure lists are not used. The parts of the extended report that are not checks are not stored.';

COMMENT ON COLUMN "due_diligence_record"."checked_on" IS 'Class A. Operators and observers see this date.';

COMMENT ON COLUMN "due_diligence_record"."adata_result" IS 'The value the automatic scoring returned, before an SME change.';

COMMENT ON COLUMN "due_diligence_record"."result" IS 'Class C. The stored result, after any SME change. Green, amber, or red. Operators and observers do not see it.';

COMMENT ON COLUMN "due_diligence_record"."enhanced" IS 'Class A. Operators and observers see whether this was done, not the comment or the report.';

COMMENT ON TABLE "due_diligence_check" IS 'The lines of the current run. A scored yes is a finding. A shown-only yes is attention. No answer is not scored. A line Adata does not return is absent, not a row marked clear. Replacing the run replaces these rows. Class C.';

COMMENT ON COLUMN "due_diligence_check"."group_name" IS 'Company enterprise, finance, procurement, or tax payments; the director; or a founder or beneficiary.';

COMMENT ON COLUMN "due_diligence_check"."subject_name" IS 'The company or the person this line is about.';

COMMENT ON COLUMN "due_diligence_check"."adata_value" IS 'Empty when the mark is no answer.';

COMMENT ON TABLE "external_check" IS 'Class C. Not read by the catalog, exports, or the pull API.';

COMMENT ON COLUMN "external_check"."is_mock" IS 'Phase 1: Adata is the real service. e-Ondiris is the local copy in e_ondiris_record, not a call when a section opens. Every other connector is a mock.';

COMMENT ON TABLE "external_check_attempt" IS 'A connector takes a BIN and returns a value, a status, a date, and a source. The Adata allowance is 3,000 BIN a month. One BIN is one request. A rate limit is not a finding.';

COMMENT ON COLUMN "external_check_attempt"."unavailable" IS 'Unavailability is never stored as a negative finding.';

COMMENT ON TABLE "e_ondiris_record" IS 'The local copy of e-Ondiris. There is no published API. A profile reads this table. It does not call e-Ondiris when a section opens. The barcode, AGSK-3, NTIN, the registry comment, and the data source are not stored. A failed daily pull is not a due-diligence finding.';

COMMENT ON COLUMN "e_ondiris_record"."place_name" IS 'region_kato as returned. A place name, not a KATO code.';

COMMENT ON COLUMN "e_ondiris_record"."localization_level" IS 'As returned, for example 7/9.';

COMMENT ON COLUMN "e_ondiris_record"."content_hash" IS 'Detects a change. The daily pull writes new and changed rows.';

COMMENT ON TABLE "imbc_note" IS 'Class C. SMEs and the IMBC general director. Never an operator, an observer, a manufacturer, or an administrator.';

COMMENT ON TABLE "imbc_legacy" IS 'One column per internal column of the manufacturers workbook, kept with the notes. Yellow columns are included. Dropping one later is deleting that column. LC/LPS is not a workflow. Overall ranking is not shown as a rank. A finished CDP or AGAR in the workbook becomes an agar_cdp_record on the product line the approved mapping names. When the workbook does not name the product, these columns stay until IMBC names it. Site-visit conducted and its dates are site_survey_record, not columns here.';

COMMENT ON COLUMN "imbc_legacy"."eoi_email_sent" IS 'Excel: Expression of interest (EoI) email sent/resent. Yellow column.';

COMMENT ON COLUMN "imbc_legacy"."eoi_receipt_confirmed" IS 'Excel: Confirmation of receipt (Yes/No). Yellow column.';

COMMENT ON COLUMN "imbc_legacy"."source" IS 'Excel: Source. Yellow column.';

COMMENT ON COLUMN "imbc_legacy"."eoi_response" IS 'Excel: Response to EoI Email (Interested/Not interested). Yellow column.';

COMMENT ON COLUMN "imbc_legacy"."eoi_response_summary" IS 'Excel: Summary of response to EoI. Yellow column.';

COMMENT ON COLUMN "imbc_legacy"."ready_for_site_visit" IS 'Excel: Ready for site visit? Yellow column. Not the site-visit record.';

COMMENT ON COLUMN "imbc_legacy"."shortlisted_for_cdp_agar" IS 'Excel: Shortlisted for CDP / AGAR (Yes/No).';

COMMENT ON COLUMN "imbc_legacy"."lc_lps" IS 'Excel: LC/LPS.';

COMMENT ON COLUMN "imbc_legacy"."priority" IS 'Excel: Priority commodity for IMBC.';

COMMENT ON COLUMN "imbc_legacy"."year_added" IS 'Excel: Year Added to IMBC Database.';

COMMENT ON COLUMN "imbc_legacy"."cdp_agar_status" IS 'Excel: Status CDP / AGAR.';

COMMENT ON COLUMN "imbc_legacy"."cdp_agar_execution" IS 'Excel: CDP / AGAR execution (%). Stored as text, as entered.';

COMMENT ON COLUMN "imbc_legacy"."e_ondiris_note" IS 'Excel column E-ondiris note. Match problems such as a namesake under another BIN. Class C.';

COMMENT ON TABLE "site_survey_request" IS 'A verified manufacturer asks for a site survey. The request names no product. It appears in the SME list and sends no email. It does not create a site_survey_record.';

COMMENT ON TABLE "agar_cdp_record" IS 'Tier 3 when the status is report issued or later. A visit without that report is not tier 3. There is no questionnaire. The manufacturer can request an AGAR only for a product that has an STR. The request sends no email and does not start the visit. Recommendation issued is a status. The recommendation is not sent to operators.';

COMMENT ON COLUMN "agar_cdp_record"."product_line_identity_id" IS 'One record per product line. A manufacturer can have several, each on its own product.';

COMMENT ON COLUMN "agar_cdp_record"."kind" IS 'A finished CDP stays a CDP. New work is recorded as an AGAR.';

COMMENT ON COLUMN "agar_cdp_record"."report_file_id" IS 'Not shown on the company page operators and observers see. Phase 1 does not send it to operators.';

COMMENT ON COLUMN "agar_cdp_record"."requested_by_manufacturer" IS 'Requested is used only when the manufacturer asked. IMBC can shortlist a product that has no request.';

COMMENT ON TABLE "works_with_mark" IS 'The current mark. Other operators see only how many of the major operators have a validated mark. A comment the operator writes is an operator note, not a column here.';

COMMENT ON TABLE "works_with_mark_change" IS 'Append-only history of the mark.';

COMMENT ON COLUMN "works_with_mark_change"."decided_by" IS 'The expert who validated or rejected the change.';

COMMENT ON TABLE "operator_visit_mark" IS 'The operator records that its organisation visited the manufacturer. This does not make the profile site surveyed.';

COMMENT ON COLUMN "operator_visit_mark"."decision" IS 'The decision is visible to IMBC only.';

COMMENT ON TABLE "operator_note" IS 'Class D. The same operator organisation, the expert, and the director. Absent from exports, subscriptions, the pull API, and the company-page PDF.';

COMMENT ON COLUMN "operator_note"."deleted_at" IS 'Only the author deletes a note. Notes are not edited.';

COMMENT ON TABLE "imbc_request" IS 'An operator message to IMBC staff. The manufacturer is not a party, even when a profile is linked.';

COMMENT ON COLUMN "imbc_request"."profile_id" IS 'Optional linked manufacturer.';

COMMENT ON COLUMN "imbc_request"."reply" IS 'The expert reply. Closing with no reply sends no email.';

COMMENT ON TABLE "operator_request" IS 'The ask itself, readable by the manufacturer. The manufacturer is not told which operator asked. The operator identity is operator_request_party, so a read of this table cannot leak it.';

COMMENT ON COLUMN "operator_request"."section_kind" IS 'The ask names a section, or free_text, or both.';

COMMENT ON COLUMN "operator_request"."reply" IS 'The manufacturer writes one reply. It does not change the profile. A further ask is a new request.';

COMMENT ON TABLE "operator_request_party" IS 'Class C and class D. IMBC and the sending operator. Never selected for the manufacturer.';

COMMENT ON TABLE "export_subscription" IS 'When the account becomes inactive, its subscriptions pause. There is no SFTP and no column picker in Phase 1.';

COMMENT ON COLUMN "export_subscription"."owner_user_id" IS 'One operator user, not the organisation.';

COMMENT ON COLUMN "export_subscription"."filters" IS 'The saved search. Common: name or BIN, region, commodity group, commodity type, certificate type, site surveyed, tier. Extended: TN VED prefix, KPVED prefix, OKED, works-with count, headcount range, certificate valid until, Unified Register, verification date.';

COMMENT ON TABLE "export_file" IS 'Subscription output. A one-off search export is streamed and is not stored. The email carries a link, not the file. The link still requires sign-in.';

COMMENT ON COLUMN "export_file"."expires_at" IS '90 days.';

COMMENT ON TABLE "subscription_run" IS 'A failed run sends no email and stays on this list. Each run reads a repeatable snapshot of the visible register.';

COMMENT ON TABLE "nda_version" IS 'Earlier versions stay, with their acceptances. A new current version closes the forecast and the technical requirements until the manufacturer accepts it.';

COMMENT ON TABLE "nda_acceptance" IS 'Append-only. Class B. Accepted at self-registration, or on first sign-in for a migrated manufacturer. Records the time, the version, and the IP address. It does not record a name or a position. One acceptance covers the detailed forecast, the STR, and the KTRE. Both stay closed until the profile is verified. Opening a section does not ask again.';

COMMENT ON TABLE "forecast_version" IS 'About 77,000 lines for commodity groups A to D and about 8,000 for group E. Per-operator columns and FPAL columns in the workbook are ignored and never stored.';

COMMENT ON COLUMN "forecast_version"."published_at" IS 'Empty until an administrator presses Publish.';

COMMENT ON TABLE "forecast_import_issue" IS 'A faulty row is reported and does not stop the import. A missing column stops the import before these rows are written.';

COMMENT ON TABLE "forecast_line" IS 'No operator is named. The manufacturer can search and filter, including by a TN VED prefix, and cannot download or print the lines.';

COMMENT ON COLUMN "forecast_line"."commodity_group_id" IS 'The line category.';

COMMENT ON COLUMN "forecast_line"."commodity_type_id" IS 'The line subcategory.';

COMMENT ON COLUMN "forecast_line"."total_quantity" IS 'A number, not a range. To the end of the forecast horizon.';

COMMENT ON TABLE "technical_requirements_file" IS 'IMBC text for one product, either the summarized technical requirements or the key technical requirements excerpts. Operator names, project names, and brands are already removed. Opened from the technical-requirements section, not from a forecast line. Zoom and scroll. No download and no print. The platform does not parse the PDF. A product may have neither file. A file supplied in one language is shown in Kazakh, English, and Russian, and is not translated. Class F. The file belongs to the IMBC organisation.';

COMMENT ON COLUMN "technical_requirements_file"."commodity_group_id" IS 'The section groups files by commodity group, then by product.';

COMMENT ON COLUMN "technical_requirements_file"."product_label" IS 'The product as IMBC names it. Not a forecast line and not an operator.';

COMMENT ON TABLE "audit_entry" IS 'Append-only, partitioned by month, kept for 5 years. The director reads all of it. The administrator reads account events only. No update and no delete.';

COMMENT ON COLUMN "audit_entry"."action" IS 'Includes sign-in, sign-out, refused requests, status changes, decisions, NDA acceptances, exports, downloads, and company-page opens.';

COMMENT ON TABLE "activity_snapshot" IS 'Week and month counts of the register. Which company pages an operator opened stays in audit_entry, action company_page_opened. Contracts are not recorded.';

COMMENT ON TABLE "catalog_profile" IS 'Read model catalog_visible. Rebuilt from the verified revision of each section plus the class A columns of survey, due diligence, and works-with. Not a source of truth. The due-diligence result is used to set visible and is not a column here. Exports and the pull API read this same class A set. The company page is wider than the standard export columns: it adds the e-Ondiris fields, in-country value share, localization level, the registration date, the update status, the tier, and whether enhanced due diligence was done. An observer does not receive the focal point or the tier 3 product list.';

COMMENT ON COLUMN "catalog_profile"."update_status" IS 'Active, outdated, or unresponsive. Unresponsive stays in the list and sorts below the other two. There is no sort key inside one status.';

COMMENT ON COLUMN "catalog_profile"."tier" IS 'Derived. Tier 1 when verified. Tier 2 when site surveyed. A profile that is not verified is not in this table.';

COMMENT ON COLUMN "catalog_profile"."pending_changes" IS 'Operators see the verified values plus this mark. They do not see the pending values.';

COMMENT ON COLUMN "catalog_profile"."works_with_major_count" IS 'Validated marks among the major operators, from 0 to 3. Not which operators.';

COMMENT ON COLUMN "catalog_profile"."visible" IS 'Verified, and the due-diligence result is green or amber, at any update status. A red result is absent until an SME sets green or amber.';

COMMENT ON TABLE "catalog_tier3_product" IS 'A product whose AGAR or CDP is report issued or later. Operators see which products these are. Observers see the profile tier only. Rebuilt with catalog_profile.';

COMMENT ON TABLE "catalog_profile_facet" IS 'Denormalised filter values for the visible profile. Rebuilt with catalog_profile.';

COMMENT ON COLUMN "dictionary"."code" IS 'region, legal_form, oked, tn_ved, kpved, commodity_group, commodity_type, process, equipment_type, contact_role, certificate_type, document_type.';

COMMENT ON COLUMN "dictionary_entry"."code" IS 'The code itself, stored as text so leading zeros stay.';

COMMENT ON COLUMN "dictionary_entry"."parent_entry_id" IS 'Commodity type points at its commodity group.';

COMMENT ON COLUMN "dictionary_entry"."mandatory" IS 'Certificate types and document types only. The administrator sets it. The change applies to profiles submitted afterwards.';

COMMENT ON COLUMN "dictionary_entry"."custom_name_allowed" IS 'The Other certificate type.';

COMMENT ON COLUMN "dictionary_entry"."retired_at" IS 'A value in use is not deleted. Retiring hides it from new choices.';

COMMENT ON TABLE "dictionary_entry_translation" IS 'Interface strings live in language files. These rows are the reference-list names only.';

COMMENT ON TABLE "notification_rule" IS 'Rules as data. There is no notification inbox. Observers receive none of these emails.';

COMMENT ON COLUMN "notification_rule"."code" IS 'NOT-01 through NOT-17, plus the scenario rules that decide the recipient.';

COMMENT ON TABLE "notification" IS 'The send log. Certificate reminders and update-status emails also have their own idempotency tables.';

COMMENT ON COLUMN "notification"."dedup_key" IS 'One email per event and distinct address. Address match ignores case.';

COMMENT ON TABLE "policy_rule" IS 'The policy matrix. Loaded into the authorisation library at startup. Tests are generated from these rows. Nobody edits them in the interface. A change comes with a release. No role has every right.';

COMMENT ON COLUMN "policy_rule"."condition" IS 'own_organisation, visible_profile, owner, nda_accepted, or none.';

COMMENT ON COLUMN "policy_rule"."effect" IS 'allow or deny.';

COMMENT ON TABLE "import_batch" IS 'Excel base: about 982 rows and 816 unique BINs. One BIN becomes one profile. One Excel row becomes one product line.';

COMMENT ON COLUMN "import_batch"."trial" IS 'A trial sends no email and can be repeated.';

COMMENT ON TABLE "import_row" IS 'Journal of one run. Repeating a trial upserts profiles by BIN and does not create a second profile.';

COMMENT ON COLUMN "import_row"."flags" IS 'Unmapped values, OUT OF, N/A, duplicate candidates, a BIN that fails the check digit.';

COMMENT ON TABLE "import_resolution" IS 'Nothing is merged automatically. Unmatched survey PDFs are attached by hand.';

COMMENT ON COLUMN "import_resolution"."kind" IS 'unmapped_value, duplicate, invalid_bin, unmatched_survey_pdf, no_email.';

COMMENT ON COLUMN "import_resolution"."file_object_id" IS 'Set for a survey PDF that had no BIN or more than one candidate.';

COMMENT ON TABLE "migration_invitation_run" IS 'Invite all migrated manufacturers. Runs once IMBC has accepted the migration. The five-day notice does not change a Draft profile when the five days pass.';

COMMENT ON COLUMN "migration_invitation_run"."report" IS 'Profiles with no usable email, or an invalid one. Those profiles are not emailed.';

ALTER TABLE "user_account" ADD FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "user_session" ADD FOREIGN KEY ("user_account_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "trusted_device" ADD FOREIGN KEY ("user_account_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "responsibility_acceptance" ADD FOREIGN KEY ("user_account_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "api_access" ADD FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "api_access" ADD FOREIGN KEY ("issued_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "api_access" ADD FOREIGN KEY ("revoked_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "manufacturer_profile" ADD FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "manufacturer_profile" ADD FOREIGN KEY ("assigned_expert_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "profile_section" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "profile_section" ADD FOREIGN KEY ("verified_revision_id") REFERENCES "section_revision" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "profile_section" ADD FOREIGN KEY ("pending_revision_id") REFERENCES "section_revision" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "section_revision" ADD FOREIGN KEY ("profile_section_id", "organization_id") REFERENCES "profile_section" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "section_revision" ADD FOREIGN KEY ("author_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "submission_requirement" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "submission_requirement" ADD FOREIGN KEY ("dictionary_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "main_information" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "main_information" ADD FOREIGN KEY ("legal_form_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "main_information" ADD FOREIGN KEY ("region_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "main_information" ADD FOREIGN KEY ("unified_register_extract_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "main_information_oked" ADD FOREIGN KEY ("main_information_id", "organization_id") REFERENCES "main_information" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "main_information_oked" ADD FOREIGN KEY ("oked_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "contact" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "contact" ADD FOREIGN KEY ("role_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel" ADD FOREIGN KEY ("organisation_chart_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel_cv" ADD FOREIGN KEY ("personnel_id", "organization_id") REFERENCES "personnel" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel_cv" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "shareholder" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_identity" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("identity_id", "organization_id") REFERENCES "product_line_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("commodity_group_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("commodity_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("conformity_file_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("e_ondiris_record_id") REFERENCES "e_ondiris_record" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_process" ADD FOREIGN KEY ("production_id", "organization_id") REFERENCES "production" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_process" ADD FOREIGN KEY ("process_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_photo" ADD FOREIGN KEY ("production_id", "organization_id") REFERENCES "production" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_photo" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "equipment_item" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "equipment_item" ADD FOREIGN KEY ("equipment_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "equipment_product_line" ADD FOREIGN KEY ("equipment_item_id", "organization_id") REFERENCES "equipment_item" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "equipment_product_line" ADD FOREIGN KEY ("product_line_identity_id", "organization_id") REFERENCES "product_line_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate" ADD FOREIGN KEY ("certificate_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "document" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "document" ADD FOREIGN KEY ("document_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "document" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_object" ADD FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_version" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_version" ADD FOREIGN KEY ("uploaded_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "org_chart_sample" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "org_chart_sample" ADD FOREIGN KEY ("uploaded_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_assignment" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_assignment" ADD FOREIGN KEY ("expert_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_assignment" ADD FOREIGN KEY ("assigned_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_decision" ADD FOREIGN KEY ("review_assignment_id") REFERENCES "review_assignment" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_decision" ADD FOREIGN KEY ("expert_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_decision" ADD FOREIGN KEY ("section_revision_id") REFERENCES "section_revision" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_decision" ADD FOREIGN KEY ("certificate_id") REFERENCES "certificate" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_decision" ADD FOREIGN KEY ("document_id") REFERENCES "document" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_decision" ADD FOREIGN KEY ("file_version_id") REFERENCES "file_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "update_status" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "update_confirmation" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "update_confirmation" ADD FOREIGN KEY ("confirmed_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "update_status_event" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate_expiry_notice" ADD FOREIGN KEY ("file_version_id") REFERENCES "file_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "site_survey_record" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "site_survey_record" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "site_survey_record" ADD FOREIGN KEY ("recorded_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "due_diligence_record" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "due_diligence_record" ADD FOREIGN KEY ("report_file_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "due_diligence_record" ADD FOREIGN KEY ("enhanced_report_file_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "due_diligence_record" ADD FOREIGN KEY ("overridden_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "due_diligence_check" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "external_check" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "external_check_attempt" ADD FOREIGN KEY ("external_check_id") REFERENCES "external_check" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "external_check" ADD FOREIGN KEY ("latest_attempt_id") REFERENCES "external_check_attempt" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_note" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_note" ADD FOREIGN KEY ("author_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_legacy" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "site_survey_request" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "site_survey_request" ADD FOREIGN KEY ("requested_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agar_cdp_record" ADD FOREIGN KEY ("product_line_identity_id") REFERENCES "product_line_identity" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agar_cdp_record" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agar_cdp_record" ADD FOREIGN KEY ("report_file_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agar_cdp_record" ADD FOREIGN KEY ("recorded_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "works_with_mark" ADD FOREIGN KEY ("operator_organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "works_with_mark" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "works_with_mark_change" ADD FOREIGN KEY ("works_with_mark_id") REFERENCES "works_with_mark" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "works_with_mark_change" ADD FOREIGN KEY ("changed_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "works_with_mark_change" ADD FOREIGN KEY ("decided_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_visit_mark" ADD FOREIGN KEY ("operator_organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_visit_mark" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_visit_mark" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_visit_mark" ADD FOREIGN KEY ("recorded_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_visit_mark" ADD FOREIGN KEY ("decided_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_note" ADD FOREIGN KEY ("operator_organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_note" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_note" ADD FOREIGN KEY ("author_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_request" ADD FOREIGN KEY ("sender_user_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_request" ADD FOREIGN KEY ("operator_organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_request" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_request" ADD FOREIGN KEY ("replied_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_request" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_request_party" ADD FOREIGN KEY ("operator_request_id") REFERENCES "operator_request" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_request_party" ADD FOREIGN KEY ("operator_organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "operator_request_party" ADD FOREIGN KEY ("sender_user_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "export_subscription" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "export_file" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "export_file" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "subscription_run" ADD FOREIGN KEY ("export_subscription_id") REFERENCES "export_subscription" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "subscription_run" ADD FOREIGN KEY ("export_file_id") REFERENCES "export_file" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "nda_version" ADD FOREIGN KEY ("published_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "nda_acceptance" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "nda_acceptance" ADD FOREIGN KEY ("nda_version_id") REFERENCES "nda_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_version" ADD FOREIGN KEY ("imported_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_version" ADD FOREIGN KEY ("published_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_import_issue" ADD FOREIGN KEY ("forecast_version_id") REFERENCES "forecast_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("forecast_version_id") REFERENCES "forecast_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("commodity_group_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("commodity_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_file" ADD FOREIGN KEY ("commodity_group_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_file" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_file" ADD FOREIGN KEY ("uploaded_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_entry" ADD FOREIGN KEY ("user_account_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_entry" ADD FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "activity_snapshot_count" ADD FOREIGN KEY ("activity_snapshot_id") REFERENCES "activity_snapshot" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_profile" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_profile" ADD FOREIGN KEY ("region_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_profile" ADD FOREIGN KEY ("current_site_survey_id") REFERENCES "site_survey_record" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_profile_facet" ADD FOREIGN KEY ("profile_id") REFERENCES "catalog_profile" ("profile_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_profile_facet" ADD FOREIGN KEY ("dictionary_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_tier3_product" ADD FOREIGN KEY ("profile_id") REFERENCES "catalog_profile" ("profile_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_tier3_product" ADD FOREIGN KEY ("product_line_identity_id") REFERENCES "product_line_identity" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dictionary_entry" ADD FOREIGN KEY ("dictionary_id") REFERENCES "dictionary" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dictionary_entry" ADD FOREIGN KEY ("parent_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dictionary_entry_translation" ADD FOREIGN KEY ("dictionary_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "notification" ADD FOREIGN KEY ("user_account_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "import_row" ADD FOREIGN KEY ("import_batch_id") REFERENCES "import_batch" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "import_batch" ADD FOREIGN KEY ("started_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "import_resolution" ADD FOREIGN KEY ("import_row_id") REFERENCES "import_row" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "import_resolution" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "import_resolution" ADD FOREIGN KEY ("resolved_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "migration_invitation_run" ADD FOREIGN KEY ("started_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

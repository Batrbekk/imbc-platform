-- IMBC platform schema, Phase 1. PostgreSQL 15 or later.
-- Generated from docs/data-model/imbc-platform.dbml by generate-sql.cjs.
-- Nine partial unique indexes replace plain indexes from the DBML export.
-- Two unique indexes use NULLS NOT DISTINCT, as specified in the DBML notes.
-- Foreign keys remain DEFERRABLE INITIALLY IMMEDIATE.
-- Primary keys are uuid. The application assigns UUIDv7.
-- audit_entry is append-only. Partition it by month when the table is created for production.
-- This is a schema snapshot; changes to an existing database require a migration.

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
  'migration',
  'source_refresh'
);

CREATE TYPE "record_status" AS ENUM (
  'uploaded',
  'under_review',
  'verified',
  'rejected',
  'expired',
  'missing'
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

CREATE TYPE "certificate_schedule_state" AS ENUM (
  'active',
  'stopped'
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
  'f_forecast',
  'g_lps'
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
  'recommendation_issued',
  'paused',
  'discontinued'
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
  'production_region',
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

CREATE TYPE "import_source_kind" AS ENUM (
  'manufacturer',
  'lps'
);

CREATE TYPE "connector_code" AS ENUM (
  'adata',
  'e_ondiris',
  'accounting',
  'legal_entity_registry'
);

CREATE TYPE "certificate_group" AS ENUM (
  'company',
  'product',
  'other'
);

CREATE TYPE "eoi_response" AS ENUM (
  'interested',
  'not_interested'
);

CREATE TYPE "imbc_note_kind" AS ENUM (
  'general',
  'legacy_ranking',
  'registry_review',
  'migration_context'
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
  "legal_name" text,
  "name_en" text,
  "legal_form_id" uuid,
  "director_full_name" text,
  "state_registered_on" date,
  "legal_address" text,
  "legal_data_checked_at" timestamptz,
  "website" text,
  "company_phone" text,
  "contact_email" text,
  "unified_register_registered" boolean,
  "unified_register_first_inclusion_on" date
);

CREATE TABLE "main_information_oked" (
  "id" uuid PRIMARY KEY,
  "main_information_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "code" text NOT NULL,
  "source_name" text,
  "oked_entry_id" uuid,
  "position" int NOT NULL
);

CREATE TABLE "company_founder" (
  "id" uuid PRIMARY KEY,
  "main_information_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "position_in_list" int NOT NULL
);

CREATE TABLE "production_site_identity" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL
);

CREATE TABLE "production_site" (
  "id" uuid PRIMARY KEY,
  "main_information_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "identity_id" uuid NOT NULL,
  "address" text,
  "region_id" uuid,
  "city" text,
  "position_in_list" int NOT NULL
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
  "managers_count" int,
  "engineers_count" int,
  "production_workers_count" int,
  "nonresident_count" int
);

CREATE TABLE "personnel_org_chart" (
  "id" uuid PRIMARY KEY,
  "personnel_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "file_object_id" uuid NOT NULL,
  "position_in_list" int NOT NULL
);

CREATE TABLE "personnel_cv" (
  "id" uuid PRIMARY KEY,
  "personnel_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "file_object_id" uuid NOT NULL,
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
  "name_ru" text,
  "commodity_type_id" uuid,
  "tn_ved_code" text,
  "production_site_identity_id" uuid,
  "capacity_quantity" numeric,
  "capacity_unit_id" uuid,
  "capacity_text" text,
  "in_country_value_share" numeric(5,2),
  "enstru_code" text,
  "enstru_name" text,
  "e_ondiris_record_id" uuid,
  "unified_register_registration_number" text,
  "unified_register_active" boolean,
  "unified_register_included_on" date,
  "note" text,
  "source" product_line_source NOT NULL DEFAULT 'manual',
  "position_in_list" int NOT NULL
);

CREATE TABLE "product_line_kpved" (
  "id" uuid PRIMARY KEY,
  "product_line_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "code" text NOT NULL,
  "source_name" text,
  "kpved_entry_id" uuid,
  "position_in_list" int NOT NULL
);

CREATE TABLE "products_section" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid UNIQUE NOT NULL,
  "organization_id" uuid NOT NULL,
  "unified_register_extract_id" uuid
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
  "position_in_list" int NOT NULL,
  "photo_file_id" uuid
);

CREATE TABLE "equipment_product_line" (
  "equipment_item_id" uuid NOT NULL,
  "product_line_identity_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  PRIMARY KEY ("equipment_item_id", "product_line_identity_id")
);

CREATE TABLE "certificate_identity" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "current_expiry_schedule_id" uuid
);

CREATE TABLE "certificate" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "identity_id" uuid NOT NULL,
  "group" certificate_group NOT NULL,
  "certificate_type_id" uuid NOT NULL,
  "custom_type_name" text,
  "not_held" boolean NOT NULL DEFAULT false,
  "number" text,
  "issuing_body" text,
  "issued_on" date,
  "expires_on" date,
  "status" record_status NOT NULL,
  "file_object_id" uuid
);

CREATE TABLE "product_line_certificate" (
  "product_line_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "certificate_identity_id" uuid NOT NULL,
  PRIMARY KEY ("product_line_id", "certificate_identity_id")
);

CREATE TABLE "document" (
  "id" uuid PRIMARY KEY,
  "section_revision_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "document_type_id" uuid NOT NULL,
  "custom_name" text,
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

CREATE TABLE "certificate_expiry_schedule" (
  "id" uuid PRIMARY KEY,
  "certificate_identity_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "generation" int NOT NULL,
  "state" certificate_schedule_state NOT NULL,
  "file_object_id" uuid,
  "file_version_id" uuid,
  "expires_on" date,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "created_by" uuid,
  CONSTRAINT "certificate_expiry_schedule_positive_generation" CHECK (generation > 0),
  CONSTRAINT "certificate_expiry_schedule_file_pair" CHECK ((file_object_id IS NULL) = (file_version_id IS NULL)),
  CONSTRAINT "certificate_expiry_schedule_active_snapshot" CHECK (state <> 'active' OR expires_on IS NOT NULL)
);

CREATE TABLE "certificate_expiry_notice" (
  "id" uuid PRIMARY KEY,
  "schedule_id" uuid NOT NULL,
  "threshold_days" int NOT NULL,
  "sent_at" timestamptz NOT NULL,
  CONSTRAINT "certificate_expiry_notice_threshold" CHECK (threshold_days IN (60, 30, 7, 0))
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
  "included_on" date,
  "active" boolean,
  "content_hash" text NOT NULL,
  "pulled_at" timestamptz NOT NULL,
  "is_current" boolean NOT NULL DEFAULT true
);

CREATE TABLE "imbc_note" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "author_id" uuid,
  "kind" imbc_note_kind NOT NULL DEFAULT 'general',
  "body" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "imbc_engagement" (
  "profile_id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "receipt_confirmed" boolean,
  "response" eoi_response,
  "response_summary" text,
  "ready_for_site_visit" boolean,
  "added_to_imbc_year" int,
  "folder_url" text
);

CREATE TABLE "imbc_eoi_email_event" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "sent_on" date NOT NULL
);

CREATE TABLE "imbc_engagement_source" (
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "source_entry_id" uuid NOT NULL,
  PRIMARY KEY ("profile_id", "source_entry_id")
);

CREATE TABLE "imbc_product_context" (
  "product_line_identity_id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "programme_id" uuid,
  "priority_id" uuid
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
  "execution_percent" numeric(5,2),
  "report_file_id" uuid,
  "comment" text,
  "requested_by_manufacturer" boolean NOT NULL DEFAULT false,
  "recorded_by" uuid,
  "updated_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "lps_company" (
  "id" uuid PRIMARY KEY,
  "name" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_by" uuid NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT (now()),
  "deleted_at" timestamptz,
  "deleted_by" uuid
);

CREATE TABLE "lps_company_country" (
  "lps_company_id" uuid NOT NULL,
  "country_id" uuid NOT NULL,
  PRIMARY KEY ("lps_company_id", "country_id")
);

CREATE TABLE "lps_entry" (
  "id" uuid PRIMARY KEY,
  "lps_company_id" uuid NOT NULL,
  "source_type_id" uuid NOT NULL,
  "scope_description" text NOT NULL,
  "status_id" uuid NOT NULL,
  "planned_launch" text,
  "comment" text,
  "investment_usd" numeric,
  "new_jobs" int,
  "last_updated_on" date,
  "migration_key" text UNIQUE,
  "created_by" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "updated_by" uuid NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT (now()),
  "deleted_at" timestamptz,
  "deleted_by" uuid
);

CREATE TABLE "lps_entry_commodity" (
  "lps_entry_id" uuid NOT NULL,
  "commodity_type_id" uuid NOT NULL,
  PRIMARY KEY ("lps_entry_id", "commodity_type_id")
);

CREATE TABLE "lps_entry_source" (
  "lps_entry_id" uuid NOT NULL,
  "import_row_id" uuid NOT NULL,
  PRIMARY KEY ("lps_entry_id", "import_row_id")
);

CREATE TABLE "lps_location" (
  "id" uuid PRIMARY KEY,
  "lps_entry_id" uuid NOT NULL,
  "city" text,
  "region_id" uuid,
  "sort_order" int NOT NULL DEFAULT 0
);

CREATE TABLE "lps_contact" (
  "id" uuid PRIMARY KEY,
  "lps_entry_id" uuid NOT NULL,
  "full_name" text,
  "role_title" text,
  "sort_order" int NOT NULL DEFAULT 0
);

CREATE TABLE "lps_contact_email" (
  "lps_contact_id" uuid NOT NULL,
  "email" text NOT NULL,
  "sort_order" int NOT NULL DEFAULT 0,
  PRIMARY KEY ("lps_contact_id", "email")
);

CREATE TABLE "lps_contact_phone" (
  "lps_contact_id" uuid NOT NULL,
  "phone" text NOT NULL,
  "sort_order" int NOT NULL DEFAULT 0,
  PRIMARY KEY ("lps_contact_id", "phone")
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

CREATE TABLE "account_nda_acceptance" (
  "id" uuid PRIMARY KEY,
  "user_account_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "nda_version_id" uuid NOT NULL,
  "accepted_at" timestamptz NOT NULL,
  "ip_address" text NOT NULL
);

CREATE TABLE "nda_acceptance" (
  "id" uuid PRIMARY KEY,
  "profile_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "nda_version_id" uuid NOT NULL,
  "account_nda_acceptance_id" uuid UNIQUE NOT NULL,
  "linked_at" timestamptz NOT NULL DEFAULT (now())
);

CREATE TABLE "forecast_version" (
  "id" uuid PRIMARY KEY,
  "horizon_end_year" int NOT NULL,
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
  "field" text,
  "problem" text NOT NULL,
  "source_values" jsonb,
  "resolution" text,
  "resolved_by" uuid,
  "resolved_at" timestamptz
);

CREATE TABLE "forecast_line" (
  "id" uuid PRIMARY KEY,
  "forecast_version_id" uuid NOT NULL,
  "row_number" int NOT NULL,
  "source_id" text,
  "kpved_code" text,
  "kpved_name" text,
  "kpved_entry_id" uuid,
  "tn_ved_code" text NOT NULL,
  "commodity_id" uuid NOT NULL,
  "subcommodity_id" uuid NOT NULL,
  "description" text NOT NULL,
  "unit_id" uuid NOT NULL,
  "total_quantity" numeric NOT NULL
);

CREATE TABLE "forecast_classification" (
  "subcommodity_id" uuid NOT NULL,
  "commodity_type_id" uuid NOT NULL,
  "approved_by" uuid NOT NULL,
  "approved_at" timestamptz NOT NULL,
  PRIMARY KEY ("subcommodity_id", "commodity_type_id")
);

CREATE TABLE "technical_requirements_product" (
  "id" uuid PRIMARY KEY,
  "organization_id" uuid NOT NULL,
  "commodity_group_id" uuid NOT NULL,
  "product_label" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT (now()),
  "retired_at" timestamptz
);

CREATE TABLE "technical_requirements_file" (
  "id" uuid PRIMARY KEY,
  "technical_requirements_product_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "kind" technical_requirements_kind NOT NULL,
  "file_object_id" uuid NOT NULL,
  "uploaded_by" uuid NOT NULL,
  "uploaded_at" timestamptz NOT NULL,
  "removed_at" timestamptz
);

CREATE TABLE "product_line_requirements_product" (
  "product_line_identity_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "technical_requirements_product_id" uuid NOT NULL,
  "approved_product_line_id" uuid NOT NULL,
  "approved_by" uuid NOT NULL,
  "approved_at" timestamptz NOT NULL,
  "revoked_by" uuid,
  "revoked_at" timestamptz,
  PRIMARY KEY ("product_line_identity_id", "technical_requirements_product_id")
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
  "legal_name" text,
  "name_en" text,
  "headcount" int,
  "workshop_count" int,
  "utilisation_percent" numeric(5,2),
  "unified_register_registered" boolean,
  "site_surveyed" boolean NOT NULL,
  "site_surveyed_on" date,
  "current_site_survey_id" uuid,
  "update_status" update_freshness NOT NULL,
  "tier" profile_tier NOT NULL,
  "verified_at" timestamptz,
  "registered_at" timestamptz,
  "pending_changes" boolean NOT NULL,
  "main_tn_ved_code" text,
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

CREATE TABLE "dictionary_alias" (
  "id" uuid PRIMARY KEY,
  "dictionary_id" uuid NOT NULL,
  "alias" text NOT NULL,
  "parent_entry_id" uuid,
  "dictionary_entry_id" uuid NOT NULL,
  "approved_by" uuid NOT NULL,
  "approved_at" timestamptz NOT NULL
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
  "source_kind" import_source_kind NOT NULL DEFAULT 'manufacturer',
  "source_filename" text NOT NULL,
  "trial" boolean NOT NULL DEFAULT true,
  "started_at" timestamptz NOT NULL,
  "finished_at" timestamptz,
  "started_by" uuid
);

CREATE TABLE "import_row" (
  "id" uuid PRIMARY KEY,
  "import_batch_id" uuid NOT NULL,
  "bin" text,
  "sheet_name" text,
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

CREATE UNIQUE INDEX "user_account_one_per_manufacturer" ON "user_account" ("organization_id") WHERE "role" = 'manufacturer';

CREATE UNIQUE INDEX ON "user_account" ("id", "organization_id");

CREATE UNIQUE INDEX ON "trusted_device" ("user_account_id", "identifier_hash");

CREATE UNIQUE INDEX "api_access_one_live_key" ON "api_access" ("organization_id") WHERE "revoked_at" IS NULL;

CREATE UNIQUE INDEX ON "manufacturer_profile" ("id", "organization_id");

CREATE UNIQUE INDEX ON "profile_section" ("profile_id", "kind");

CREATE UNIQUE INDEX ON "profile_section" ("id", "organization_id");

CREATE UNIQUE INDEX ON "section_revision" ("profile_section_id", "revision_number");

CREATE UNIQUE INDEX ON "section_revision" ("id", "organization_id");

CREATE UNIQUE INDEX "section_revision_one_working" ON "section_revision" ("profile_section_id") WHERE "state" = 'working';

CREATE UNIQUE INDEX ON "submission_requirement" ("section_revision_id", "dictionary_entry_id");

CREATE UNIQUE INDEX ON "main_information" ("id", "organization_id");

CREATE UNIQUE INDEX ON "main_information" ("section_revision_id", "organization_id");

CREATE UNIQUE INDEX ON "main_information_oked" ("main_information_id", "code");

CREATE UNIQUE INDEX ON "production_site_identity" ("id", "organization_id");

CREATE UNIQUE INDEX ON "production_site" ("main_information_id", "identity_id");

CREATE UNIQUE INDEX ON "production_site" ("id", "organization_id");

CREATE UNIQUE INDEX ON "contact" ("section_revision_id", "email");

CREATE UNIQUE INDEX ON "contact" ("section_revision_id", "phone");

CREATE UNIQUE INDEX "contact_one_focal_point" ON "contact" ("section_revision_id") WHERE "is_focal_point";

CREATE UNIQUE INDEX ON "personnel" ("id", "organization_id");

CREATE UNIQUE INDEX ON "product_line_identity" ("id", "organization_id");

CREATE UNIQUE INDEX ON "product_line" ("id", "organization_id");

CREATE UNIQUE INDEX ON "product_line" ("id", "identity_id", "organization_id");

CREATE UNIQUE INDEX ON "product_line" ("section_revision_id", "identity_id");

CREATE INDEX ON "product_line" ("organization_id", "unified_register_registration_number");

CREATE INDEX ON "product_line" ("organization_id", "tn_ved_code");

CREATE UNIQUE INDEX ON "product_line_kpved" ("product_line_id", "code");

CREATE UNIQUE INDEX ON "production" ("id", "organization_id");

CREATE UNIQUE INDEX ON "equipment_item" ("id", "organization_id");

CREATE UNIQUE INDEX ON "certificate_identity" ("id", "organization_id");

CREATE UNIQUE INDEX ON "certificate" ("id", "organization_id");

CREATE UNIQUE INDEX ON "certificate" ("section_revision_id", "identity_id");

CREATE UNIQUE INDEX ON "file_object" ("id", "organization_id");

CREATE UNIQUE INDEX ON "file_version" ("file_object_id", "version_number");

CREATE UNIQUE INDEX ON "file_version" ("id", "file_object_id");

CREATE UNIQUE INDEX "org_chart_sample_one_current" ON "org_chart_sample" ("is_current") WHERE "is_current";

CREATE UNIQUE INDEX ON "update_status_event" ("profile_id", "quarter_on", "kind");

CREATE UNIQUE INDEX ON "certificate_expiry_schedule" ("certificate_identity_id", "generation");

CREATE UNIQUE INDEX ON "certificate_expiry_schedule" ("id", "certificate_identity_id", "organization_id");

CREATE UNIQUE INDEX ON "certificate_expiry_notice" ("schedule_id", "threshold_days");

CREATE UNIQUE INDEX ON "due_diligence_check" ("profile_id", "position");

CREATE UNIQUE INDEX ON "external_check" ("profile_id", "connector");

CREATE UNIQUE INDEX ON "e_ondiris_record" ("bin", "registration_number", "content_hash");

CREATE UNIQUE INDEX "e_ondiris_record_one_current" ON "e_ondiris_record" ("bin", "registration_number") WHERE "is_current";

CREATE INDEX ON "e_ondiris_record" ("bin");

CREATE UNIQUE INDEX ON "imbc_eoi_email_event" ("profile_id", "sent_on");

CREATE INDEX ON "lps_entry" ("lps_company_id", "status_id");

CREATE INDEX ON "lps_entry" ("status_id");

CREATE INDEX ON "lps_entry" ("last_updated_on");

CREATE UNIQUE INDEX ON "lps_location" ("lps_entry_id", "city", "region_id") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX ON "works_with_mark" ("operator_organization_id", "profile_id");

CREATE UNIQUE INDEX "nda_version_one_current" ON "nda_version" ("is_current") WHERE "is_current";

CREATE UNIQUE INDEX ON "account_nda_acceptance" ("user_account_id", "nda_version_id");

CREATE UNIQUE INDEX ON "account_nda_acceptance" ("id", "organization_id", "nda_version_id");

CREATE UNIQUE INDEX ON "nda_acceptance" ("profile_id", "nda_version_id");

CREATE UNIQUE INDEX "forecast_version_one_current" ON "forecast_version" ("is_current") WHERE "is_current";

CREATE UNIQUE INDEX ON "forecast_line" ("forecast_version_id", "row_number");

CREATE INDEX ON "forecast_line" ("forecast_version_id", "tn_ved_code");

CREATE INDEX ON "forecast_line" ("forecast_version_id", "commodity_id", "subcommodity_id");

CREATE UNIQUE INDEX ON "technical_requirements_product" ("id", "organization_id");

CREATE UNIQUE INDEX ON "technical_requirements_product" ("organization_id", "commodity_group_id", "product_label");

CREATE UNIQUE INDEX "technical_requirements_file_one_live" ON "technical_requirements_file" ("technical_requirements_product_id", "kind") WHERE "removed_at" IS NULL;

CREATE UNIQUE INDEX ON "activity_snapshot" ("period", "period_start");

CREATE UNIQUE INDEX ON "activity_snapshot_count" ("activity_snapshot_id", "dimension", "dimension_key");

CREATE UNIQUE INDEX ON "catalog_profile_facet" ("profile_id", "facet", "code");

CREATE UNIQUE INDEX ON "dictionary_entry" ("dictionary_id", "code");

CREATE UNIQUE INDEX ON "dictionary_alias" ("dictionary_id", "parent_entry_id", "alias") NULLS NOT DISTINCT;

CREATE UNIQUE INDEX ON "policy_rule" ("role", "data_class", "action", "condition");

CREATE UNIQUE INDEX ON "import_row" ("import_batch_id", "excel_row_number");

COMMENT ON TABLE "organization" IS 'A manufacturer organisation has one profile and one account. An operator, observer, or IMBC organisation has one account per person.';

COMMENT ON COLUMN "organization"."id" IS 'UUIDv7';

COMMENT ON COLUMN "organization"."name" IS 'Registration name, or the name the administrator gives an operator, an observer, or IMBC. Operators read the manufacturer names from main_information.';

COMMENT ON COLUMN "organization"."bin" IS '12 digits. Required for a manufacturer, empty otherwise. Immutable. One BIN is one manufacturer organisation.';

COMMENT ON COLUMN "organization"."is_major_operator" IS 'Phase 1 marks exactly NCOC, TCO, and KPO. Other operator organisations can be added but do not enter the count out of three. Changing this counting set requires a business-rule change, not merely setting this flag on another organisation.';

COMMENT ON COLUMN "organization"."notification_mailbox" IS 'Set on the IMBC organisation. IMBC emails go here.';

COMMENT ON TABLE "user_account" IS 'Inactive means no sign-in for three months and is unrelated to profile update status. A blocked account is an administrator action.';

COMMENT ON COLUMN "user_account"."email" IS 'Login. For a manufacturer this is the company mailbox. Only an administrator changes it.';

COMMENT ON COLUMN "user_account"."name" IS 'The person, for every account except the manufacturer account.';

COMMENT ON COLUMN "user_account"."idp_subject" IS 'Subject in the OpenID Connect provider. Credentials stay there.';

COMMENT ON COLUMN "user_account"."auth_version" IS 'Incremented when the account is blocked or its role changes, which ends open sessions.';

COMMENT ON COLUMN "user_account"."failed_attempt_count" IS 'Read model of the configured identity provider counter (Keycloak or IMBC OIDC provider), never an independently incremented application counter. Refresh from provider events or queries; the provider is authoritative.';

COMMENT ON COLUMN "user_account"."locked_until" IS 'Read model of the identity provider temporary lock: fifteen minutes after ten failed sign-ins. The provider enforces and clears it; stale mirrors cannot override it. This is not the administrator-set state blocked.';

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

COMMENT ON COLUMN "manufacturer_profile"."completeness_percent" IS 'Computed. Average of the six sections other than production; source-only legal data and declared missing ISO types do not add manufacturer completion requirements. Send for review needs 100.';

COMMENT ON COLUMN "manufacturer_profile"."heard_about_us" IS 'Class B. IMBC only. Never shown to operators or observers.';

COMMENT ON COLUMN "manufacturer_profile"."bin_check_digit_valid" IS 'A migrated BIN that fails the check digit is flagged, not rejected.';

COMMENT ON COLUMN "manufacturer_profile"."migration_flags" IS 'OUT OF, N/A, unmapped values, duplicate candidates. Kept for IMBC.';

COMMENT ON COLUMN "manufacturer_profile"."accuracy_confirmed_at" IS 'Last time the manufacturer confirmed the data is accurate, on send.';

COMMENT ON TABLE "profile_section" IS 'Seven sections; shareholder entry was removed. The working revision is the section_revision of this section whose state is working. At most one.';

COMMENT ON COLUMN "profile_section"."verified_revision_id" IS 'What operators, observers, exports, and the pull API read.';

COMMENT ON COLUMN "profile_section"."pending_revision_id" IS 'Submitted revision waiting for the expert.';

COMMENT ON COLUMN "profile_section"."completeness_percent" IS 'Computed from the working revision. Production is stored and then left out of the profile average.';

COMMENT ON TABLE "section_revision" IS 'Copy-on-write. The next edit copies rows into a new working revision. A verified revision stays as history when a newer one replaces it. Class A while it is the verified revision, class B while it is working, pending, or rejected.';

COMMENT ON COLUMN "section_revision"."submitted_at" IS 'Set when the revision is frozen. A submitted or verified revision is never overwritten.';

COMMENT ON TABLE "submission_requirement" IS 'Mandatory certificate and document types, copied from the reference lists at the moment of send, so a later change to those lists does not rewrite a frozen revision.';

COMMENT ON TABLE "main_information" IS 'BIN and login email are owned by organization and user_account. Adata legal data and its complete OKED list are read-only and do not require manufacturer confirmation. Missing source values remain unavailable, not fabricated or turned into new required manual fields. Source refreshes follow immutable revision history. The manufacturer maintains production sites and company contact data. Registry diagnostic details remain available to IMBC; no separate legal/e-Ondiris completion tab is required from the manufacturer.';

COMMENT ON COLUMN "main_information"."legal_name" IS 'Company name. Adata source value, read-only; preserve its spelling. Migration supplies the initial company name until the source is available.';

COMMENT ON COLUMN "main_information"."name_en" IS 'Optional English name supplied in the migration workbook. Not an automatically translated or separately required legal name.';

COMMENT ON COLUMN "main_information"."legal_form_id" IS 'Adata legal form, normalized to legal_form. Read-only.';

COMMENT ON COLUMN "main_information"."director_full_name" IS 'Adata source value. Read-only.';

COMMENT ON COLUMN "main_information"."state_registered_on" IS 'Adata state registration date. Read-only.';

COMMENT ON COLUMN "main_information"."legal_address" IS 'Adata source value. Read-only. This is separate from editable production sites.';

COMMENT ON COLUMN "main_information"."company_phone" IS 'Required before submission. e-Ondiris, then Adata, then manufacturer; editable. International phone formats accepted.';

COMMENT ON COLUMN "main_information"."contact_email" IS 'Company contact email, not the login. e-Ondiris, then Adata, then manufacturer; editable.';

COMMENT ON COLUMN "main_information"."unified_register_registered" IS 'Yes when the local e-Ondiris read returns at least one product; migration seed until refreshed.';

COMMENT ON COLUMN "main_information"."unified_register_first_inclusion_on" IS 'Earliest registry inclusion date among products; migration seed until refreshed.';

COMMENT ON TABLE "main_information_oked" IS 'Read-only source rows. No second e-Ondiris OKED pair and no manual OKED selection.';

COMMENT ON COLUMN "main_information_oked"."code" IS 'Full OKED list from Adata. Text preserves leading zeros.';

COMMENT ON COLUMN "main_information_oked"."source_name" IS 'Name as returned by Adata; shown with its code.';

COMMENT ON COLUMN "main_information_oked"."oked_entry_id" IS 'Normalized dictionary match when available; an unmatched source code is shown as returned and flagged for IMBC.';

COMMENT ON COLUMN "main_information_oked"."position" IS 'Source order. No manufacturer-selected main OKED.';

COMMENT ON TABLE "company_founder" IS 'Only founders actually returned by Adata. Read-only legal information. No ownership-percentage entry, manual shareholder section, or 100-percent share validation.';

COMMENT ON TABLE "production_site_identity" IS 'Stable identity of a site across main-information revisions. Product links use this identity, so an address correction is shared by all linked products.';

COMMENT ON TABLE "production_site" IS 'At least one production site before initial submission. Added and corrected in main information, selected from that list on a product; no inline site creation on the product. Correcting a site updates the address shown for all linked products without per-product confirmation. Operators still read the verified main-information revision until the correction is verified. A referenced site must not be physically deleted.';

COMMENT ON COLUMN "production_site"."address" IS 'One text address. Required for a completed site. Prefilled from e-Ondiris when available, editable by the manufacturer.';

COMMENT ON COLUMN "production_site"."region_id" IS 'Region dictionary, for this production site, not the legal address. Required for a completed site.';

COMMENT ON COLUMN "production_site"."city" IS 'Required for a completed site. Do not infer an ambiguous locality from region_kato.';

COMMENT ON TABLE "contact" IS 'A contact is not an account. A revision needs at least three. The focal point is the contact IMBC and operators deal with first. An observer does not see the focal point.';

COMMENT ON COLUMN "contact"."role_id" IS 'management, technical, or commercial. A role may be used more than once. The three contacts do not have to cover all three roles.';

COMMENT ON TABLE "personnel" IS 'Manufacturer-entered counts. Adata does not prefill headcount. Total is the sum of the three categories and is not stored. The separate non-resident count is a subset and is not added again. No automatic local-staff threshold or score.';

COMMENT ON COLUMN "personnel"."managers_count" IS 'Required before submission; nonnegative.';

COMMENT ON COLUMN "personnel"."engineers_count" IS 'Required before submission; nonnegative.';

COMMENT ON COLUMN "personnel"."production_workers_count" IS 'Required before submission; nonnegative.';

COMMENT ON COLUMN "personnel"."nonresident_count" IS 'Required before submission. Whole-workforce non-resident count, not only managers. Between zero and total headcount.';

COMMENT ON TABLE "personnel_org_chart" IS 'At least one organisation-chart file before submission; multiple files are supported. No fixed maximum was confirmed. org_chart_sample supplies an optional sample.';

COMMENT ON TABLE "personnel_cv" IS 'Optional. One or more CV files.';

COMMENT ON TABLE "product_line_identity" IS 'Stable identity of one product line across copy-on-write revisions. Equipment links point here.';

COMMENT ON TABLE "product_line" IS 'At least one product before submission. Source-owned registry product facts cannot be edited or deleted by the manufacturer; local site and certificate associations remain editable under review. An added line matching an existing product name and TN VED is a duplicate; code alone is not a product identity. When a pull replaces an added duplicate, preserve its stable identity and local associations. Registry details not needed on the product card are read from the immutable e_ondiris_record snapshot referenced by this revision, not the latest unverified source row. Localization-level fields are neither fetched nor stored. Product certificates are reusable records linked below, not a single conformity file on this row.';

COMMENT ON COLUMN "product_line"."name_en" IS 'Required on a completed manually added line. Registry names are not translated.';

COMMENT ON COLUMN "product_line"."name_ru" IS 'Required on a completed manually added line. On a pulled line, stores the product name in the source spelling.';

COMMENT ON COLUMN "product_line"."commodity_type_id" IS 'IMBC commodity_type dictionary. Manufacturer selects the descriptive type; A-E group is its parent, not a second independent input. Required for a completed manual line.';

COMMENT ON COLUMN "product_line"."tn_ved_code" IS 'Text preserves leading zeros. Required on a completed manual line and chosen from TN VED reference data. Ten digits on a registry line; migration may require code/product resolution.';

COMMENT ON COLUMN "product_line"."production_site_identity_id" IS 'Select an existing site from this profile. Required for a completed manually added line. For a pulled line, associate the registry address only when unambiguous.';

COMMENT ON COLUMN "product_line"."capacity_quantity" IS 'Required with capacity_unit_id on a completed manually added line. Nonnegative annual quantity.';

COMMENT ON COLUMN "product_line"."capacity_unit_id" IS 'unit dictionary. Allowed manual capacity units: pieces, tonnes, metres, sets, per year.';

COMMENT ON COLUMN "product_line"."capacity_text" IS 'e-Ondiris capacity as returned, e.g. 8600.00 kg/year. No forced conversion into numeric/manual fields.';

COMMENT ON COLUMN "product_line"."in_country_value_share" IS 'Percent from e-Ondiris. A non-registry line always shows 0 and has no manufacturer input for this value.';

COMMENT ON COLUMN "product_line"."enstru_code" IS 'Registry procurement item code, shown with its name. No tender matching.';

COMMENT ON COLUMN "product_line"."unified_register_registration_number" IS 'Stable registry entry number for synchronization, not a separate manufacturer table column.';

COMMENT ON COLUMN "product_line"."unified_register_active" IS 'Excluded/expired registry records remain visible as not active. Null for a manually added line.';

COMMENT ON COLUMN "product_line"."note" IS 'Optional manufacturer product note. Separate from confidential IMBC notes.';

COMMENT ON COLUMN "product_line_kpved"."code" IS 'KPVED code, text with leading zeros preserved. One code per row.';

COMMENT ON COLUMN "product_line_kpved"."source_name" IS 'Registry or migration label as supplied, displayed with the code.';

COMMENT ON COLUMN "product_line_kpved"."kpved_entry_id" IS 'Resolved kpved dictionary entry. Required for manually selected codes; source mismatches are flagged, not silently renamed.';

COMMENT ON COLUMN "products_section"."unified_register_extract_id" IS 'One extract covering the company product list. Optional upload; attached in products, not main information or once per product.';

COMMENT ON TABLE "production" IS 'The whole section is optional and is excluded from profile completeness. An empty section has no row.';

COMMENT ON COLUMN "production"."utilisation_percent" IS '0 to 100.';

COMMENT ON TABLE "equipment_item" IS 'No equipment year. Equipment photos are linked to their own item; process photos use production_photo.';

COMMENT ON COLUMN "equipment_item"."section_revision_id" IS 'The production section revision.';

COMMENT ON COLUMN "equipment_item"."photo_file_id" IS 'Photo of this equipment item. Equipment details and attachments remain optional with the production section.';

COMMENT ON TABLE "equipment_product_line" IS 'Optional link to one or more product lines of the same manufacturer.';

COMMENT ON TABLE "certificate_identity" IS 'Stable identity across certificate-section revisions, allowing several product lines to reuse one certificate and its replacement file. The notification pointer does not select certificate content for operators: they continue to read only the verified section revision and its permitted file.';

COMMENT ON COLUMN "certificate_identity"."current_expiry_schedule_id" IS 'Current notification generation, independently of the verified certificate revision. Changed atomically with the new immutable schedule; null before the first saved schedule.';

COMMENT ON TABLE "certificate" IS 'Groups are company, product, other. ISO 9001, ISO 14001, and ISO 45001 are the go-live company requirements, each satisfied for completeness by a held certificate or explicit absence declaration. Product and other certificates are optional. A bare migrated certificate name is an incomplete claim, not not_held and not verified evidence. CT-KZ and the industrial certificate for internal circulation are not new certificate types. A registry extract is owned by products_section. Expired held certificates stay on the profile; active update status becomes outdated on expiry, not automatically unresponsive. Absence declarations never match the valid-held-certificate filter.';

COMMENT ON COLUMN "certificate"."custom_type_name" IS 'Required for an Other type.';

COMMENT ON COLUMN "certificate"."not_held" IS 'I do not have this certificate. Allowed for the three go-live ISO types only. Excludes that type from completeness; it does not create a held certificate.';

COMMENT ON COLUMN "certificate"."number" IS 'Required when entering a held certificate. Empty for an absence declaration.';

COMMENT ON COLUMN "certificate"."issuing_body" IS 'Free text, required for a held certificate; no issuing-body dictionary.';

COMMENT ON COLUMN "certificate"."issued_on" IS 'Required for a held certificate.';

COMMENT ON COLUMN "certificate"."expires_on" IS 'Optional for a certificate that does not expire.';

COMMENT ON COLUMN "certificate"."file_object_id" IS 'One file per held certificate. Required before submission. Renewal replaces the file while retaining file versions. Empty for not_held.';

COMMENT ON TABLE "product_line_certificate" IS 'Many product lines can reference the same uploaded product certificate; one product can reference several. Only a held certificate in the product group may be linked. The SME verifies applicability. Resolve certificate content from the appropriate section revision; pending certificate replacements do not leak into the operator view.';

COMMENT ON TABLE "document" IS 'Registration certificate and charter are mandatory; other documents follow administrator-set requirements. The licence block and licence-not-required declaration were removed. Additional documents can have a manufacturer-supplied name and file.';

COMMENT ON COLUMN "document"."custom_name" IS 'Required for an additional document whose type allows a custom name.';

COMMENT ON TABLE "file_object" IS 'The domain row points here. Bytes live in private object storage.';

COMMENT ON COLUMN "file_object"."organization_id" IS 'Owning organisation. Empty only for a survey PDF not yet matched to a BIN.';

COMMENT ON TABLE "file_version" IS 'File access and publication follow the applicable role and visibility rules. Earlier versions stay.';

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

COMMENT ON TABLE "certificate_expiry_schedule" IS 'Immutable generations anchored to the stable certificate identity, not to a deletable working certificate row. On a saved change to the file version, expiry date, or eligibility, lock certificate_identity, append the next generation, and replace its current_expiry_schedule_id in the same transaction. A retry with the same current snapshot is a no-op; a reverted date is a new generation. Only the pointed-to active generation may send, rechecked when dispatching, so superseded jobs cannot send stale reminders. Removing a certificate or discarding a draft stops or restores its current schedule as applicable through a new generation; old working rows may be deleted while identity and snapshots remain. Saving a stopped generation cancels old reminders without deleting history. Notices are independent of profile visibility and SME verification; operators never receive them or use this pointer to read pending certificate content. Preserve the before/after pointer and the triggering certificate values in audit.';

COMMENT ON COLUMN "certificate_expiry_schedule"."generation" IS 'Positive, increasing per stable certificate identity. Never reuse a generation, including when an expiry date changes back to an earlier value.';

COMMENT ON COLUMN "certificate_expiry_schedule"."state" IS 'active when a held certificate has an expiry date, including an incomplete draft without a file; stopped when reminders cease, including absent, removed, or non-expiring certificates. Historical active generations are not current.';

COMMENT ON COLUMN "certificate_expiry_schedule"."file_version_id" IS 'Exact file version at the time of saving. Both file IDs are null when no file has been uploaded; a later upload creates a new generation.';

COMMENT ON COLUMN "certificate_expiry_schedule"."expires_on" IS 'Expiry-date snapshot, independent of later changes to certificate rows. Null for a stopped non-expiring certificate.';

COMMENT ON COLUMN "certificate_expiry_schedule"."created_at" IS 'Schedule start. Never backfill thresholds already passed at this time, including the expiry-day email for an already expired saved certificate. Asia/Almaty.';

COMMENT ON TABLE "certificate_expiry_notice" IS 'Append-only delivery fact for one generation and threshold. Replacement of either the file or the expiry date creates a different generation and can send that threshold again. Claim/deliver idempotently with notification.dedup_key; recipient deduplication and daily batching remain separate. The dispatcher checks that this is still the current active generation. Earlier reminders and late expiry-day emails are never backfilled.';

COMMENT ON COLUMN "certificate_expiry_notice"."threshold_days" IS '60, 30, 7, or 0.';

COMMENT ON TABLE "site_survey_record" IS 'A profile is site surveyed while some record has result yes, a signed file, and, when an expiry date is set, that date is still in the future. A record with no expiry date stays site surveyed until IMBC sets a date that has passed. There is no automatic one-year or two-year term. The mark is derived, not stored on the profile. Site surveyed is tier 2. Several records over time.';

COMMENT ON COLUMN "site_survey_record"."file_object_id" IS 'The signed report. A migrated visit may have none, and then the profile is not site surveyed.';

COMMENT ON COLUMN "site_survey_record"."expires_on" IS 'Set by the person who records the survey.';

COMMENT ON COLUMN "site_survey_record"."comment" IS 'Class C. Operators see the report and the dates, not this comment.';

COMMENT ON TABLE "due_diligence_record" IS 'One current record per manufacturer. Every automatic replacement and SME override atomically appends complete before/after record values and the complete ordered before/after due_diligence_check arrays to audit_entry.diff, with author or system actor, time, and a shared operation ID. Record creation has an empty before value. Keep enough information to reconstruct every earlier result, source value, mark, subject, comment, report reference, and override; a generic changed message is insufficient. Audit history, not extra current-state rows, retains earlier runs. The check runs when the profile is created, on the same Adata read as the prefill, and again once a quarter from the last check. A BIN in a registration that never becomes a profile is not queried. Red keeps the profile off operator and observer views until an SME sets green or amber. Green and amber do not. Political-exposure lists are not used. The parts of the extended report that are not checks are not stored.';

COMMENT ON COLUMN "due_diligence_record"."checked_on" IS 'Class A. Operators and observers see this date.';

COMMENT ON COLUMN "due_diligence_record"."adata_result" IS 'The value the automatic scoring returned, before an SME change.';

COMMENT ON COLUMN "due_diligence_record"."result" IS 'Class C. The stored result, after any SME change. Green, amber, or red. Operators and observers do not see it.';

COMMENT ON COLUMN "due_diligence_record"."enhanced" IS 'Class A. Operators and observers see whether this was done, not the comment or the report.';

COMMENT ON TABLE "due_diligence_check" IS 'The lines of the current run. A scored yes is a finding. A shown-only yes is attention. No answer is not scored. A line Adata does not return is absent, not a row marked clear. Replacing the run replaces these current rows only after capturing their complete ordered values with the record in the same atomic audit operation; deleting previous results without reconstructable history is forbidden. Class C.';

COMMENT ON COLUMN "due_diligence_check"."group_name" IS 'Company enterprise, finance, procurement, or tax payments; the director; or a founder or beneficiary.';

COMMENT ON COLUMN "due_diligence_check"."subject_name" IS 'The company or the person this line is about.';

COMMENT ON COLUMN "due_diligence_check"."adata_value" IS 'Empty when the mark is no answer.';

COMMENT ON TABLE "external_check" IS 'Class C. Not read by the catalog, exports, or the pull API.';

COMMENT ON COLUMN "external_check"."is_mock" IS 'Phase 1: Adata is the real service. e-Ondiris is the local copy in e_ondiris_record, not a call when a section opens. Every other connector is a mock.';

COMMENT ON TABLE "external_check_attempt" IS 'A connector takes a BIN and returns a value, a status, a date, and a source. The Adata allowance is 3,000 BIN a month. One BIN is one request. A rate limit is not a finding.';

COMMENT ON COLUMN "external_check_attempt"."unavailable" IS 'Unavailability is never stored as a negative finding.';

COMMENT ON TABLE "e_ondiris_record" IS 'Versioned local copy of e-Ondiris. Changed source facts create an immutable snapshot; product revisions keep their snapshot ID so verified readers cannot see a later unverified pull through a join. There is no published API and opening a section does not call e-Ondiris. The barcode, AGSK-3, NTIN, the registry comment, the data source, and localization-level data are not fetched or stored. A failed daily pull is not a due-diligence finding.';

COMMENT ON COLUMN "e_ondiris_record"."place_name" IS 'region_kato as returned. A place name, not a KATO code.';

COMMENT ON COLUMN "e_ondiris_record"."content_hash" IS 'Detects a change. The daily pull writes new and changed rows.';

COMMENT ON COLUMN "e_ondiris_record"."is_current" IS 'Synchronization pointer only. Publishing a newer source snapshot clears this flag on the previous snapshot without rewriting its source facts.';

COMMENT ON TABLE "imbc_note" IS 'Class C. SMEs and the IMBC general director. Never an operator, an observer, a manufacturer, or an administrator.';

COMMENT ON TABLE "imbc_engagement" IS 'Class C historical company context for SMEs and IMBC GD. Yellow Review only fields are retained for review without creating a new EOI workflow. No duplicate operational AGAR, ranking, site-survey, or free-form source columns.';

COMMENT ON COLUMN "imbc_engagement"."receipt_confirmed" IS 'Historical EOI receipt. Null means unknown, not no.';

COMMENT ON COLUMN "imbc_engagement"."ready_for_site_visit" IS 'Historical readiness, not a survey or request. Null means unresolved/unknown.';

COMMENT ON COLUMN "imbc_engagement"."added_to_imbc_year" IS 'Historical year in the Excel database; not platform registration.';

COMMENT ON COLUMN "imbc_engagement"."folder_url" IS 'SharePoint/folder hyperlink target. Internal reference, not an uploaded attachment.';

COMMENT ON TABLE "imbc_eoi_email_event" IS 'Historical sent/resent dates from Excel. Ambiguous date strings remain in import_resolution. Recording one never sends an email.';

COMMENT ON TABLE "imbc_engagement_source" IS 'Acquisition-source dictionary. A composite source cell becomes several rows only after approved splitting and alias normalization. Independent of the manufacturer registration answer.';

COMMENT ON TABLE "imbc_product_context" IS 'Class C. Product-level context from the manufacturers workbook, separate from the operator-visible class G LPS register. Keep values unresolved in the migration journal when the product association is unclear; do not duplicate them across all company products.';

COMMENT ON COLUMN "imbc_product_context"."programme_id" IS 'programme dictionary, historical LC and LPS labels. Internal manufacturer context only; never creates an LPS entry or localization workflow.';

COMMENT ON COLUMN "imbc_product_context"."priority_id" IS 'imbc_priority dictionary, initially the approved source priorities 1 to 6. No public ranking.';

COMMENT ON TABLE "site_survey_request" IS 'A verified manufacturer asks for a site survey. The request names no product. It appears in the SME list and sends no email. It does not create a site_survey_record.';

COMMENT ON TABLE "agar_cdp_record" IS 'Tier 3 qualifying statuses are report_issued, recommendations_in_progress, and recommendation_issued. Requested, shortlisted, visit_done, technical_assessment_done, paused, and discontinued do not themselves establish tier 3. Historical statements about disengagement or missing SME require IMBC review before mapping to discontinued or paused; preserve the explanation as comment. No questionnaire. A manufacturer may request only for a product with an STR. A request sends no email and does not start a visit. Recommendations are not sent to operators.';

COMMENT ON COLUMN "agar_cdp_record"."product_line_identity_id" IS 'One record per product line. A manufacturer can have several, each on its own product.';

COMMENT ON COLUMN "agar_cdp_record"."kind" IS 'A finished CDP stays a CDP. New work is recorded as an AGAR.';

COMMENT ON COLUMN "agar_cdp_record"."execution_percent" IS 'Optional 0..100 execution progress. Distinct from workflow status and never used to determine tier. Only populate from migration after the scale is confirmed.';

COMMENT ON COLUMN "agar_cdp_record"."report_file_id" IS 'Not shown on the company page operators and observers see. Phase 1 does not send it to operators.';

COMMENT ON COLUMN "agar_cdp_record"."requested_by_manufacturer" IS 'Requested is used only when the manufacturer asked. IMBC can shortlist a product that has no request.';

COMMENT ON TABLE "lps_company" IS 'Class G. Reference identity shared by several LPS entries. Independent of organization, manufacturer_profile, BIN, and user accounts. SMEs, IMBC administrators, and the director may create, edit, or soft-delete it; deletion is refused while any non-deleted entry refers to it. Countries describe the supplied association, not inferred domicile or ownership. All business edits are audited. No external company-data connector runs for this record.';

COMMENT ON COLUMN "lps_company"."name" IS 'Nonblank company or local venture name as established by the SME. Not unique: a matching name alone does not establish identity.';

COMMENT ON TABLE "lps_company_country" IS 'Zero or more countries. Source spelling variants become approved dictionary aliases; no delimited country field and no assumption about foreign parent companies.';

COMMENT ON COLUMN "lps_company_country"."country_id" IS 'country dictionary, using ISO 3166-1 alpha-2 codes and translated labels. Kazakhstan is permitted.';

COMMENT ON TABLE "lps_entry" IS 'Class G. SMEs, IMBC administrators, and the director have full LPS business-data CRUD. Operators have only the read projection selected by the agreed design under LPS-09; manufacturers and observers have no access. Saved entries immediately update internal data and the permitted operator fields until soft-deleted, irrespective of status, launch period, manufacturer verification, or NDA. Referenced company must not be deleted. Company/scope/status plus the default source type suffice to create an entry; other business values are optional. No uniqueness constraint on company or scope: distinct proposals can concern the same company. Save child rows atomically with the entry and audit all changes. updated_at/updated_by reflect the latest entry, child, or shared-company edit affecting this displayed row; last_updated_on remains the business date. No approval, submission action, automatic status changes, notifications, tier effects, export subscription, or operator pull API.';

COMMENT ON COLUMN "lps_entry"."source_type_id" IS 'programme dictionary: LC or LPS. Historical Type column. New entries default to LPS in the application; display LC as LC (legacy). No workflow meaning.';

COMMENT ON COLUMN "lps_entry"."scope_description" IS 'Nonblank product, service (including maintenance), or confirmed combined scope being localized. No manufacturer product_line or TN VED is required.';

COMMENT ON COLUMN "lps_entry"."status_id" IS 'lps_status dictionary: planning, in_process, localized, on_hold. Selected directly by any IMBC staff role under LPS-03, with no required sequence.';

COMMENT ON COLUMN "lps_entry"."planned_launch" IS 'Optional YYYY, Q1..Q4 YYYY, quarter range such as Q4 2027 / Q1 2028, or TBD. Validate years, quarter numbers, and ordered range bounds on save. Canonical spacing; retain period precision. Null means not supplied; TBD means explicitly undecided. Chronological filter/sort bounds are derived, never stored as a fictitious exact launch date.';

COMMENT ON COLUMN "lps_entry"."comment" IS 'LPS business context. Operator visibility is defined by the agreed design under LPS-09. Internal manufacturer notes remain separate.';

COMMENT ON COLUMN "lps_entry"."investment_usd" IS 'Optional nonnegative USD amount. Preserve decimal precision; show two decimals in the table. Null is unknown, explicit zero is valid. Never duplicate a combined source amount across split entries.';

COMMENT ON COLUMN "lps_entry"."new_jobs" IS 'Optional nonnegative count. Null is unknown, explicit zero is valid. Do not duplicate a combined source count across split entries.';

COMMENT ON COLUMN "lps_entry"."last_updated_on" IS 'Optional IMBC-maintained date on which the business information was last updated, from source column S on migration. Does not advance merely because data was imported or saved.';

COMMENT ON COLUMN "lps_entry"."migration_key" IS 'Optional immutable key for the one-time source dataset, sheet, row, and SME-resolved scope. Reused across trial imports; not a company identity or user-facing number.';

COMMENT ON TABLE "lps_entry_commodity" IS 'Zero or more types per LPS scope, with groups derived from the selected types. Use approved aliases and parents, never positional pairing from multi-value source cells. Missing classification remains Unknown, including a service without a matching type.';

COMMENT ON COLUMN "lps_entry_commodity"."commodity_type_id" IS 'Existing commodity_type dictionary; its parent must be an A-E commodity_group.';

COMMENT ON TABLE "lps_entry_source" IS 'Restricted LPS migration provenance, visible to all three IMBC staff roles under LPS-03 and excluded from operator views. Original evidence is immutable; staff may record resolutions. Links every contributing source row from the accepted LPS migration to the resolved entry, including approved splits or merges. The import batch must have source_kind=lps. Source measures are allocated by SME or left unresolved; never copied into every split entry. Repeated trial runs retain the stable entry migration_key and company mapping.';

COMMENT ON TABLE "lps_location" IS 'Zero or more paired localization places. Region and city are not independent multi-value lists. No geocoding, manufacturer production site, or inferred city-to-region mapping is required.';

COMMENT ON COLUMN "lps_location"."city" IS 'Free-text localization city or settlement; trimmed on save.';

COMMENT ON COLUMN "lps_location"."region_id" IS 'Existing Kazakhstan region dictionary, including cities with separate region status.';

COMMENT ON TABLE "lps_contact" IS 'One of any number of focal points for this LPS entry, or an explicitly confirmed general company contact with no person name. Require at least a name, an email, or a phone. Missing roles and methods do not prevent saving. Related methods belong to this contact only after their association is established. There is no single-focal-point constraint and these records never trigger invitations or emails.';

COMMENT ON COLUMN "lps_contact"."full_name" IS 'Optional for a confirmed general company contact. A supplied person name is not an account identity.';

COMMENT ON COLUMN "lps_contact"."role_title" IS 'Optional free text; does not use the manufacturer management/technical/commercial role dictionary.';

COMMENT ON COLUMN "lps_contact_email"."email" IS 'One address, validated on save. Trim and use case-insensitive duplicate comparison within this contact.';

COMMENT ON COLUMN "lps_contact_phone"."phone" IS 'One international phone number, including country code and optional extension. Text preserves + and leading zeros; normalize format without changing the number.';

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

COMMENT ON TABLE "account_nda_acceptance" IS 'Append-only canonical NDA evidence scoped to the manufacturer account, including before password setup. Save atomically with accepted registration; the account and organisation can exist without a manufacturer_profile. A repeated request for the same account/version reuses this row without changing its time or IP; a new NDA version creates another row. Pending registration or invitation retries reuse the existing account identity and any existing profile, without overwriting acceptance evidence or resetting the profile to Draft. Migration itself does not fabricate consent: the same table captures the migrated first-sign-in tick and later-version acceptances. Only the manufacturer account of this organisation may accept for it. One tick covers the detailed forecast, STR, and KTRE; no name, position, or signature image is required.';

COMMENT ON COLUMN "account_nda_acceptance"."accepted_at" IS 'Original server-recorded time of the acceptance tick, including registration before a profile exists. Never replaced by password-setting or profile-creation time.';

COMMENT ON COLUMN "account_nda_acceptance"."ip_address" IS 'Address captured with the original acceptance.';

COMMENT ON TABLE "nda_acceptance" IS 'Append-only profile linkage, class B. On profile creation link the durable account acceptances idempotently in the same transaction. Whenever a profile already exists, including migrated first sign-in or acceptance of a later NDA version, save the account acceptance and its profile link atomically. Join account_nda_acceptance to read the original accepted_at and ip_address; do not duplicate or rewrite those facts here. Account, profile, and source acceptance must belong to the same manufacturer organisation. A profile may retain acceptances of earlier versions, but access requires the current version and Verified status. If the NDA changes between registration and password setup, preserve the original acceptance and obtain the new version before allowing gated content. Opening a section does not ask again when the current version is already accepted.';

COMMENT ON COLUMN "nda_acceptance"."account_nda_acceptance_id" IS 'Canonical consent facts. The composite reference guarantees that the source acceptance has the same organisation and NDA version.';

COMMENT ON COLUMN "nda_acceptance"."linked_at" IS 'Time the acceptance was linked to an existing profile, not the time of consent.';

COMMENT ON TABLE "forecast_version" IS 'Approved forecast source mapping is at the top of this DBML. No FPAL, per-operator quantities, operator names, or original operator files are retained in the forecast tables. Row count is source-dependent, not a fixed schema property.';

COMMENT ON COLUMN "forecast_version"."horizon_end_year" IS '2031 for the signed-off workbook. A later approved horizon is version metadata, not a new quantity column.';

COMMENT ON TABLE "forecast_import_issue" IS 'A faulty row is reported and withheld from publication without stopping valid rows. Missing required headers stop import before row processing. Unknown optional A-E crosswalks are informational and do not invalidate otherwise usable forecast rows.';

COMMENT ON COLUMN "forecast_import_issue"."source_values" IS 'Only permitted forecast columns needed to resolve this issue; exclude FPAL and any operator-specific extra columns. Preserve original negative/ambiguous values rather than correcting them silently.';

COMMENT ON COLUMN "forecast_import_issue"."resolution" IS 'Correction, approved mapping, or explicit acceptance of a negative quantity with its source meaning. Unresolved issues continue to withhold the faulty row.';

COMMENT ON TABLE "forecast_line" IS 'Manufacturer view columns: optional KPVED code/name, TN VED, forecast commodity, subcommodity, full description, unit, and total through the version horizon. Source id and row number are import provenance, not manufacturer-facing columns. A-E and manufacturer commodity type are available only through approved crosswalks. NDA-gated view/search/filter; no download or print.';

COMMENT ON COLUMN "forecast_line"."source_id" IS 'Optional input id. Blank in the signed-off workbook; not a unique product identity.';

COMMENT ON COLUMN "forecast_line"."kpved_code" IS 'Optional text. Blank in the signed-off workbook; preserve leading zeros when supplied.';

COMMENT ON COLUMN "forecast_line"."kpved_name" IS 'Optional supplied name, shown beside the KPVED code. Do not fabricate it when both source values are empty.';

COMMENT ON COLUMN "forecast_line"."kpved_entry_id" IS 'Resolved kpved dictionary entry when supplied code can be matched.';

COMMENT ON COLUMN "forecast_line"."tn_ved_code" IS 'Full code or source prefix, stored as text. Prefix search matches longer codes. Not a unique line key.';

COMMENT ON COLUMN "forecast_line"."commodity_id" IS 'forecast_commodity dictionary, distinct from manufacturer A-E commodity_group.';

COMMENT ON COLUMN "forecast_line"."subcommodity_id" IS 'forecast_subcommodity dictionary. Its parent must equal commodity_id.';

COMMENT ON COLUMN "forecast_line"."unit_id" IS 'unit dictionary, resolved by approved aliases. No unapproved quantity conversion.';

COMMENT ON COLUMN "forecast_line"."total_quantity" IS 'Quantity through forecast_version.horizon_end_year. Preserve fractional values. Zero is valid; missing/nonnumeric values require correction. A negative is publishable only after explicit IMBC acceptance recorded in its resolved import issue; never silently take the absolute value or change its sign.';

COMMENT ON TABLE "forecast_classification" IS 'Optional approved crosswalk from the forecast hierarchy to IMBC manufacturer commodity types; the A-E group is the type parent. Several mappings are allowed. No source workbook supplies this mapping; absence does not block publication. Crosswalk approval never edits the original forecast classification.';

COMMENT ON TABLE "technical_requirements_product" IS 'Stable IMBC content identity shared by STR and KTRE versions and approved manufacturer-product mappings. The group must be a commodity_group entry. Label changes do not change identity and are audited. Do not delete a referenced product. Content setup and maintenance use existing IMBC responsibilities; this is not a new application or approval workflow.';

COMMENT ON COLUMN "technical_requirements_product"."organization_id" IS 'Owning IMBC organisation; this is shared technical-requirements content, not a manufacturer product line.';

COMMENT ON COLUMN "technical_requirements_product"."commodity_group_id" IS 'The section groups files by commodity group, then by product.';

COMMENT ON COLUMN "technical_requirements_product"."product_label" IS 'The product as IMBC names it. Not a forecast line and not an operator.';

COMMENT ON COLUMN "technical_requirements_product"."retired_at" IS 'Retired products stay for history and cannot receive new mappings or qualify a new AGAR request.';

COMMENT ON TABLE "technical_requirements_file" IS 'IMBC text for one shared technical-requirements product, either STR or KTRE; display group and label come from that product. Retire the previous file row and add its replacement atomically, retaining history. Operator names, project names, and brands are already removed. Opened from the technical-requirements section, not from a forecast line. Zoom and scroll; no download or print. The platform does not parse the PDF. A product may have neither file. A file supplied in one language is shown in Kazakh, English, and Russian without translation. Class F. Only IMBC-owned content can be published or satisfy the STR gate.';

COMMENT ON COLUMN "technical_requirements_file"."organization_id" IS 'Same IMBC owner as the technical-requirements product and the file object.';

COMMENT ON TABLE "product_line_requirements_product" IS 'Explicit approved applicability, never inferred from label, group, or TN VED alone. This is review/setup metadata, not a new end-user approval screen or workflow. The manufacturer cannot approve mappings. A new AGAR request requires a non-revoked mapping to the currently verified product row, a non-retired requirements product, and its live STR file; KTRE alone is insufficient. SME review revalidates applicability when product description or TN VED materially changes. An unchanged copy-on-write product may carry the approval to its new verified row only after confirming those values are unchanged and auditing the carry-forward. Every approval, revocation, and reapproval keeps its previous values in audit. Later removal of STR prevents new requests but does not erase an existing AGAR/CDP record or its history.';

COMMENT ON COLUMN "product_line_requirements_product"."organization_id" IS 'Manufacturer owner of the product line, not the IMBC owner of the shared technical-requirements product.';

COMMENT ON COLUMN "product_line_requirements_product"."approved_product_line_id" IS 'Product row whose description and TN VED were reviewed for this mapping. Composite FK enforces the same stable identity and manufacturer tenant.';

COMMENT ON COLUMN "product_line_requirements_product"."approved_by" IS 'IMBC SME acting within the existing product review/content setup responsibilities.';

COMMENT ON TABLE "audit_entry" IS 'Append-only, partitioned by month, kept for 5 years. The director reads all of it. The administrator reads account events and LPS events; SMEs may read LPS events. No update and no delete.';

COMMENT ON COLUMN "audit_entry"."action" IS 'Includes sign-in, sign-out, refused requests, status changes, decisions, NDA acceptances, exports, downloads, company-page opens, and LPS create/update/soft-delete including company and child-record changes.';

COMMENT ON COLUMN "audit_entry"."diff" IS 'Structured before/after values and operation_id for correlated changes. A due-diligence replacement contains the full record and ordered check arrays before and after the operation, so earlier results can be reconstructed. System actions retain an explicit system actor in the event payload when user_account_id is null.';

COMMENT ON TABLE "activity_snapshot" IS 'Week and month counts of the register. Which company pages an operator opened stays in audit_entry, action company_page_opened. Contracts are not recorded.';

COMMENT ON TABLE "catalog_profile" IS 'Rebuilt from verified revisions and authorized class A facts. Geography comes from production_site through production_region facets, not a single legal-region field. A regional count counts distinct manufacturers once in each applicable production region; the overall manufacturer total remains distinct by profile. The operator API is wider than the export contract above. Observers do not receive the focal point or the tier-3 product list; neither role receives confidential IMBC data.';

COMMENT ON COLUMN "catalog_profile"."tier" IS 'Derived: verified is tier 1, site surveyed is tier 2. Tier 3 is recorded per product in catalog_tier3_product.';

COMMENT ON COLUMN "catalog_profile"."main_tn_ved_code" IS 'Derived from the current verified products revision: take the first nonblank product_line.tn_ved_code ordered by position_in_list ascending, then stable identity_id ascending. Null when no verified line has a code. Independent of active search filters; no manufacturer main-code input and no numerical sorting of codes.';

COMMENT ON COLUMN "catalog_profile"."works_with_major_count" IS 'Validated count out of three; never identifies other operators.';

COMMENT ON COLUMN "catalog_profile"."visible" IS 'Verified and due diligence green/amber; unresponsive remains visible.';

COMMENT ON TABLE "catalog_tier3_product" IS 'A product whose AGAR/CDP has status report_issued, recommendations_in_progress, or recommendation_issued. Operators see which products qualify. Observers see the profile tier only. Rebuilt with catalog_profile.';

COMMENT ON TABLE "catalog_profile_facet" IS 'Denormalised filter values for the visible profile. Rebuilt with catalog_profile.';

COMMENT ON TABLE "dictionary" IS 'LPS reuses region, commodity_type with commodity_group parents, and historical programme labels LC/LPS. country uses ISO 3166-1 alpha-2 codes. lps_status starts with planning (Planning), in_process (In process), localized (Localized), and on_hold (On hold). Administrators maintain dictionaries and approved aliases under ADM-08; all three IMBC staff roles select values while editing LPS entries. Status sort_order is presentation order, not a transition sequence. LPS business-record access is separately granted under LPS-03.';

COMMENT ON COLUMN "dictionary"."code" IS 'country, region, legal_form, oked, tn_ved, kpved, commodity_group, commodity_type, forecast_commodity, forecast_subcommodity, unit, acquisition_source, programme, lps_status, imbc_priority, process, equipment_type, contact_role, certificate_type, document_type.';

COMMENT ON COLUMN "dictionary_entry"."code" IS 'Official code where supplied, stored as text with leading zeros preserved. Named source lists without codes receive stable platform codes; forecast taxonomy codes are not copied from FPAL.';

COMMENT ON COLUMN "dictionary_entry"."parent_entry_id" IS 'commodity_type points to an A-E commodity_group; forecast_subcommodity points to forecast_commodity. They are separate hierarchies. Other lists use a parent only where defined.';

COMMENT ON COLUMN "dictionary_entry"."mandatory" IS 'Certificate types and document types only. The administrator sets it. The change applies to profiles submitted afterwards.';

COMMENT ON COLUMN "dictionary_entry"."custom_name_allowed" IS 'Other certificate and additional-document types.';

COMMENT ON COLUMN "dictionary_entry"."retired_at" IS 'A value in use is not deleted. Retiring hides it from new choices.';

COMMENT ON TABLE "dictionary_alias" IS 'Only an approved unambiguous alias maps to an entry in the same dictionary and parent. Unknown values are reviewed. Unit aliases do not carry implicit conversion factors. Dictionary entries in use are retired, never deleted.';

COMMENT ON COLUMN "dictionary_alias"."alias" IS 'Trimmed source spelling, with case normalized for lookup only where approved.';

COMMENT ON COLUMN "dictionary_alias"."parent_entry_id" IS 'Scopes an alias to a parent when a subcategory name is reused.';

COMMENT ON TABLE "dictionary_entry_translation" IS 'Interface strings live in language files. These rows are the reference-list names only.';

COMMENT ON TABLE "notification_rule" IS 'Rules as data. There is no notification inbox. Observers receive none of these emails.';

COMMENT ON COLUMN "notification_rule"."code" IS 'NOT-01 through NOT-17, plus the scenario rules that decide the recipient.';

COMMENT ON TABLE "notification" IS 'The send log. Certificate reminders and update-status emails also have their own idempotency tables.';

COMMENT ON COLUMN "notification"."dedup_key" IS 'One email per event and distinct address. Address match ignores case.';

COMMENT ON TABLE "policy_rule" IS 'Authoritative declarative policy rows, loaded into the authorisation library at startup; access tests are generated from the same rule dataset. Versioned repository data may seed or replace these rows only as a release, with no separately maintained imperative permission matrix. Nobody edits them in the interface. No role has every right. Class G LPS permits full business-data CRUD and internal list/detail/dashboard read for expert, administrator, and director. Operator list/detail/dashboard read uses only the fields selected by the agreed design under LPS-09. Hidden fields are omitted from responses and cannot affect operator search/filter/sort or drill-down. All other roles and operator mutations are denied. All IMBC staff may read LPS audit and migration evidence but cannot overwrite it. Active reads exclude soft-deleted entries and companies; no visible_profile or nda_accepted gate applies. LPS permissions do not grant additional rights in other modules; dictionary administration remains class E.';

COMMENT ON COLUMN "policy_rule"."condition" IS 'own_organisation, visible_profile, owner, nda_accepted, or none.';

COMMENT ON COLUMN "policy_rule"."effect" IS 'allow or deny.';

COMMENT ON TABLE "import_batch" IS 'Signed-off manufacturer source: 982 data rows and 816 distinct BIN values. Exact matching BINs group into one profile. Product rows follow the approved product/code associations: a source row may split into several product lines when the association is clear, or remain flagged until IMBC resolves it. Do not deduplicate products solely by their code or pair multi-value cells by position. Additional LPS source: Sheet1, 57 rows, no BIN requirement. Reconcile companies and independently managed scopes with the SME, preserving stable migration keys across trial runs. Source kind separates the two migrations; LPS never creates profiles or invitations. The forecast retains its separate import model.';

COMMENT ON COLUMN "import_batch"."trial" IS 'A trial sends no email and can be repeated.';

COMMENT ON TABLE "import_row" IS 'Journal of one run. Manufacturer trials upsert profiles by BIN and do not create a second profile. LPS trials reuse accepted company identities and entry migration keys, with each loaded entry linked to its accepted source row. Unresolved identities/scopes remain flagged, not invented. Splitting a source row never duplicates its investment or jobs. Source outcomes and resolution records account for all rows without exposing raw evidence to operators.';

COMMENT ON COLUMN "import_row"."bin" IS 'Manufacturer import only. Original BIN if present; missing/invalid identifiers can still be logged for review. Null for the supplied LPS source.';

COMMENT ON COLUMN "import_row"."sheet_name" IS 'Source sheet for reconciliation, including Sheet1 for LPS.';

COMMENT ON COLUMN "import_row"."raw" IS 'Original manufacturer or LPS cells, comments, formatting relevant to interpretation, and hyperlink targets. Restricted immutable migration evidence, never operator-visible. All three IMBC staff roles may read LPS evidence under LPS-03; manufacturer evidence remains restricted to SMEs and the director.';

COMMENT ON COLUMN "import_row"."flags" IS 'Unmapped values, OUT OF, N/A, duplicate candidates, a BIN that fails the check digit.';

COMMENT ON TABLE "import_resolution" IS 'Same-BIN rows are grouped by the approved mapping; conflicting repeated facts, possible duplicate companies, ambiguous code/product links, source percentage scales, and unmatched survey PDFs require resolution. Raw evidence remains in the import journal. Trial imports never create duplicate profiles or product lines.';

COMMENT ON COLUMN "import_resolution"."kind" IS 'unmapped_value, duplicate, invalid_bin, unmatched_survey_pdf, no_email; LPS also ambiguous_company, ambiguous_scope, contact_association, location_association, shared_measure.';

COMMENT ON COLUMN "import_resolution"."detail" IS 'Source cells and issue; after resolution, the approved value/association or reason it remains unknown.';

COMMENT ON COLUMN "import_resolution"."file_object_id" IS 'Set for a survey PDF whose CSV/XLSX/XLS mapping has no BIN or more than one candidate. Never extract BIN from PDF contents or OCR; IMBC confirms unresolved mappings.';

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

ALTER TABLE "main_information_oked" ADD FOREIGN KEY ("main_information_id", "organization_id") REFERENCES "main_information" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "main_information_oked" ADD FOREIGN KEY ("oked_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "contact" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "contact" ADD FOREIGN KEY ("role_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel_cv" ADD FOREIGN KEY ("personnel_id", "organization_id") REFERENCES "personnel" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel_cv" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_identity" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("identity_id", "organization_id") REFERENCES "product_line_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("commodity_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

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

ALTER TABLE "certificate_expiry_schedule" ADD FOREIGN KEY ("certificate_identity_id", "organization_id") REFERENCES "certificate_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate_expiry_schedule" ADD FOREIGN KEY ("file_object_id", "organization_id") REFERENCES "file_object" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate_expiry_schedule" ADD FOREIGN KEY ("file_version_id", "file_object_id") REFERENCES "file_version" ("id", "file_object_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate_expiry_schedule" ADD FOREIGN KEY ("created_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate_identity" ADD FOREIGN KEY ("current_expiry_schedule_id", "id", "organization_id") REFERENCES "certificate_expiry_schedule" ("id", "certificate_identity_id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate_expiry_notice" ADD FOREIGN KEY ("schedule_id") REFERENCES "certificate_expiry_schedule" ("id") DEFERRABLE INITIALLY IMMEDIATE;

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

ALTER TABLE "site_survey_request" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "site_survey_request" ADD FOREIGN KEY ("requested_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

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

ALTER TABLE "account_nda_acceptance" ADD FOREIGN KEY ("user_account_id", "organization_id") REFERENCES "user_account" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "account_nda_acceptance" ADD FOREIGN KEY ("nda_version_id") REFERENCES "nda_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "nda_acceptance" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "nda_acceptance" ADD FOREIGN KEY ("account_nda_acceptance_id", "organization_id", "nda_version_id") REFERENCES "account_nda_acceptance" ("id", "organization_id", "nda_version_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_version" ADD FOREIGN KEY ("imported_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_version" ADD FOREIGN KEY ("published_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_import_issue" ADD FOREIGN KEY ("forecast_version_id") REFERENCES "forecast_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_import_issue" ADD FOREIGN KEY ("resolved_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("forecast_version_id") REFERENCES "forecast_version" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_product" ADD FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_product" ADD FOREIGN KEY ("commodity_group_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_file" ADD FOREIGN KEY ("technical_requirements_product_id", "organization_id") REFERENCES "technical_requirements_product" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_file" ADD FOREIGN KEY ("file_object_id", "organization_id") REFERENCES "file_object" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "technical_requirements_file" ADD FOREIGN KEY ("uploaded_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_requirements_product" ADD FOREIGN KEY ("product_line_identity_id", "organization_id") REFERENCES "product_line_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_requirements_product" ADD FOREIGN KEY ("approved_product_line_id", "product_line_identity_id", "organization_id") REFERENCES "product_line" ("id", "identity_id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_requirements_product" ADD FOREIGN KEY ("technical_requirements_product_id") REFERENCES "technical_requirements_product" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_requirements_product" ADD FOREIGN KEY ("approved_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_requirements_product" ADD FOREIGN KEY ("revoked_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_entry" ADD FOREIGN KEY ("user_account_id") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_entry" ADD FOREIGN KEY ("organization_id") REFERENCES "organization" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "activity_snapshot_count" ADD FOREIGN KEY ("activity_snapshot_id") REFERENCES "activity_snapshot" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "catalog_profile" ADD FOREIGN KEY ("profile_id") REFERENCES "manufacturer_profile" ("id") DEFERRABLE INITIALLY IMMEDIATE;

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

ALTER TABLE "company_founder" ADD FOREIGN KEY ("main_information_id", "organization_id") REFERENCES "main_information" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_site_identity" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_site" ADD FOREIGN KEY ("main_information_id", "organization_id") REFERENCES "main_information" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_site" ADD FOREIGN KEY ("identity_id", "organization_id") REFERENCES "production_site_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "production_site" ADD FOREIGN KEY ("region_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel_org_chart" ADD FOREIGN KEY ("personnel_id", "organization_id") REFERENCES "personnel" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "personnel_org_chart" ADD FOREIGN KEY ("file_object_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("production_site_identity_id", "organization_id") REFERENCES "production_site_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line" ADD FOREIGN KEY ("capacity_unit_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_kpved" ADD FOREIGN KEY ("product_line_id", "organization_id") REFERENCES "product_line" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_kpved" ADD FOREIGN KEY ("kpved_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "products_section" ADD FOREIGN KEY ("section_revision_id", "organization_id") REFERENCES "section_revision" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "products_section" ADD FOREIGN KEY ("unified_register_extract_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "equipment_item" ADD FOREIGN KEY ("photo_file_id") REFERENCES "file_object" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate_identity" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "certificate" ADD FOREIGN KEY ("identity_id", "organization_id") REFERENCES "certificate_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_certificate" ADD FOREIGN KEY ("product_line_id", "organization_id") REFERENCES "product_line" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "product_line_certificate" ADD FOREIGN KEY ("certificate_identity_id", "organization_id") REFERENCES "certificate_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_engagement" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_eoi_email_event" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_engagement_source" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_engagement_source" ADD FOREIGN KEY ("source_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_product_context" ADD FOREIGN KEY ("profile_id", "organization_id") REFERENCES "manufacturer_profile" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_product_context" ADD FOREIGN KEY ("product_line_identity_id", "organization_id") REFERENCES "product_line_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_product_context" ADD FOREIGN KEY ("programme_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "imbc_product_context" ADD FOREIGN KEY ("priority_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "agar_cdp_record" ADD FOREIGN KEY ("product_line_identity_id", "organization_id") REFERENCES "product_line_identity" ("id", "organization_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("kpved_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("commodity_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("subcommodity_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_line" ADD FOREIGN KEY ("unit_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_classification" ADD FOREIGN KEY ("subcommodity_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_classification" ADD FOREIGN KEY ("commodity_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "forecast_classification" ADD FOREIGN KEY ("approved_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dictionary_alias" ADD FOREIGN KEY ("dictionary_id") REFERENCES "dictionary" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dictionary_alias" ADD FOREIGN KEY ("parent_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dictionary_alias" ADD FOREIGN KEY ("dictionary_entry_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "dictionary_alias" ADD FOREIGN KEY ("approved_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_company" ADD FOREIGN KEY ("created_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_company" ADD FOREIGN KEY ("updated_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_company" ADD FOREIGN KEY ("deleted_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_company_country" ADD FOREIGN KEY ("lps_company_id") REFERENCES "lps_company" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_company_country" ADD FOREIGN KEY ("country_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry" ADD FOREIGN KEY ("lps_company_id") REFERENCES "lps_company" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry" ADD FOREIGN KEY ("source_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry" ADD FOREIGN KEY ("status_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry" ADD FOREIGN KEY ("created_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry" ADD FOREIGN KEY ("updated_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry" ADD FOREIGN KEY ("deleted_by") REFERENCES "user_account" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry_commodity" ADD FOREIGN KEY ("lps_entry_id") REFERENCES "lps_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry_commodity" ADD FOREIGN KEY ("commodity_type_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry_source" ADD FOREIGN KEY ("lps_entry_id") REFERENCES "lps_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_entry_source" ADD FOREIGN KEY ("import_row_id") REFERENCES "import_row" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_location" ADD FOREIGN KEY ("lps_entry_id") REFERENCES "lps_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_location" ADD FOREIGN KEY ("region_id") REFERENCES "dictionary_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_contact" ADD FOREIGN KEY ("lps_entry_id") REFERENCES "lps_entry" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_contact_email" ADD FOREIGN KEY ("lps_contact_id") REFERENCES "lps_contact" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "lps_contact_phone" ADD FOREIGN KEY ("lps_contact_id") REFERENCES "lps_contact" ("id") DEFERRABLE INITIALLY IMMEDIATE;

CREATE TYPE "public"."account_state" AS ENUM('invited', 'active', 'inactive', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."capacity_unit" AS ENUM('pieces', 'tonnes', 'metres', 'sets');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('clean', 'findings', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."commodity_group" AS ENUM('A', 'B', 'C', 'D', 'E');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('management', 'technical', 'commercial');--> statement-breakpoint
CREATE TYPE "public"."dd_result" AS ENUM('no_issues', 'findings');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'under_review', 'verified', 'rejected', 'expired', 'missing');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('xlsx', 'csv');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('kk', 'ru', 'en');--> statement-breakpoint
CREATE TYPE "public"."mark_state" AS ENUM('waiting', 'validated', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('manufacturer', 'operator', 'spectator', 'imbc');--> statement-breakpoint
CREATE TYPE "public"."profile_section" AS ENUM('main', 'contacts', 'personnel', 'shareholders', 'products', 'production', 'certificates', 'documents');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('draft', 'submitted', 'under_review', 'verified', 'returned');--> statement-breakpoint
CREATE TYPE "public"."request_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."revision_state" AS ENUM('working', 'submitted', 'verified', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('manufacturer', 'expert', 'administrator', 'director', 'operator', 'spectator');--> statement-breakpoint
CREATE TYPE "public"."run_result" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."scan_state" AS ENUM('pending', 'clean', 'infected', 'type_mismatch');--> statement-breakpoint
CREATE TYPE "public"."snapshot_period" AS ENUM('week', 'month');--> statement-breakpoint
CREATE TYPE "public"."subscription_period" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."update_status" AS ENUM('active', 'outdated', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."value_source" AS ENUM('manual', 'migration', 'e_ondiris');--> statement-breakpoint
CREATE TABLE "activity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"period" "snapshot_period" NOT NULL,
	"period_start" date NOT NULL,
	"counts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"action" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"diff" jsonb,
	"is_account_event" boolean DEFAULT false NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "catalog_visible" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"bin" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_normalized" text NOT NULL,
	"region" text NOT NULL,
	"commodity_groups" "commodity_group"[] NOT NULL,
	"commodity_types" text[] NOT NULL,
	"tnved_codes" text[] NOT NULL,
	"kpved_codes" text[] NOT NULL,
	"oked_codes" text[] NOT NULL,
	"certificate_types" text[] NOT NULL,
	"certificates_valid_until" jsonb NOT NULL,
	"main_tnved" text,
	"headcount_total" smallint,
	"site_surveyed" boolean DEFAULT false NOT NULL,
	"unified_register" boolean DEFAULT false NOT NULL,
	"works_with_count" smallint DEFAULT 0 NOT NULL,
	"update_status" "update_status" NOT NULL,
	"pending_changes" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"card" jsonb NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionaries" (
	"code" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dictionary_code" text NOT NULL,
	"code" text NOT NULL,
	"label_kk" text NOT NULL,
	"label_ru" text NOT NULL,
	"label_en" text NOT NULL,
	"parent_code" text,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"subscription_id" uuid,
	"format" "export_format" NOT NULL,
	"filters" jsonb NOT NULL,
	"result" "run_result" NOT NULL,
	"row_count" integer,
	"bucket" text,
	"object_key" text,
	"sha256" text,
	"contract_version" text DEFAULT '1' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"format" "export_format" NOT NULL,
	"period" "subscription_period" NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version_id" uuid NOT NULL,
	"tnved" text NOT NULL,
	"commodity_group" "commodity_group" NOT NULL,
	"commodity_type" text NOT NULL,
	"description" text NOT NULL,
	"unit" text NOT NULL,
	"total_quantity" numeric(18, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"source_file_id" uuid,
	"import_report" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"imported_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nda_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"nda_version_id" uuid NOT NULL,
	"acceptor_name" text NOT NULL,
	"acceptor_position" text NOT NULL,
	"user_id" uuid NOT NULL,
	"ip" "inet" NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nda_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version" integer NOT NULL,
	"text_kk" text NOT NULL,
	"text_ru" text NOT NULL,
	"text_en" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	CONSTRAINT "nda_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient" text NOT NULL,
	"locale" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_spec_files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"commodity_group" "commodity_group" NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "api_access" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"issued_by" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"type" "organization_type" NOT NULL,
	"name" text NOT NULL,
	"bin" text,
	"is_major_operator" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"session_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responsibility_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"text_version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"auth_version" integer NOT NULL,
	"id_token_hint" text,
	"mfa_passed" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_devices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"idp_subject" text,
	"email" text NOT NULL,
	"full_name" text,
	"role" "role" NOT NULL,
	"state" "account_state" DEFAULT 'invited' NOT NULL,
	"locale" "locale" DEFAULT 'kk' NOT NULL,
	"last_sign_in_at" timestamp with time zone,
	"auth_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"custom_type_name" text,
	"number" text NOT NULL,
	"issuer" text NOT NULL,
	"issued_on" date NOT NULL,
	"expires_on" date,
	"file_id" uuid,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"position" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"role" "contact_role" NOT NULL,
	"is_focal_point" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	"file_id" uuid,
	"no_licence_required" boolean DEFAULT false NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_product_links" (
	"equipment_id" uuid NOT NULL,
	"product_line_id" uuid NOT NULL,
	CONSTRAINT "equipment_product_links_equipment_id_product_line_id_pk" PRIMARY KEY("equipment_id","product_line_id")
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"data_class" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"file_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"scan_state" "scan_state" DEFAULT 'pending' NOT NULL,
	"scanned_at" timestamp with time zone,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturer_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" "profile_status" DEFAULT 'draft' NOT NULL,
	"has_pending_changes" boolean DEFAULT false NOT NULL,
	"update_status" "update_status",
	"quarter_anchor_at" date,
	"missed_quarters" smallint DEFAULT 0 NOT NULL,
	"final_notice_due_at" date,
	"assigned_expert_id" uuid,
	"completeness_pct" smallint DEFAULT 0 NOT NULL,
	"heard_about_us" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"source" "value_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ru" text NOT NULL,
	"commodity_group" "commodity_group" NOT NULL,
	"commodity_type" text NOT NULL,
	"tnved" text NOT NULL,
	"kpved" text,
	"capacity_value" numeric(14, 2) NOT NULL,
	"capacity_unit" "capacity_unit" NOT NULL,
	"in_country_value_pct" numeric(5, 2),
	"localization_steps" smallint,
	"localization_steps_of" smallint,
	"conformity_file_id" uuid,
	"source" "value_source" DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_sections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"kind" "profile_section" NOT NULL,
	"verified_revision_id" uuid,
	"pending_revision_id" uuid,
	"working_revision_id" uuid,
	"completeness_pct" smallint DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_assignments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"expert_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"section_revision_id" uuid,
	"file_version_id" uuid,
	"decision" "decision" NOT NULL,
	"comment" text,
	"expert_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_revisions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"state" "revision_state" DEFAULT 'working' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" "value_source" DEFAULT 'manual' NOT NULL,
	"author_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shareholders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"revision_id" uuid NOT NULL,
	"name" text NOT NULL,
	"share_pct" numeric(5, 2) NOT NULL,
	"country" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "update_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"section" "profile_section",
	"confirmed_by" uuid NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "due_diligence_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"checked_on" date NOT NULL,
	"adata_result" "dd_result",
	"result" "dd_result" NOT NULL,
	"comment" text,
	"report_file_id" uuid,
	"enhanced_done" boolean DEFAULT false NOT NULL,
	"enhanced_comment" text,
	"enhanced_report_file_id" uuid,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_checks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"connector" text NOT NULL,
	"bin" text NOT NULL,
	"status" "check_status" NOT NULL,
	"value" jsonb,
	"source" text NOT NULL,
	"is_test_data" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imbc_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"text" text,
	"legacy" jsonb,
	"author_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imbc_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sender_id" uuid NOT NULL,
	"operator_org_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"profile_id" uuid,
	"state" "request_state" DEFAULT 'open' NOT NULL,
	"reply" text,
	"replied_by" uuid,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operator_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"sender_id" uuid NOT NULL,
	"operator_org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"section" "profile_section",
	"free_text" text,
	"state" "request_state" DEFAULT 'open' NOT NULL,
	"reply" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_visit_marks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"visited_on" date NOT NULL,
	"file_id" uuid,
	"decision" "decision",
	"decided_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_survey_notices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"survey_record_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_survey_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"visit_from" date,
	"visit_to" date,
	"result_yes" boolean NOT NULL,
	"report_file_id" uuid,
	"expires_on" date,
	"comment" text,
	"source" "value_source" DEFAULT 'manual' NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works_with_marks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"operator_org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"works_with" boolean NOT NULL,
	"state" "mark_state" DEFAULT 'waiting' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "catalog_visible" ADD CONSTRAINT "catalog_visible_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_visible" ADD CONSTRAINT "catalog_visible_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_entries" ADD CONSTRAINT "dictionary_entries_dictionary_code_dictionaries_code_fk" FOREIGN KEY ("dictionary_code") REFERENCES "public"."dictionaries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_owner_id_user_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_files" ADD CONSTRAINT "export_files_subscription_id_export_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."export_subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_subscriptions" ADD CONSTRAINT "export_subscriptions_owner_id_user_accounts_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_lines" ADD CONSTRAINT "forecast_lines_version_id_forecast_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."forecast_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_versions" ADD CONSTRAINT "forecast_versions_source_file_id_file_objects_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_versions" ADD CONSTRAINT "forecast_versions_imported_by_user_accounts_id_fk" FOREIGN KEY ("imported_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_acceptances" ADD CONSTRAINT "nda_acceptances_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_acceptances" ADD CONSTRAINT "nda_acceptances_nda_version_id_nda_versions_id_fk" FOREIGN KEY ("nda_version_id") REFERENCES "public"."nda_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_acceptances" ADD CONSTRAINT "nda_acceptances_user_id_user_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_versions" ADD CONSTRAINT "nda_versions_published_by_user_accounts_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_spec_files" ADD CONSTRAINT "tech_spec_files_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_access" ADD CONSTRAINT "api_access_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_access" ADD CONSTRAINT "api_access_issued_by_user_accounts_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_access" ADD CONSTRAINT "api_access_revoked_by_user_accounts_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsibility_acceptances" ADD CONSTRAINT "responsibility_acceptances_user_id_user_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_user_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_user_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_revision_id_section_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_revision_id_section_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_revision_id_section_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_revision_id_section_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_product_links" ADD CONSTRAINT "equipment_product_links_equipment_id_equipment_items_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_product_links" ADD CONSTRAINT "equipment_product_links_product_line_id_product_lines_id_fk" FOREIGN KEY ("product_line_id") REFERENCES "public"."product_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_user_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_profiles" ADD CONSTRAINT "manufacturer_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturer_profiles" ADD CONSTRAINT "manufacturer_profiles_assigned_expert_id_user_accounts_id_fk" FOREIGN KEY ("assigned_expert_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_lines" ADD CONSTRAINT "product_lines_revision_id_section_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_sections" ADD CONSTRAINT "profile_sections_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignments" ADD CONSTRAINT "review_assignments_expert_id_user_accounts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_assignment_id_review_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."review_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_section_revision_id_section_revisions_id_fk" FOREIGN KEY ("section_revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_expert_id_user_accounts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_revisions" ADD CONSTRAINT "section_revisions_section_id_profile_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."profile_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_revisions" ADD CONSTRAINT "section_revisions_author_id_user_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_revision_id_section_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."section_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_confirmations" ADD CONSTRAINT "update_confirmations_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "update_confirmations" ADD CONSTRAINT "update_confirmations_confirmed_by_user_accounts_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_records" ADD CONSTRAINT "due_diligence_records_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_records" ADD CONSTRAINT "due_diligence_records_report_file_id_file_objects_id_fk" FOREIGN KEY ("report_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_records" ADD CONSTRAINT "due_diligence_records_enhanced_report_file_id_file_objects_id_fk" FOREIGN KEY ("enhanced_report_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_records" ADD CONSTRAINT "due_diligence_records_changed_by_user_accounts_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_checks" ADD CONSTRAINT "external_checks_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_notes" ADD CONSTRAINT "imbc_notes_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_notes" ADD CONSTRAINT "imbc_notes_author_id_user_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_requests" ADD CONSTRAINT "imbc_requests_sender_id_user_accounts_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_requests" ADD CONSTRAINT "imbc_requests_operator_org_id_organizations_id_fk" FOREIGN KEY ("operator_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_requests" ADD CONSTRAINT "imbc_requests_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_requests" ADD CONSTRAINT "imbc_requests_replied_by_user_accounts_id_fk" FOREIGN KEY ("replied_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_notes" ADD CONSTRAINT "operator_notes_operator_org_id_organizations_id_fk" FOREIGN KEY ("operator_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_notes" ADD CONSTRAINT "operator_notes_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_notes" ADD CONSTRAINT "operator_notes_author_id_user_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_requests" ADD CONSTRAINT "operator_requests_sender_id_user_accounts_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_requests" ADD CONSTRAINT "operator_requests_operator_org_id_organizations_id_fk" FOREIGN KEY ("operator_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_requests" ADD CONSTRAINT "operator_requests_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_visit_marks" ADD CONSTRAINT "operator_visit_marks_operator_org_id_organizations_id_fk" FOREIGN KEY ("operator_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_visit_marks" ADD CONSTRAINT "operator_visit_marks_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_visit_marks" ADD CONSTRAINT "operator_visit_marks_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_visit_marks" ADD CONSTRAINT "operator_visit_marks_decided_by_user_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_visit_marks" ADD CONSTRAINT "operator_visit_marks_created_by_user_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_notices" ADD CONSTRAINT "site_survey_notices_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_notices" ADD CONSTRAINT "site_survey_notices_survey_record_id_site_survey_records_id_fk" FOREIGN KEY ("survey_record_id") REFERENCES "public"."site_survey_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_records" ADD CONSTRAINT "site_survey_records_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_records" ADD CONSTRAINT "site_survey_records_report_file_id_file_objects_id_fk" FOREIGN KEY ("report_file_id") REFERENCES "public"."file_objects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_records" ADD CONSTRAINT "site_survey_records_recorded_by_user_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_with_marks" ADD CONSTRAINT "works_with_marks_operator_org_id_organizations_id_fk" FOREIGN KEY ("operator_org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_with_marks" ADD CONSTRAINT "works_with_marks_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_with_marks" ADD CONSTRAINT "works_with_marks_requested_by_user_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works_with_marks" ADD CONSTRAINT "works_with_marks_decided_by_user_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_snapshots_uq" ON "activity_snapshots" USING btree ("period","period_start");--> statement-breakpoint
CREATE INDEX "audit_entries_at_idx" ON "audit_entries" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_entries_object_idx" ON "audit_entries" USING btree ("object_type","object_id");--> statement-breakpoint
CREATE INDEX "audit_entries_user_idx" ON "audit_entries" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "catalog_name_trgm_idx" ON "catalog_visible" USING gin ("name_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "catalog_groups_idx" ON "catalog_visible" USING gin ("commodity_groups");--> statement-breakpoint
CREATE INDEX "catalog_types_idx" ON "catalog_visible" USING gin ("commodity_types");--> statement-breakpoint
CREATE INDEX "catalog_certs_idx" ON "catalog_visible" USING gin ("certificate_types");--> statement-breakpoint
CREATE INDEX "catalog_oked_idx" ON "catalog_visible" USING gin ("oked_codes");--> statement-breakpoint
CREATE INDEX "catalog_region_idx" ON "catalog_visible" USING btree ("region");--> statement-breakpoint
CREATE INDEX "catalog_verified_idx" ON "catalog_visible" USING btree ("verified_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_entries_uq" ON "dictionary_entries" USING btree ("dictionary_code","code");--> statement-breakpoint
CREATE INDEX "export_files_owner_idx" ON "export_files" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "forecast_lines_filter_idx" ON "forecast_lines" USING btree ("version_id","commodity_group","commodity_type");--> statement-breakpoint
CREATE INDEX "forecast_lines_tnved_idx" ON "forecast_lines" USING btree ("version_id","tnved" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "nda_acceptances_uq" ON "nda_acceptances" USING btree ("profile_id","nda_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_sent_uq" ON "notifications_sent" USING btree ("code","dedupe_key",lower("recipient"));--> statement-breakpoint
CREATE UNIQUE INDEX "api_access_prefix_uq" ON "api_access" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_bin_uq" ON "organizations" USING btree ("bin") WHERE "organizations"."bin" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_devices_uq" ON "trusted_devices" USING btree ("user_id","device_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_email_uq" ON "user_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_idp_subject_uq" ON "user_accounts" USING btree ("idp_subject");--> statement-breakpoint
CREATE INDEX "user_accounts_org_idx" ON "user_accounts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "certificates_expires_idx" ON "certificates" USING btree ("expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_focal_point_uq" ON "contacts" USING btree ("revision_id") WHERE "contacts"."is_focal_point";--> statement-breakpoint
CREATE INDEX "contacts_revision_idx" ON "contacts" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_uq" ON "file_versions" USING btree ("file_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturer_profiles_org_uq" ON "manufacturer_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "manufacturer_profiles_status_idx" ON "manufacturer_profiles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_lines_revision_idx" ON "product_lines" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "product_lines_tnved_idx" ON "product_lines" USING btree ("tnved");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_sections_uq" ON "profile_sections" USING btree ("profile_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "section_revisions_number_uq" ON "section_revisions" USING btree ("section_id","number");--> statement-breakpoint
CREATE INDEX "external_checks_profile_idx" ON "external_checks" USING btree ("profile_id","connector");--> statement-breakpoint
CREATE INDEX "operator_notes_idx" ON "operator_notes" USING btree ("profile_id","operator_org_id");--> statement-breakpoint
CREATE INDEX "operator_requests_profile_idx" ON "operator_requests" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "site_survey_notices_uq" ON "site_survey_notices" USING btree ("survey_record_id");--> statement-breakpoint
CREATE INDEX "works_with_marks_idx" ON "works_with_marks" USING btree ("profile_id","operator_org_id");
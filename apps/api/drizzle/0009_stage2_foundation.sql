CREATE TYPE "public"."data_class" AS ENUM('a_register', 'b_manufacturer', 'c_imbc', 'd_operator', 'e_administration', 'f_forecast');--> statement-breakpoint
CREATE TYPE "public"."file_purpose" AS ENUM('organisation_chart', 'cv', 'unified_register_extract', 'conformity_certificate', 'production_photo', 'certificate_file', 'document_file', 'site_survey_report', 'due_diligence_report', 'enhanced_due_diligence_report', 'operator_visit_file', 'technical_requirements', 'agar_cdp_report', 'organisation_chart_sample', 'export');--> statement-breakpoint
CREATE TYPE "public"."file_scan_state" AS ENUM('pending', 'passed', 'rejected');--> statement-breakpoint
CREATE TABLE "dictionary" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dictionary_id" uuid NOT NULL,
	"code" text NOT NULL,
	"parent_entry_id" uuid,
	"mandatory" boolean,
	"custom_name_allowed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "dictionary_entry_code_ck" CHECK ("dictionary_entry"."code" <> '' and "dictionary_entry"."code" = btrim("dictionary_entry"."code")),
	CONSTRAINT "dictionary_entry_parent_ck" CHECK ("dictionary_entry"."parent_entry_id" <> "dictionary_entry"."id")
);
--> statement-breakpoint
CREATE TABLE "dictionary_entry_translation" (
	"dictionary_entry_id" uuid NOT NULL,
	"language" "locale" NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "dictionary_entry_translation_dictionary_entry_id_language_pk" PRIMARY KEY("dictionary_entry_id","language"),
	CONSTRAINT "dictionary_entry_translation_name_ck" CHECK ("dictionary_entry_translation"."name" <> '' and "dictionary_entry_translation"."name" = btrim("dictionary_entry_translation"."name"))
);
--> statement-breakpoint
CREATE TABLE "file_object" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"purpose" "file_purpose" NOT NULL,
	"data_class" "data_class" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"file_object_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"original_name" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"declared_media_type" text NOT NULL,
	"detected_media_type" text,
	"checksum" text NOT NULL,
	"scan_state" "file_scan_state" DEFAULT 'pending' NOT NULL,
	"scanned_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid,
	"storage_key" text NOT NULL,
	CONSTRAINT "file_version_number_ck" CHECK ("file_version"."version_number" > 0),
	CONSTRAINT "file_version_byte_size_ck" CHECK ("file_version"."byte_size" between 1 and 26214400)
);
--> statement-breakpoint
CREATE TABLE "org_chart_sample" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"file_object_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"rule_code" text NOT NULL,
	"recipient_email" text NOT NULL,
	"user_account_id" uuid,
	"language" "locale" NOT NULL,
	"dedup_key" text NOT NULL,
	"related_object_type" text,
	"related_object_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"event" text NOT NULL,
	"recipient_rule" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_rule_code_uq" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "dictionary_entry" ADD CONSTRAINT "dictionary_entry_dictionary_id_dictionary_id_fk" FOREIGN KEY ("dictionary_id") REFERENCES "public"."dictionary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_entry" ADD CONSTRAINT "dictionary_entry_parent_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("parent_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_entry_translation" ADD CONSTRAINT "dictionary_entry_translation_entry_fk" FOREIGN KEY ("dictionary_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_object" ADD CONSTRAINT "file_object_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_version" ADD CONSTRAINT "file_version_file_object_id_file_object_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_version" ADD CONSTRAINT "file_version_uploaded_by_user_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_sample" ADD CONSTRAINT "org_chart_sample_file_object_id_file_object_id_fk" FOREIGN KEY ("file_object_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_chart_sample" ADD CONSTRAINT "org_chart_sample_uploaded_by_user_accounts_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_rule_code_notification_rule_code_fk" FOREIGN KEY ("rule_code") REFERENCES "public"."notification_rule"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_account_id_user_accounts_id_fk" FOREIGN KEY ("user_account_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_code_uq" ON "dictionary" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_entry_code_uq" ON "dictionary_entry" USING btree ("dictionary_id",lower("code") text_pattern_ops);--> statement-breakpoint
CREATE INDEX "dictionary_entry_translation_name_trgm" ON "dictionary_entry_translation" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "file_object_id_org_uq" ON "file_object" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_version_number_uq" ON "file_version" USING btree ("file_object_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "file_version_storage_key_uq" ON "file_version" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "file_version_pending_idx" ON "file_version" USING btree ("uploaded_at") WHERE "file_version"."scan_state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "org_chart_sample_file_uq" ON "org_chart_sample" USING btree ("file_object_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_chart_sample_current_uq" ON "org_chart_sample" USING btree ("is_current") WHERE "org_chart_sample"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "notification_dedup_uq" ON "notification" USING btree ("dedup_key");--> statement-breakpoint
CREATE INDEX "notification_account_idx" ON "notification" USING btree ("user_account_id","sent_at");--> statement-breakpoint
CREATE INDEX "notification_related_idx" ON "notification" USING btree ("related_object_type","related_object_id");
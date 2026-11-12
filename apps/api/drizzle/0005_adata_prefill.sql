CREATE TYPE "public"."connector_code" AS ENUM('adata', 'e_ondiris', 'accounting', 'legal_entity_registry');--> statement-breakpoint
CREATE TYPE "public"."external_check_state" AS ENUM('queued', 'polling', 'received', 'unavailable', 'not_configured', 'quota_exhausted');--> statement-breakpoint
CREATE TYPE "public"."external_check_trigger" AS ENUM('profile_created', 'quarterly', 'sme_rerun', 'import');--> statement-breakpoint
CREATE TYPE "public"."prefill_field" AS ENUM('legal_name', 'activity', 'company_phone', 'company_email', 'legal_address', 'director_full_name', 'state_registered_on', 'legal_form', 'shareholders');--> statement-breakpoint
CREATE TYPE "public"."prefill_source" AS ENUM('adata', 'e_ondiris');--> statement-breakpoint
CREATE TABLE "adata_allowance" (
	"period_start" date PRIMARY KEY NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adata_allowance_used_check" CHECK ("adata_allowance"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "external_check" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"connector" "connector_code" NOT NULL,
	"is_mock" boolean DEFAULT false NOT NULL,
	"latest_attempt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_check_attempt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"external_check_id" uuid NOT NULL,
	"trigger" "external_check_trigger" NOT NULL,
	"state" "external_check_state" DEFAULT 'queued' NOT NULL,
	"bin" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_sent_at" timestamp with time zone,
	"allowance_period" date,
	"poll_token" text,
	"completed_at" timestamp with time zone,
	"failure" text,
	"value" jsonb,
	"source" text,
	"is_test_data" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prefilled_value" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"source" "prefill_source" NOT NULL,
	"field" "prefill_field" NOT NULL,
	"position" smallint NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"read_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_check" ADD CONSTRAINT "external_check_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_check" ADD CONSTRAINT "external_check_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_check" ADD CONSTRAINT "external_check_latest_attempt_id_external_check_attempt_id_fk" FOREIGN KEY ("latest_attempt_id") REFERENCES "public"."external_check_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_check_attempt" ADD CONSTRAINT "external_check_attempt_external_check_id_external_check_id_fk" FOREIGN KEY ("external_check_id") REFERENCES "public"."external_check"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prefilled_value" ADD CONSTRAINT "prefilled_value_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prefilled_value" ADD CONSTRAINT "prefilled_value_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prefilled_value" ADD CONSTRAINT "prefilled_value_attempt_id_external_check_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."external_check_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_check_profile_connector_uq" ON "external_check" USING btree ("profile_id","connector");--> statement-breakpoint
CREATE UNIQUE INDEX "external_check_attempt_created_uq" ON "external_check_attempt" USING btree ("external_check_id") WHERE "external_check_attempt"."trigger" = 'profile_created';--> statement-breakpoint
CREATE UNIQUE INDEX "prefilled_value_uq" ON "prefilled_value" USING btree ("attempt_id","field","position");--> statement-breakpoint
CREATE INDEX "prefilled_value_profile_idx" ON "prefilled_value" USING btree ("profile_id","source");
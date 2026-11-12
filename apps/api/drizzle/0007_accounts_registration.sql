CREATE TABLE "nda_version" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"version_number" integer NOT NULL,
	"body" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "nda_version_number_ck" CHECK ("nda_version"."version_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "nda_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"nda_version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"ip_address" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "notification_mailbox" text;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "platform_terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "personal_data_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "registration_nda_version_id" uuid;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "registration_nda_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "registration_ip" "inet";--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "registration_heard_about_us" text;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "inactive_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nda_version" ADD CONSTRAINT "nda_version_published_by_user_accounts_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD CONSTRAINT "nda_acceptance_profile_id_manufacturer_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD CONSTRAINT "nda_acceptance_nda_version_id_nda_version_id_fk" FOREIGN KEY ("nda_version_id") REFERENCES "public"."nda_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "nda_version_number_uq" ON "nda_version" USING btree ("version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "nda_version_current_uq" ON "nda_version" USING btree ("is_current") WHERE "nda_version"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "nda_acceptance_uq" ON "nda_acceptance" USING btree ("profile_id","nda_version_id");--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_registration_nda_version_id_nda_version_id_fk" FOREIGN KEY ("registration_nda_version_id") REFERENCES "public"."nda_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_imbc_uq" ON "organizations" USING btree ("type") WHERE "organizations"."type" = 'imbc';--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_name_uq" ON "organizations" USING btree ("type",lower("name")) WHERE "organizations"."type" <> 'manufacturer';--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_manufacturer_org_uq" ON "user_accounts" USING btree ("organization_id") WHERE "user_accounts"."role" = 'manufacturer';--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_mailbox_imbc_ck" CHECK ("organizations"."notification_mailbox" is null or "organizations"."type" = 'imbc');--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_registration_nda_ck" CHECK (num_nulls("user_accounts"."registration_nda_version_id", "user_accounts"."registration_nda_accepted_at", "user_accounts"."registration_ip") in (0, 3));
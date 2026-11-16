-- The generated unique indexes must precede composite foreign keys that depend on them.
CREATE TYPE "public"."certificate_group" AS ENUM('company', 'product', 'other');
--> statement-breakpoint
CREATE TYPE "public"."product_line_source" AS ENUM('manual', 'e_ondiris', 'migration');
--> statement-breakpoint
CREATE TYPE "public"."record_status" AS ENUM('uploaded', 'under_review', 'verified', 'rejected', 'expired', 'missing');
--> statement-breakpoint
CREATE TYPE "public"."revision_origin" AS ENUM('manufacturer', 'migration', 'source_refresh');
--> statement-breakpoint
CREATE TYPE "public"."section_kind" AS ENUM('main_information', 'contacts', 'personnel', 'products', 'production', 'certificates', 'documents');
--> statement-breakpoint
CREATE TABLE "certificate_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"current_expiry_schedule_id" uuid,
	CONSTRAINT "certificate_identity_schedule_reserved_ck" CHECK ("certificate_identity"."current_expiry_schedule_id" is null)
);
--> statement-breakpoint
CREATE TABLE "product_line_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_site_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_section" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "section_kind" NOT NULL,
	"verified_revision_id" uuid,
	"pending_revision_id" uuid,
	"working_revision_id" uuid,
	"completeness_percent" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "section_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_section_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"state" "revision_state" DEFAULT 'working' NOT NULL,
	"origin" "revision_origin" DEFAULT 'manufacturer' NOT NULL,
	"author_id" uuid,
	"completeness_percent" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"saved_at" timestamp with time zone,
	"edit_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"group" "certificate_group",
	"certificate_type_id" uuid,
	"custom_type_name" text,
	"not_held" boolean DEFAULT false NOT NULL,
	"number" text,
	"issuing_body" text,
	"issued_on" date,
	"expires_on" date,
	"status" "record_status" DEFAULT 'uploaded' NOT NULL,
	"file_object_id" uuid,
	CONSTRAINT "certificate_absence_ck" CHECK (not "certificate"."not_held" or ("certificate"."file_object_id" is null and "certificate"."number" is null and "certificate"."issuing_body" is null and "certificate"."issued_on" is null and "certificate"."expires_on" is null))
);
--> statement-breakpoint
CREATE TABLE "company_founder" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"main_information_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position_in_list" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"full_name" text,
	"position" text,
	"email" text,
	"phone" text,
	"role_id" uuid,
	"is_focal_point" boolean DEFAULT false NOT NULL,
	"position_in_list" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_type_id" uuid,
	"custom_name" text,
	"status" "record_status" DEFAULT 'uploaded' NOT NULL,
	"file_object_id" uuid
);
--> statement-breakpoint
CREATE TABLE "equipment_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text,
	"equipment_type_id" uuid,
	"quantity" integer,
	"position_in_list" integer DEFAULT 0 NOT NULL,
	"photo_file_id" uuid,
	CONSTRAINT "equipment_item_quantity_ck" CHECK ("equipment_item"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "equipment_product_line" (
	"equipment_item_id" uuid NOT NULL,
	"product_line_identity_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "equipment_product_line_equipment_item_id_product_line_identity_id_pk" PRIMARY KEY("equipment_item_id","product_line_identity_id")
);
--> statement-breakpoint
CREATE TABLE "main_information" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"legal_name" text,
	"name_en" text,
	"legal_form_id" uuid,
	"legal_form_source_name" text,
	"director_full_name" text,
	"state_registered_on" date,
	"legal_address" text,
	"legal_data_checked_at" timestamp with time zone,
	"website" text,
	"company_phone" text,
	"contact_email" text,
	"unified_register_registered" boolean,
	"unified_register_first_inclusion_on" date
);
--> statement-breakpoint
CREATE TABLE "main_information_oked" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"main_information_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"source_name" text,
	"oked_entry_id" uuid,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"managers_count" integer,
	"engineers_count" integer,
	"production_workers_count" integer,
	"nonresident_count" integer,
	CONSTRAINT "personnel_counts_ck" CHECK (coalesce("personnel"."managers_count",0) >= 0 and coalesce("personnel"."engineers_count",0) >= 0 and coalesce("personnel"."production_workers_count",0) >= 0 and coalesce("personnel"."nonresident_count",0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "personnel_cv" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"personnel_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_object_id" uuid NOT NULL,
	"position_in_list" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personnel_org_chart" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"personnel_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_object_id" uuid NOT NULL,
	"position_in_list" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_line" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"name_en" text,
	"name_ru" text,
	"commodity_type_id" uuid,
	"tn_ved_code" text,
	"tn_ved_entry_id" uuid,
	"production_site_identity_id" uuid,
	"capacity_quantity" numeric,
	"capacity_unit_id" uuid,
	"capacity_text" text,
	"in_country_value_share" numeric(5, 2),
	"enstru_code" text,
	"enstru_name" text,
	"e_ondiris_record_id" uuid,
	"unified_register_registration_number" text,
	"unified_register_active" boolean,
	"unified_register_included_on" date,
	"note" text,
	"source" "product_line_source" DEFAULT 'manual' NOT NULL,
	"position_in_list" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_line_capacity_ck" CHECK ("product_line"."capacity_quantity" >= 0),
	CONSTRAINT "product_line_share_ck" CHECK ("product_line"."in_country_value_share" between 0 and 100),
	CONSTRAINT "product_line_source_snapshot_reserved_ck" CHECK ("product_line"."e_ondiris_record_id" is null)
);
--> statement-breakpoint
CREATE TABLE "product_line_certificate" (
	"product_line_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"certificate_identity_id" uuid NOT NULL,
	CONSTRAINT "product_line_certificate_product_line_id_certificate_identity_id_pk" PRIMARY KEY("product_line_id","certificate_identity_id")
);
--> statement-breakpoint
CREATE TABLE "product_line_kpved" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_line_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"source_name" text,
	"kpved_entry_id" uuid,
	"position_in_list" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"area_sqm" numeric,
	"workshop_count" integer,
	"utilisation_percent" numeric(5, 2),
	CONSTRAINT "production_values_ck" CHECK ("production"."area_sqm" >= 0 and "production"."workshop_count" >= 0 and "production"."utilisation_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "production_photo" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"production_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"file_object_id" uuid NOT NULL,
	"position_in_list" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_process" (
	"production_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"process_entry_id" uuid NOT NULL,
	CONSTRAINT "production_process_production_id_process_entry_id_pk" PRIMARY KEY("production_id","process_entry_id")
);
--> statement-breakpoint
CREATE TABLE "production_site" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"main_information_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"address" text,
	"region_id" uuid,
	"city" text,
	"position_in_list" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products_section" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"unified_register_extract_id" uuid
);
--> statement-breakpoint
CREATE TABLE "revision_file_version" (
	"section_revision_id" uuid NOT NULL,
	"file_object_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	CONSTRAINT "revision_file_version_section_revision_id_file_object_id_pk" PRIMARY KEY("section_revision_id","file_object_id")
);
--> statement-breakpoint
CREATE TABLE "submission_requirement" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"dictionary_entry_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" ADD COLUMN "completeness_percent" numeric DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" ADD COLUMN "migrated" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" ADD COLUMN "bin_check_digit_valid" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" ADD COLUMN "migration_flags" jsonb;
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" ADD COLUMN "accuracy_confirmed_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_identity_id_org_uq" ON "certificate_identity" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_line_identity_id_org_uq" ON "product_line_identity" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_site_identity_id_org_uq" ON "production_site_identity" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "profile_section_profile_kind_uq" ON "profile_section" USING btree ("profile_id","kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "profile_section_id_org_uq" ON "profile_section" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "section_revision_number_uq" ON "section_revision" USING btree ("profile_section_id","revision_number");
--> statement-breakpoint
CREATE UNIQUE INDEX "section_revision_id_org_uq" ON "section_revision" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "section_revision_id_section_org_uq" ON "section_revision" USING btree ("id","profile_section_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "section_revision_working_uq" ON "section_revision" USING btree ("profile_section_id") WHERE "section_revision"."state" = 'working';
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_id_org_uq" ON "certificate" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "certificate_revision_identity_uq" ON "certificate" USING btree ("section_revision_id","identity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_id_org_uq" ON "contact" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_email_uq" ON "contact" USING btree ("section_revision_id","email");
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_phone_uq" ON "contact" USING btree ("section_revision_id","phone");
--> statement-breakpoint
CREATE UNIQUE INDEX "contact_focal_point_uq" ON "contact" USING btree ("section_revision_id") WHERE "contact"."is_focal_point";
--> statement-breakpoint
CREATE UNIQUE INDEX "document_id_org_uq" ON "document" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_item_id_org_uq" ON "equipment_item" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "main_information_id_org_uq" ON "main_information" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "main_information_revision_uq" ON "main_information" USING btree ("section_revision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "main_information_revision_org_uq" ON "main_information" USING btree ("section_revision_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "main_information_oked_code_uq" ON "main_information_oked" USING btree ("main_information_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "personnel_id_org_uq" ON "personnel" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "personnel_revision_uq" ON "personnel" USING btree ("section_revision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_line_id_org_uq" ON "product_line" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_line_revision_identity_uq" ON "product_line" USING btree ("section_revision_id","identity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_line_id_identity_org_uq" ON "product_line" USING btree ("id","identity_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "product_line_kpved_code_uq" ON "product_line_kpved" USING btree ("product_line_id","code");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_id_org_uq" ON "production" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_revision_uq" ON "production" USING btree ("section_revision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_site_id_org_uq" ON "production_site" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "production_site_identity_uq" ON "production_site" USING btree ("main_information_id","identity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_section_id_org_uq" ON "products_section" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "products_section_revision_uq" ON "products_section" USING btree ("section_revision_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "submission_requirement_id_org_uq" ON "submission_requirement" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "submission_requirement_entry_uq" ON "submission_requirement" USING btree ("section_revision_id","dictionary_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "file_version_id_object_uq" ON "file_version" USING btree ("id","file_object_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "manufacturer_profile_id_org_uq" ON "manufacturer_profile" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "certificate_identity" ADD CONSTRAINT "certificate_identity_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line_identity" ADD CONSTRAINT "product_line_identity_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_site_identity" ADD CONSTRAINT "production_site_identity_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "profile_section" ADD CONSTRAINT "profile_section_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "section_revision" ADD CONSTRAINT "section_revision_author_id_user_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "section_revision" ADD CONSTRAINT "section_revision_section_org_fk" FOREIGN KEY ("profile_section_id","organization_id") REFERENCES "public"."profile_section"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_certificate_type_id_dictionary_entry_id_fk" FOREIGN KEY ("certificate_type_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_identity_org_fk" FOREIGN KEY ("identity_id","organization_id") REFERENCES "public"."certificate_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_founder" ADD CONSTRAINT "company_founder_parent_org_fk" FOREIGN KEY ("main_information_id","organization_id") REFERENCES "public"."main_information"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_role_id_dictionary_entry_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_document_type_id_dictionary_entry_id_fk" FOREIGN KEY ("document_type_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_equipment_type_id_dictionary_entry_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_item" ADD CONSTRAINT "equipment_item_photo_org_fk" FOREIGN KEY ("photo_file_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_product_line" ADD CONSTRAINT "equipment_product_line_equipment_org_fk" FOREIGN KEY ("equipment_item_id","organization_id") REFERENCES "public"."equipment_item"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "equipment_product_line" ADD CONSTRAINT "equipment_product_line_product_org_fk" FOREIGN KEY ("product_line_identity_id","organization_id") REFERENCES "public"."product_line_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "main_information" ADD CONSTRAINT "main_information_legal_form_id_dictionary_entry_id_fk" FOREIGN KEY ("legal_form_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "main_information" ADD CONSTRAINT "main_information_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "main_information_oked" ADD CONSTRAINT "main_information_oked_oked_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("oked_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "main_information_oked" ADD CONSTRAINT "main_information_oked_parent_org_fk" FOREIGN KEY ("main_information_id","organization_id") REFERENCES "public"."main_information"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "personnel" ADD CONSTRAINT "personnel_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "personnel_cv" ADD CONSTRAINT "personnel_cv_parent_org_fk" FOREIGN KEY ("personnel_id","organization_id") REFERENCES "public"."personnel"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "personnel_cv" ADD CONSTRAINT "personnel_cv_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "personnel_org_chart" ADD CONSTRAINT "personnel_org_chart_parent_org_fk" FOREIGN KEY ("personnel_id","organization_id") REFERENCES "public"."personnel"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "personnel_org_chart" ADD CONSTRAINT "personnel_org_chart_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_commodity_type_id_dictionary_entry_id_fk" FOREIGN KEY ("commodity_type_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_tn_ved_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("tn_ved_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_capacity_unit_id_dictionary_entry_id_fk" FOREIGN KEY ("capacity_unit_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_identity_org_fk" FOREIGN KEY ("identity_id","organization_id") REFERENCES "public"."product_line_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_site_org_fk" FOREIGN KEY ("production_site_identity_id","organization_id") REFERENCES "public"."production_site_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line_certificate" ADD CONSTRAINT "product_line_certificate_product_org_fk" FOREIGN KEY ("product_line_id","organization_id") REFERENCES "public"."product_line"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line_certificate" ADD CONSTRAINT "product_line_certificate_identity_org_fk" FOREIGN KEY ("certificate_identity_id","organization_id") REFERENCES "public"."certificate_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line_kpved" ADD CONSTRAINT "product_line_kpved_kpved_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("kpved_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_line_kpved" ADD CONSTRAINT "product_line_kpved_parent_org_fk" FOREIGN KEY ("product_line_id","organization_id") REFERENCES "public"."product_line"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production" ADD CONSTRAINT "production_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_photo" ADD CONSTRAINT "production_photo_parent_org_fk" FOREIGN KEY ("production_id","organization_id") REFERENCES "public"."production"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_photo" ADD CONSTRAINT "production_photo_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_process" ADD CONSTRAINT "production_process_process_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("process_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_process" ADD CONSTRAINT "production_process_parent_org_fk" FOREIGN KEY ("production_id","organization_id") REFERENCES "public"."production"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_site" ADD CONSTRAINT "production_site_region_id_dictionary_entry_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_site" ADD CONSTRAINT "production_site_parent_org_fk" FOREIGN KEY ("main_information_id","organization_id") REFERENCES "public"."main_information"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "production_site" ADD CONSTRAINT "production_site_identity_org_fk" FOREIGN KEY ("identity_id","organization_id") REFERENCES "public"."production_site_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products_section" ADD CONSTRAINT "products_section_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "products_section" ADD CONSTRAINT "products_section_extract_org_fk" FOREIGN KEY ("unified_register_extract_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revision_file_version" ADD CONSTRAINT "revision_file_version_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revision_file_version" ADD CONSTRAINT "revision_file_version_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "revision_file_version" ADD CONSTRAINT "revision_file_version_version_object_fk" FOREIGN KEY ("file_version_id","file_object_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "submission_requirement" ADD CONSTRAINT "submission_requirement_dictionary_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("dictionary_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "submission_requirement" ADD CONSTRAINT "submission_requirement_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_line_registry_number_idx" ON "product_line" USING btree ("organization_id","unified_register_registration_number");
--> statement-breakpoint
CREATE INDEX "product_line_tn_ved_idx" ON "product_line" USING btree ("organization_id","tn_ved_code");

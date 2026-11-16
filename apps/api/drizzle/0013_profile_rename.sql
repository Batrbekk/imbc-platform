-- NFR-06: rename only; a simple updatable view preserves exact R1 INSERT/ON CONFLICT/RETURNING SQL.
ALTER TABLE "manufacturer_profiles" RENAME TO "manufacturer_profile";
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" RENAME CONSTRAINT "manufacturer_profiles_pkey" TO "manufacturer_profile_pkey";
--> statement-breakpoint
ALTER TABLE "catalog_visible" RENAME CONSTRAINT "catalog_visible_profile_id_manufacturer_profiles_id_fk" TO "catalog_visible_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER INDEX "manufacturer_profiles_org_uq" RENAME TO "manufacturer_profile_org_uq";
--> statement-breakpoint
ALTER INDEX "manufacturer_profiles_status_idx" RENAME TO "manufacturer_profile_status_idx";
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" RENAME CONSTRAINT "manufacturer_profiles_organization_id_organizations_id_fk" TO "manufacturer_profile_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "manufacturer_profile" RENAME CONSTRAINT "manufacturer_profiles_assigned_expert_id_user_accounts_id_fk" TO "manufacturer_profile_assigned_expert_id_user_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "nda_acceptance" RENAME CONSTRAINT "nda_acceptance_profile_id_manufacturer_profiles_id_fk" TO "nda_acceptance_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "profile_sections" RENAME CONSTRAINT "profile_sections_profile_id_manufacturer_profiles_id_fk" TO "profile_sections_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "review_assignments" RENAME CONSTRAINT "review_assignments_profile_id_manufacturer_profiles_id_fk" TO "review_assignments_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "update_confirmations" RENAME CONSTRAINT "update_confirmations_profile_id_manufacturer_profiles_id_fk" TO "update_confirmations_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "due_diligence_records" RENAME CONSTRAINT "due_diligence_records_profile_id_manufacturer_profiles_id_fk" TO "due_diligence_records_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "external_check" RENAME CONSTRAINT "external_check_profile_id_manufacturer_profiles_id_fk" TO "external_check_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "imbc_notes" RENAME CONSTRAINT "imbc_notes_profile_id_manufacturer_profiles_id_fk" TO "imbc_notes_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "imbc_requests" RENAME CONSTRAINT "imbc_requests_profile_id_manufacturer_profiles_id_fk" TO "imbc_requests_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "operator_notes" RENAME CONSTRAINT "operator_notes_profile_id_manufacturer_profiles_id_fk" TO "operator_notes_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "operator_requests" RENAME CONSTRAINT "operator_requests_profile_id_manufacturer_profiles_id_fk" TO "operator_requests_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "operator_visit_marks" RENAME CONSTRAINT "operator_visit_marks_profile_id_manufacturer_profiles_id_fk" TO "operator_visit_marks_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "prefilled_value" RENAME CONSTRAINT "prefilled_value_profile_id_manufacturer_profiles_id_fk" TO "prefilled_value_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "site_survey_notices" RENAME CONSTRAINT "site_survey_notices_profile_id_manufacturer_profiles_id_fk" TO "site_survey_notices_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "site_survey_records" RENAME CONSTRAINT "site_survey_records_profile_id_manufacturer_profiles_id_fk" TO "site_survey_records_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
ALTER TABLE "works_with_marks" RENAME CONSTRAINT "works_with_marks_profile_id_manufacturer_profiles_id_fk" TO "works_with_marks_profile_id_manufacturer_profile_id_fk";
--> statement-breakpoint
CREATE VIEW "manufacturer_profiles" AS SELECT * FROM "manufacturer_profile";
--> statement-breakpoint
-- PostgreSQL table row types and enums share a namespace. Existing columns keep the same values.
ALTER TYPE "profile_section" RENAME TO "legacy_profile_section";

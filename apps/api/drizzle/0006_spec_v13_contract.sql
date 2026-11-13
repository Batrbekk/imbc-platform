-- Спецификация v1.3, шаг contract (NFR-06, UPD-06, GEN-06): из типов role, organization_type и
-- update_status удаляются прежние 'spectator' и 'inactive', удаляются пустые таблицы каркаса
-- external_checks, nda_versions, nda_acceptances и тип check_status. Сначала проверка: строка
-- с прежним значением или строка в таблице каркаса останавливает миграцию до любой правки.
-- Колонки типов (по каталогу базы 0005): user_accounts.role, organizations.type,
-- manufacturer_profiles.update_status, catalog_visible.update_status; индексов, DEFAULT,
-- CHECK, представлений и функций на них нет. account_state ('inactive' аккаунта, AUTH-07) не меняется.
DO $$ DECLARE n bigint; BEGIN
  SELECT (SELECT count(*) FROM organizations WHERE type::text = 'spectator')
       + (SELECT count(*) FROM user_accounts WHERE role::text = 'spectator')
       + (SELECT count(*) FROM manufacturer_profiles WHERE update_status::text = 'inactive')
       + (SELECT count(*) FROM catalog_visible WHERE update_status::text = 'inactive') INTO n;
  IF n > 0 THEN RAISE EXCEPTION 'spec v1.3 contract: % rows still hold spectator or inactive', n; END IF;
  IF EXISTS (SELECT 1 FROM external_checks) OR EXISTS (SELECT 1 FROM nda_acceptances) OR EXISTS (SELECT 1 FROM nda_versions)
    THEN RAISE EXCEPTION 'spec v1.3 contract: skeleton tables external_checks, nda_versions, nda_acceptances are not empty'; END IF;
END $$;--> statement-breakpoint
ALTER TYPE "public"."role" RENAME TO "role_legacy";--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('manufacturer', 'expert', 'administrator', 'director', 'operator', 'observer');--> statement-breakpoint
ALTER TABLE "user_accounts" ALTER COLUMN "role" TYPE "public"."role" USING "role"::text::"public"."role";--> statement-breakpoint
DROP TYPE "public"."role_legacy";--> statement-breakpoint
ALTER TYPE "public"."organization_type" RENAME TO "organization_type_legacy";--> statement-breakpoint
CREATE TYPE "public"."organization_type" AS ENUM('manufacturer', 'operator', 'observer', 'imbc');--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "type" TYPE "public"."organization_type" USING "type"::text::"public"."organization_type";--> statement-breakpoint
DROP TYPE "public"."organization_type_legacy";--> statement-breakpoint
ALTER TYPE "public"."update_status" RENAME TO "update_status_legacy";--> statement-breakpoint
CREATE TYPE "public"."update_status" AS ENUM('active', 'outdated', 'unresponsive');--> statement-breakpoint
ALTER TABLE "manufacturer_profiles" ALTER COLUMN "update_status" TYPE "public"."update_status" USING "update_status"::text::"public"."update_status";--> statement-breakpoint
ALTER TABLE "catalog_visible" ALTER COLUMN "update_status" TYPE "public"."update_status" USING "update_status"::text::"public"."update_status";--> statement-breakpoint
DROP TYPE "public"."update_status_legacy";--> statement-breakpoint
DROP TABLE "external_checks";--> statement-breakpoint
DROP TYPE "public"."check_status";--> statement-breakpoint
DROP TABLE "nda_acceptances";--> statement-breakpoint
DROP TABLE "nda_versions";

-- Спецификация v1.3, шаг expand (NFR-06). Прежние значения 'spectator' и 'inactive' остаются
-- в типах до миграции contract следующего релиза. Новые значения нельзя использовать в этой
-- транзакции: данные переносит backfillSpecV13() (src/database/backfill.ts) после фиксации.
ALTER TYPE "public"."organization_type" ADD VALUE IF NOT EXISTS 'observer' BEFORE 'imbc';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE IF NOT EXISTS 'observer';--> statement-breakpoint
ALTER TYPE "public"."update_status" ADD VALUE IF NOT EXISTS 'unresponsive';
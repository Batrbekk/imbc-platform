-- Contract этапа 2 (NFR-06): удаляется то, что этап 2 оставил для совместимости с этапом 1 — журнал писем
-- notifications_sent (NOT-18), скелетные dictionaries, dictionary_entries (DATA-04), file_objects,
-- file_versions (DATA-05) и скелетный тип scan_state; тип состояния скана file_scan_state получает имя DBML
-- scan_state (DATA-07); образец оргструктуры по умолчанию не текущий. Предыдущая версия (этап 2) на этой схеме
-- не работает (читает notifications_sent): откат — только восстановление резервной копии.
-- Порядок: 1) повторный перенос писем, которые этап 1 записал после 0010, — тот же оператор, что третий в 0010;
-- 2) проверка: письмо с кодом правила не в notification или строка в скелетной таблице — RAISE EXCEPTION, и
--    вся пачка миграций выката откатывается (мигратор применяет её одной транзакцией), перенос — тоже;
-- 3) девять внешних ключей пустых колонок скелета переводятся с file_objects / file_versions на file_object /
--    file_version (имена — как строит Drizzle; прежнее имя due_diligence_records_enhanced_report_file_id_…
--    длиннее 63 байт, PostgreSQL хранит его усечённым);
-- 4) удаление таблиц и скелетного типа без CASCADE — неизвестная зависимость остановит миграцию;
--    переименование file_scan_state → scan_state (колонка file_version.scan_state, её умолчание и частичный
--    индекс file_version_pending_idx ссылаются на тип по OID и не меняются);
-- 5) умолчание org_chart_sample.is_current — false.
INSERT INTO notification (rule_code, recipient_email, user_account_id, language, dedup_key, sent_at)
  SELECT ns.code, ns.recipient, ua.id,
         CASE WHEN ns.locale IN ('kk','ru','en') THEN ns.locale::locale ELSE 'kk'::locale END,
         ns.code || E'\n' || ns.dedupe_key || E'\n' || lower(ns.recipient), ns.sent_at
  FROM notifications_sent ns LEFT JOIN user_accounts ua ON lower(ua.email) = lower(ns.recipient)
  WHERE ns.code IN (SELECT code FROM notification_rule)
ON CONFLICT (dedup_key) DO NOTHING;--> statement-breakpoint
DO $$ DECLARE n bigint; d bigint; de bigint; fo bigint; fv bigint; BEGIN
  SELECT count(*) FROM notifications_sent s
   WHERE s.code IN (SELECT code FROM notification_rule)
     AND NOT EXISTS (SELECT 1 FROM notification m
                      WHERE m.dedup_key = s.code || E'\n' || s.dedupe_key || E'\n' || lower(s.recipient)) INTO n;
  IF n > 0 THEN RAISE EXCEPTION 'stage 2 contract: % notifications_sent rows not in notification', n; END IF;
  SELECT (SELECT count(*) FROM dictionaries), (SELECT count(*) FROM dictionary_entries),
         (SELECT count(*) FROM file_objects), (SELECT count(*) FROM file_versions) INTO d, de, fo, fv;
  IF d + de + fo + fv > 0 THEN RAISE EXCEPTION
    'stage 2 contract: skeleton tables dictionaries, dictionary_entries, file_objects, file_versions are not empty (rows: %, %, %, %)',
    d, de, fo, fv; END IF;
END $$;--> statement-breakpoint
ALTER TABLE "certificates" DROP CONSTRAINT "certificates_file_id_file_objects_id_fk";--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_file_id_file_objects_id_fk";--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" DROP CONSTRAINT "review_decisions_file_version_id_file_versions_id_fk";--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_file_version_id_file_version_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_records" DROP CONSTRAINT "site_survey_records_report_file_id_file_objects_id_fk";--> statement-breakpoint
ALTER TABLE "site_survey_records" ADD CONSTRAINT "site_survey_records_report_file_id_file_object_id_fk" FOREIGN KEY ("report_file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_records" DROP CONSTRAINT "due_diligence_records_report_file_id_file_objects_id_fk";--> statement-breakpoint
ALTER TABLE "due_diligence_records" ADD CONSTRAINT "due_diligence_records_report_file_id_file_object_id_fk" FOREIGN KEY ("report_file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_records" DROP CONSTRAINT "due_diligence_records_enhanced_report_file_id_file_objects_id_f";--> statement-breakpoint
ALTER TABLE "due_diligence_records" ADD CONSTRAINT "due_diligence_records_enhanced_report_file_id_file_object_id_fk" FOREIGN KEY ("enhanced_report_file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_visit_marks" DROP CONSTRAINT "operator_visit_marks_file_id_file_objects_id_fk";--> statement-breakpoint
ALTER TABLE "operator_visit_marks" ADD CONSTRAINT "operator_visit_marks_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_versions" DROP CONSTRAINT "forecast_versions_source_file_id_file_objects_id_fk";--> statement-breakpoint
ALTER TABLE "forecast_versions" ADD CONSTRAINT "forecast_versions_source_file_id_file_object_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_spec_files" DROP CONSTRAINT "tech_spec_files_file_id_file_objects_id_fk";--> statement-breakpoint
ALTER TABLE "tech_spec_files" ADD CONSTRAINT "tech_spec_files_file_id_file_object_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_object"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TABLE "notifications_sent", "dictionary_entries", "dictionaries", "file_versions", "file_objects";--> statement-breakpoint
DROP TYPE "public"."scan_state";--> statement-breakpoint
ALTER TYPE "public"."file_scan_state" RENAME TO "scan_state";--> statement-breakpoint
ALTER TABLE "org_chart_sample" ALTER COLUMN "is_current" SET DEFAULT false;

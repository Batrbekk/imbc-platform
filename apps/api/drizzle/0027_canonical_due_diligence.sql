CREATE TYPE "public"."diligence_mark" AS ENUM('clear', 'finding', 'shown_only', 'no_answer');--> statement-breakpoint
CREATE TYPE "public"."diligence_result" AS ENUM('green', 'amber', 'red');--> statement-breakpoint
CREATE TYPE "public"."enhanced_diligence" AS ENUM('done', 'not_done');--> statement-breakpoint
CREATE TABLE "diligence_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"audit_entry_id" uuid NOT NULL,
	"transaction_id" text DEFAULT pg_current_xact_id()::text NOT NULL,
	"before_record_hash" text,
	"after_record_hash" text,
	"before_check_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after_check_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diligence_refresh_outbox" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_snapshot_id" uuid NOT NULL,
	"applied_snapshot_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	CONSTRAINT "diligence_outbox_state_ck" CHECK ("diligence_refresh_outbox"."state" in ('pending','applied')),
	CONSTRAINT "diligence_outbox_attempt_ck" CHECK ("diligence_refresh_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "diligence_source_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"terminal_state" text NOT NULL,
	"normalized_state" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"schema_version" text NOT NULL,
	"schema_sha256" text NOT NULL,
	"is_test_data" boolean NOT NULL,
	"evidence" jsonb NOT NULL,
	"evaluation" jsonb,
	CONSTRAINT "diligence_snapshot_state_ck" CHECK ("diligence_source_snapshot"."normalized_state" in ('received','no_answer','unavailable','modules_not_connected','not_configured','quota_exhausted','malformed')),
	CONSTRAINT "diligence_snapshot_evaluation_ck" CHECK (("diligence_source_snapshot"."normalized_state" = 'received') = ("diligence_source_snapshot"."evaluation" is not null)),
	CONSTRAINT "diligence_snapshot_hash_ck" CHECK ("diligence_source_snapshot"."schema_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "due_diligence_check" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_name" text NOT NULL,
	"subject_name" text NOT NULL,
	"check_name" text NOT NULL,
	"adata_value" text,
	"mark" "diligence_mark" NOT NULL,
	"attention" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "due_diligence_check_position_ck" CHECK ("due_diligence_check"."position" >= 0),
	CONSTRAINT "due_diligence_check_value_ck" CHECK (("due_diligence_check"."mark" = 'no_answer') = ("due_diligence_check"."adata_value" is null)),
	CONSTRAINT "due_diligence_check_attention_ck" CHECK (not "due_diligence_check"."attention" or "due_diligence_check"."mark" = 'shown_only'),
	CONSTRAINT "due_diligence_check_group_ck" CHECK ("due_diligence_check"."group_name" in ('company_enterprise','company_finance','company_procurement','company_tax','director','founder','beneficiary'))
);
--> statement-breakpoint
CREATE TABLE "due_diligence_record" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"checked_on" date NOT NULL,
	"adata_result" "diligence_result",
	"result" "diligence_result" NOT NULL,
	"comment" text,
	"report_file_id" uuid,
	"report_file_version_id" uuid,
	"overridden_by" uuid,
	"overridden_at" timestamp with time zone,
	"enhanced" "enhanced_diligence" DEFAULT 'not_done' NOT NULL,
	"enhanced_comment" text,
	"enhanced_report_file_id" uuid,
	"enhanced_report_file_version_id" uuid,
	"source_snapshot_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "due_diligence_record_override_pair_ck" CHECK (("due_diligence_record"."overridden_by" is null) = ("due_diligence_record"."overridden_at" is null)),
	CONSTRAINT "due_diligence_record_report_pair_ck" CHECK (("due_diligence_record"."report_file_id" is null) = ("due_diligence_record"."report_file_version_id" is null)),
	CONSTRAINT "due_diligence_record_enhanced_report_pair_ck" CHECK (("due_diligence_record"."enhanced_report_file_id" is null) = ("due_diligence_record"."enhanced_report_file_version_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "diligence_snapshot_id_profile_org_uq" ON "diligence_source_snapshot" USING btree ("id","profile_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "due_diligence_record_profile_org_uq" ON "due_diligence_record" USING btree ("profile_id","organization_id");
--> statement-breakpoint
ALTER TABLE "diligence_operation" ADD CONSTRAINT "diligence_operation_audit_entry_id_audit_entries_id_fk" FOREIGN KEY ("audit_entry_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_operation" ADD CONSTRAINT "diligence_operation_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_refresh_outbox" ADD CONSTRAINT "diligence_outbox_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_refresh_outbox" ADD CONSTRAINT "diligence_outbox_requested_scope_fk" FOREIGN KEY ("requested_snapshot_id","profile_id","organization_id") REFERENCES "public"."diligence_source_snapshot"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_refresh_outbox" ADD CONSTRAINT "diligence_outbox_applied_scope_fk" FOREIGN KEY ("applied_snapshot_id","profile_id","organization_id") REFERENCES "public"."diligence_source_snapshot"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_source_snapshot" ADD CONSTRAINT "diligence_source_snapshot_attempt_id_external_check_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."external_check_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diligence_source_snapshot" ADD CONSTRAINT "diligence_snapshot_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_check" ADD CONSTRAINT "due_diligence_check_record_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."due_diligence_record"("profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_record" ADD CONSTRAINT "due_diligence_record_overridden_by_user_accounts_id_fk" FOREIGN KEY ("overridden_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_record" ADD CONSTRAINT "due_diligence_record_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_record" ADD CONSTRAINT "due_diligence_record_snapshot_scope_fk" FOREIGN KEY ("source_snapshot_id","profile_id","organization_id") REFERENCES "public"."diligence_source_snapshot"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_record" ADD CONSTRAINT "due_diligence_record_report_org_fk" FOREIGN KEY ("report_file_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_record" ADD CONSTRAINT "due_diligence_record_report_version_fk" FOREIGN KEY ("report_file_version_id","report_file_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_record" ADD CONSTRAINT "due_diligence_record_enhanced_report_org_fk" FOREIGN KEY ("enhanced_report_file_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_record" ADD CONSTRAINT "due_diligence_record_enhanced_report_version_fk" FOREIGN KEY ("enhanced_report_file_version_id","enhanced_report_file_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "diligence_operation_profile_transaction_uq" ON "diligence_operation" USING btree ("profile_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diligence_operation_audit_uq" ON "diligence_operation" USING btree ("audit_entry_id");--> statement-breakpoint
CREATE INDEX "diligence_outbox_pending_idx" ON "diligence_refresh_outbox" USING btree ("state","last_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "diligence_snapshot_terminal_uq" ON "diligence_source_snapshot" USING btree ("attempt_id","completed_at","terminal_state");--> statement-breakpoint
CREATE INDEX "diligence_snapshot_profile_idx" ON "diligence_source_snapshot" USING btree ("profile_id","completed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "due_diligence_check_position_uq" ON "due_diligence_check" USING btree ("profile_id","position");--> statement-breakpoint
--> statement-breakpoint
-- AUD-01/IMBC-10: a sealed full before/after operation precedes every business mutation.
ALTER TABLE catalog_visible ALTER COLUMN headcount_total TYPE bigint;
--> statement-breakpoint
CREATE FUNCTION diligence_row_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN value IS NULL OR value='null'::jsonb THEN NULL
    ELSE encode(sha256(convert_to(value::text,'UTF8')),'hex') END
$$;
--> statement-breakpoint
CREATE FUNCTION diligence_operation_seal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE entry audit_entries%ROWTYPE; actual_record jsonb; actual_checks jsonb; before_state jsonb; after_state jsonb; normalized jsonb;
BEGIN
  SELECT * INTO entry FROM audit_entries WHERE id=NEW.audit_entry_id;
  IF NOT FOUND OR entry.organization_id IS DISTINCT FROM NEW.organization_id OR entry.object_type<>'due_diligence'
    OR entry.object_id IS DISTINCT FROM NEW.profile_id::text OR entry.outcome<>'ok'
    OR entry.action NOT IN ('due_diligence.received','due_diligence.override','due_diligence.enhanced','due_diligence.legacy_import')
    OR entry.diff->>'operationId' IS DISTINCT FROM NEW.id::text
    OR NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text
    OR (entry.user_id IS NULL AND entry.diff#>>'{actor,type}' IS DISTINCT FROM 'system')
    OR (entry.user_id IS NOT NULL AND (entry.diff#>>'{actor,type}' IS DISTINCT FROM 'user'
      OR entry.diff#>>'{actor,id}' IS DISTINCT FROM entry.user_id::text)) THEN
    RAISE EXCEPTION 'Invalid diligence audit operation' USING ERRCODE='23514';
  END IF;
  before_state=entry.diff->'before'; after_state=entry.diff->'after';
  SELECT to_jsonb(r) INTO actual_record FROM due_diligence_record r
    WHERE r.profile_id=NEW.profile_id AND r.organization_id=NEW.organization_id;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.position,c.id),'[]'::jsonb) INTO actual_checks
    FROM due_diligence_check c WHERE c.profile_id=NEW.profile_id AND c.organization_id=NEW.organization_id;
  IF before_state IS DISTINCT FROM jsonb_build_object('record',actual_record,'checks',actual_checks)
    OR jsonb_typeof(after_state)<>'object' OR NOT after_state ? 'record' OR jsonb_typeof(after_state->'checks')<>'array' THEN
    RAISE EXCEPTION 'Diligence before snapshot does not match current state' USING ERRCODE='23514';
  END IF;
  IF after_state->'record' <> 'null'::jsonb THEN
    normalized=to_jsonb(jsonb_populate_record(NULL::due_diligence_record,after_state->'record'));
    IF normalized IS DISTINCT FROM after_state->'record' OR normalized->>'profile_id' IS DISTINCT FROM NEW.profile_id::text
      OR normalized->>'organization_id' IS DISTINCT FROM NEW.organization_id::text THEN
      RAISE EXCEPTION 'Invalid complete diligence after record' USING ERRCODE='23514';
    END IF;
  ELSIF jsonb_array_length(after_state->'checks')<>0 THEN
    RAISE EXCEPTION 'Diligence checks without a record' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.position,c.id),'[]'::jsonb) INTO normalized
    FROM jsonb_populate_recordset(NULL::due_diligence_check,after_state->'checks') c;
  IF normalized IS DISTINCT FROM after_state->'checks' OR EXISTS(
    SELECT 1 FROM jsonb_array_elements(after_state->'checks') WITH ORDINALITY c(value,ordinal)
    WHERE c.value->>'profile_id' IS DISTINCT FROM NEW.profile_id::text
      OR c.value->>'organization_id' IS DISTINCT FROM NEW.organization_id::text
      OR (c.value->>'position')::integer<>ordinal-1
  ) OR (SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(after_state->'checks') c)<>jsonb_array_length(after_state->'checks') THEN
    RAISE EXCEPTION 'Invalid complete ordered diligence after checks' USING ERRCODE='23514';
  END IF;
  NEW.before_record_hash=diligence_row_hash(before_state->'record');
  NEW.after_record_hash=diligence_row_hash(after_state->'record');
  SELECT coalesce(jsonb_object_agg(c->>'id',diligence_row_hash(c)),'{}'::jsonb) INTO NEW.before_check_hashes
    FROM jsonb_array_elements(before_state->'checks') c;
  SELECT coalesce(jsonb_object_agg(c->>'id',diligence_row_hash(c)),'{}'::jsonb) INTO NEW.after_check_hashes
    FROM jsonb_array_elements(after_state->'checks') c;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER diligence_operation_seal BEFORE INSERT ON diligence_operation FOR EACH ROW EXECUTE FUNCTION diligence_operation_seal();
--> statement-breakpoint
CREATE FUNCTION diligence_business_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE operation diligence_operation%ROWTYPE; target_profile uuid; target_org uuid; old_json jsonb; new_json jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN old_json=to_jsonb(OLD); END IF;
  IF TG_OP<>'DELETE' THEN new_json=to_jsonb(NEW); END IF;
  target_profile=coalesce((new_json->>'profile_id')::uuid,(old_json->>'profile_id')::uuid);
  target_org=coalesce((new_json->>'organization_id')::uuid,(old_json->>'organization_id')::uuid);
  SELECT * INTO operation FROM diligence_operation
    WHERE id=nullif(current_setting('imbc.diligence_operation_id',true),'')::uuid
      AND profile_id=target_profile AND organization_id=target_org AND transaction_id=pg_current_xact_id()::text;
  IF NOT FOUND THEN RAISE EXCEPTION 'Diligence mutation requires a sealed audit' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='due_diligence_record' THEN
    IF (TG_OP<>'INSERT' AND diligence_row_hash(old_json) IS DISTINCT FROM operation.before_record_hash)
      OR (TG_OP<>'DELETE' AND diligence_row_hash(new_json) IS DISTINCT FROM operation.after_record_hash)
      OR (TG_OP='DELETE' AND operation.after_record_hash IS NOT NULL) THEN
      RAISE EXCEPTION 'Diligence record differs from sealed audit' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (TG_OP<>'INSERT' AND (operation.before_check_hashes->>(old_json->>'id')) IS DISTINCT FROM diligence_row_hash(old_json))
      OR (TG_OP<>'DELETE' AND (operation.after_check_hashes->>(new_json->>'id')) IS DISTINCT FROM diligence_row_hash(new_json)) THEN
      RAISE EXCEPTION 'Diligence check differs from sealed audit' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER diligence_record_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON due_diligence_record FOR EACH ROW EXECUTE FUNCTION diligence_business_guard();
--> statement-breakpoint
CREATE TRIGGER diligence_check_audit_guard BEFORE INSERT OR UPDATE OR DELETE ON due_diligence_check FOR EACH ROW EXECUTE FUNCTION diligence_business_guard();
--> statement-breakpoint
CREATE FUNCTION diligence_operation_complete() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE expected jsonb; actual_record jsonb; actual_checks jsonb;
BEGIN
  SELECT diff->'after' INTO expected FROM audit_entries WHERE id=NEW.audit_entry_id;
  SELECT to_jsonb(r) INTO actual_record FROM due_diligence_record r WHERE r.profile_id=NEW.profile_id AND r.organization_id=NEW.organization_id;
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.position,c.id),'[]'::jsonb) INTO actual_checks
    FROM due_diligence_check c WHERE c.profile_id=NEW.profile_id AND c.organization_id=NEW.organization_id;
  IF expected IS DISTINCT FROM jsonb_build_object('record',actual_record,'checks',actual_checks) THEN
    RAISE EXCEPTION 'Incomplete diligence operation after snapshot' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER diligence_operation_complete AFTER INSERT ON diligence_operation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION diligence_operation_complete();
--> statement-breakpoint
CREATE FUNCTION diligence_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Immutable diligence evidence' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER diligence_operation_immutable BEFORE UPDATE OR DELETE ON diligence_operation FOR EACH ROW EXECUTE FUNCTION diligence_append_only();
--> statement-breakpoint
CREATE TRIGGER diligence_snapshot_immutable BEFORE UPDATE OR DELETE ON diligence_source_snapshot FOR EACH ROW EXECUTE FUNCTION diligence_append_only();
--> statement-breakpoint
CREATE FUNCTION diligence_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM external_check_attempt a JOIN external_check c ON c.id=a.external_check_id
    WHERE a.id=NEW.attempt_id AND c.connector='adata' AND c.profile_id=NEW.profile_id AND c.organization_id=NEW.organization_id
      AND a.completed_at=NEW.completed_at AND a.state::text=NEW.terminal_state AND a.is_test_data=NEW.is_test_data
      AND ((a.state='received' AND NEW.normalized_state IN ('received','no_answer','modules_not_connected','malformed'))
        OR (a.state='unavailable' AND NEW.normalized_state=CASE WHEN a.failure='module_off' THEN 'modules_not_connected'
          WHEN a.failure='malformed' THEN 'malformed' ELSE 'unavailable' END)
        OR (a.state IN ('not_configured','quota_exhausted') AND a.state::text=NEW.normalized_state))) THEN
    RAISE EXCEPTION 'Diligence receipt does not match its terminal attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER diligence_snapshot_guard BEFORE INSERT ON diligence_source_snapshot FOR EACH ROW EXECUTE FUNCTION diligence_snapshot_guard();
--> statement-breakpoint
CREATE FUNCTION diligence_report_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE binding record; old_json jsonb=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
BEGIN
  -- All file objects are locked in UUID order, matching the upload replacement/cleanup parent lock.
  PERFORM 1 FROM file_object f WHERE f.id IN (NEW.report_file_id,NEW.enhanced_report_file_id) ORDER BY f.id FOR SHARE;
  FOR binding IN SELECT NEW.report_file_id AS file_id,NEW.report_file_version_id AS version_id,'due_diligence_report' AS purpose,
      old_json->>'report_file_id' AS old_file,old_json->>'report_file_version_id' AS old_version
    UNION ALL SELECT NEW.enhanced_report_file_id,NEW.enhanced_report_file_version_id,'enhanced_due_diligence_report',
      old_json->>'enhanced_report_file_id',old_json->>'enhanced_report_file_version_id'
  LOOP
    IF binding.file_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM file_object f JOIN file_version v ON v.file_object_id=f.id
      WHERE f.id=binding.file_id AND f.organization_id=NEW.organization_id AND f.data_class='c_imbc'
        AND f.purpose::text=binding.purpose AND f.purge_requested_at IS NULL AND v.id=binding.version_id AND v.scan_state='passed'
        AND ((binding.old_file=binding.file_id::text AND binding.old_version=binding.version_id::text)
          OR v.version_number=(SELECT max(version_number) FROM file_version WHERE file_object_id=f.id))) THEN
      RAISE EXCEPTION 'Invalid diligence report owner/version' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER diligence_report_guard BEFORE INSERT OR UPDATE ON due_diligence_record FOR EACH ROW EXECUTE FUNCTION diligence_report_guard();
--> statement-breakpoint
-- Compatibility retention, not an invented severity mapping: legacy findings may mean amber OR red,
-- and old no_issues has no reconstructable normalized source checks. Keep every old row/FK untouched.
INSERT INTO audit_entries(organization_id,action,object_type,object_id,outcome,diff)
SELECT p.organization_id,'due_diligence.legacy_retained','due_diligence_migration',p.id::text,'ok',
  jsonb_build_object('actor',jsonb_build_object('type','system'),'mapping','unresolved',
    'reason','Legacy no_issues/findings has no approved green/amber/red severity mapping',
    'legacyRows',jsonb_agg(to_jsonb(d) ORDER BY d.created_at,d.id))
FROM manufacturer_profile p JOIN due_diligence_records d ON d.profile_id=p.id
GROUP BY p.id,p.organization_id;
--> statement-breakpoint
UPDATE manufacturer_profile p SET migration_flags=coalesce(p.migration_flags,'{}'::jsonb)
  || jsonb_build_object('dueDiligence','legacy_mapping_unresolved')
WHERE EXISTS(SELECT 1 FROM due_diligence_records d WHERE d.profile_id=p.id);
--> statement-breakpoint
-- A legacy row does not prove canonical green/amber eligibility; a source result or explicit SME intent
-- will rebuild the actual verified graph. This does not edit manufacturer/frozen content.
DELETE FROM catalog_visible c WHERE NOT EXISTS(SELECT 1 FROM due_diligence_record d
  JOIN manufacturer_profile p ON p.id=d.profile_id AND p.organization_id=d.organization_id
  WHERE d.profile_id=c.profile_id AND d.organization_id=c.organization_id AND d.result IN ('green','amber') AND p.status='verified');
--> statement-breakpoint
-- A received attempt completes only once; config/quota/unavailable versions may later complete under the same ID.
CREATE UNIQUE INDEX diligence_snapshot_received_attempt_uq ON diligence_source_snapshot(attempt_id) WHERE terminal_state='received';

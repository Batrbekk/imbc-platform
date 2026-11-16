CREATE TYPE "public"."survey_result" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."survey_source" AS ENUM('migration', 'expert');--> statement-breakpoint
CREATE TABLE "site_survey_notice_outbox" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"generation" bigint NOT NULL,
	"survey_record_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"queued_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	CONSTRAINT "survey_notice_generation_ck" CHECK ("site_survey_notice_outbox"."generation" > 0),
	CONSTRAINT "survey_notice_state_ck" CHECK ("site_survey_notice_outbox"."state" in ('pending','queued') and (("site_survey_notice_outbox"."state" = 'pending') = ("site_survey_notice_outbox"."queued_at" is null))),
	CONSTRAINT "survey_notice_attempt_ck" CHECK ("site_survey_notice_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "site_survey_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"survey_record_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" uuid,
	"request_fingerprint" text,
	"audit_entry_id" uuid NOT NULL,
	"transaction_id" text DEFAULT pg_current_xact_id()::text NOT NULL,
	"before_record_hash" text,
	"after_record_hash" text NOT NULL,
	"before_file_object_id" uuid,
	"before_file_version_id" uuid,
	"after_file_object_id" uuid,
	"after_file_version_id" uuid,
	CONSTRAINT "survey_operation_action_ck" CHECK ("site_survey_operation"."action" in ('site_survey.created','site_survey.updated','site_survey.legacy_import')),
	CONSTRAINT "survey_operation_fingerprint_ck" CHECK (("site_survey_operation"."idempotency_key" is null) = ("site_survey_operation"."request_fingerprint" is null)
    and ("site_survey_operation"."request_fingerprint" is null or "site_survey_operation"."request_fingerprint" ~ '^[0-9a-f]{64}$')
    and ("site_survey_operation"."action" <> 'site_survey.created' or "site_survey_operation"."idempotency_key" is not null)),
	CONSTRAINT "survey_operation_before_ck" CHECK (("site_survey_operation"."action" = 'site_survey.updated') = ("site_survey_operation"."before_record_hash" is not null)),
	CONSTRAINT "survey_operation_pins_ck" CHECK ((("site_survey_operation"."before_file_object_id" is null) = ("site_survey_operation"."before_file_version_id" is null))
    and (("site_survey_operation"."after_file_object_id" is null) = ("site_survey_operation"."after_file_version_id" is null)))
);
--> statement-breakpoint
CREATE TABLE "site_survey_publication_state" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"site_surveyed" boolean DEFAULT false NOT NULL,
	"effective_until" date,
	"next_refresh_on" date,
	"generation" bigint DEFAULT 0 NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_publication_generation_ck" CHECK ("site_survey_publication_state"."generation" >= 0 and (not "site_survey_publication_state"."site_surveyed" or "site_survey_publication_state"."generation" > 0)),
	CONSTRAINT "survey_publication_expiry_ck" CHECK ("site_survey_publication_state"."site_surveyed" or "site_survey_publication_state"."effective_until" is null)
);
--> statement-breakpoint
CREATE TABLE "site_survey_record" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"visit_started_on" date NOT NULL,
	"visit_ended_on" date,
	"result" "survey_result" NOT NULL,
	"file_object_id" uuid,
	"file_version_id" uuid,
	"expires_on" date,
	"comment" text,
	"source" "survey_source" NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_record_dates_ck" CHECK ("site_survey_record"."visit_ended_on" is null or "site_survey_record"."visit_ended_on" >= "site_survey_record"."visit_started_on"),
	CONSTRAINT "survey_record_report_pair_ck" CHECK (("site_survey_record"."file_object_id" is null) = ("site_survey_record"."file_version_id" is null)),
	CONSTRAINT "survey_record_expert_ck" CHECK ("site_survey_record"."source" <> 'expert' or ("site_survey_record"."recorded_by" is not null and "site_survey_record"."file_object_id" is not null)),
	CONSTRAINT "survey_record_clock_ck" CHECK ("site_survey_record"."updated_at" >= "site_survey_record"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "site_survey_request" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"audit_entry_id" uuid NOT NULL,
	"transaction_id" text DEFAULT pg_current_xact_id()::text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_survey_notice_outbox" ADD CONSTRAINT "survey_notice_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_record_id_profile_org_uq" ON "site_survey_record" USING btree ("id","profile_id","organization_id");--> statement-breakpoint
ALTER TABLE "site_survey_notice_outbox" ADD CONSTRAINT "survey_notice_record_scope_fk" FOREIGN KEY ("survey_record_id","profile_id","organization_id") REFERENCES "public"."site_survey_record"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_operation" ADD CONSTRAINT "site_survey_operation_actor_id_user_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_operation" ADD CONSTRAINT "site_survey_operation_audit_entry_id_audit_entries_id_fk" FOREIGN KEY ("audit_entry_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_operation" ADD CONSTRAINT "survey_operation_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_operation" ADD CONSTRAINT "survey_operation_before_report_org_fk" FOREIGN KEY ("before_file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_operation" ADD CONSTRAINT "survey_operation_before_version_fk" FOREIGN KEY ("before_file_version_id","before_file_object_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_operation" ADD CONSTRAINT "survey_operation_after_report_org_fk" FOREIGN KEY ("after_file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_operation" ADD CONSTRAINT "survey_operation_after_version_fk" FOREIGN KEY ("after_file_version_id","after_file_object_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_publication_state" ADD CONSTRAINT "survey_publication_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_record" ADD CONSTRAINT "site_survey_record_recorded_by_user_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_record" ADD CONSTRAINT "survey_record_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_record" ADD CONSTRAINT "survey_record_report_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_record" ADD CONSTRAINT "survey_record_report_version_fk" FOREIGN KEY ("file_version_id","file_object_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_request" ADD CONSTRAINT "site_survey_request_requested_by_user_accounts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_request" ADD CONSTRAINT "site_survey_request_audit_entry_id_audit_entries_id_fk" FOREIGN KEY ("audit_entry_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_survey_request" ADD CONSTRAINT "survey_request_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_notice_generation_uq" ON "site_survey_notice_outbox" USING btree ("profile_id","generation");--> statement-breakpoint
CREATE INDEX "survey_notice_pending_idx" ON "site_survey_notice_outbox" USING btree ("state","last_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_operation_record_transaction_uq" ON "site_survey_operation" USING btree ("survey_record_id","transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_operation_audit_uq" ON "site_survey_operation" USING btree ("audit_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_operation_actor_key_uq" ON "site_survey_operation" USING btree ("actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "survey_operation_profile_idx" ON "site_survey_operation" USING btree ("profile_id","survey_record_id");--> statement-breakpoint
CREATE INDEX "survey_publication_expiry_idx" ON "site_survey_publication_state" USING btree ("effective_until") WHERE "site_survey_publication_state"."site_surveyed" and "site_survey_publication_state"."effective_until" is not null;--> statement-breakpoint
CREATE INDEX "survey_publication_refresh_idx" ON "site_survey_publication_state" USING btree ("next_refresh_on") WHERE "site_survey_publication_state"."next_refresh_on" is not null;--> statement-breakpoint
CREATE INDEX "survey_record_effective_idx" ON "site_survey_record" USING btree ("profile_id","result","expires_on");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_request_actor_key_uq" ON "site_survey_request" USING btree ("requested_by","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_request_audit_uq" ON "site_survey_request" USING btree ("audit_entry_id");--> statement-breakpoint
CREATE INDEX "survey_request_profile_idx" ON "site_survey_request" USING btree ("profile_id","requested_at");
--> statement-breakpoint
-- IMBC-01/02/03, AUD-01/02: complete scoped audit precedes each record mutation.
CREATE FUNCTION site_survey_row_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN value IS NULL OR value='null'::jsonb THEN NULL
    ELSE encode(sha256(convert_to(value::text,'UTF8')),'hex') END
$$;
--> statement-breakpoint
CREATE FUNCTION site_survey_assert_actor(p_actor uuid,p_organization uuid,p_own boolean) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual record; required_action text; required_condition text;
BEGIN
  -- Match API lock order: persisted actor -> organization -> manufacturer profile -> report.
  SELECT a.role,a.state,a.organization_id,o.type INTO actual FROM user_accounts a
    JOIN organizations o ON o.id=a.organization_id WHERE a.id=p_actor
    FOR NO KEY UPDATE OF a FOR SHARE OF o;
  IF NOT FOUND OR actual.state<>'active' OR
    (CASE WHEN p_own THEN actual.role<>'manufacturer' OR actual.type<>'manufacturer'
      OR actual.organization_id IS DISTINCT FROM p_organization
    ELSE actual.role<>'expert' OR actual.type<>'imbc' END) THEN
    RAISE EXCEPTION 'Survey actor is not currently authorized' USING ERRCODE='23514';
  END IF;
  required_action=CASE WHEN p_own THEN 'tier.request' ELSE 'imbc_records.edit' END;
  required_condition=CASE WHEN p_own THEN 'own_organisation' ELSE 'none' END;
  IF NOT EXISTS(SELECT 1 FROM policy_rule WHERE role=actual.role AND data_class='c_imbc'
    AND action=required_action AND condition=required_condition AND effect='allow')
    OR EXISTS(SELECT 1 FROM policy_rule WHERE role=actual.role AND data_class='c_imbc'
      AND action=required_action AND (effect='deny' OR condition<>required_condition)) THEN
    RAISE EXCEPTION 'Survey persisted policy refuses this action' USING ERRCODE='23514';
  END IF;
END $$;
--> statement-breakpoint
-- The replay receipt binds every field, including exact report metadata, to the sealed native row.
CREATE FUNCTION site_survey_record_view(p_row jsonb) RETURNS jsonb LANGUAGE sql STABLE
SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT CASE WHEN p_row IS NULL OR p_row='null'::jsonb THEN 'null'::jsonb ELSE
    jsonb_build_object('id',r.id,'profileId',r.profile_id,'organizationId',r.organization_id,
      'visitStartedOn',r.visit_started_on,'visitEndedOn',r.visit_ended_on,'result',r.result,
      'reportFileId',r.file_object_id,'reportFileVersionId',r.file_version_id,'reportFileVersionNumber',v.version_number,
      'expiresOn',r.expires_on,'comment',r.comment,'source',r.source,'recordedBy',r.recorded_by,
      'recordedAt',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'updatedAt',to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'needsReconciliation',false,'recordedByName',a.full_name,
      'report',CASE WHEN r.file_object_id IS NULL THEN NULL ELSE jsonb_build_object(
        'fileId',r.file_object_id,'versionId',v.id,'versionNumber',v.version_number,'originalName',v.original_name,
        'byteSize',v.byte_size,'mediaType',v.detected_media_type,'scanState',v.scan_state,'rejectionReason',v.rejection_reason,
        'uploadedAt',to_char(v.uploaded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'canDownload',v.scan_state='passed' AND f.purge_requested_at IS NULL) END) END
  FROM jsonb_populate_record(NULL::site_survey_record,coalesce(nullif(p_row,'null'::jsonb),'{}'::jsonb)) r
  LEFT JOIN file_object f ON f.id=r.file_object_id AND f.organization_id=r.organization_id
    AND f.purpose='site_survey_report' AND f.data_class='c_imbc'
  LEFT JOIN file_version v ON v.id=r.file_version_id AND v.file_object_id=f.id
  LEFT JOIN user_accounts a ON a.id=r.recorded_by
$$;
--> statement-breakpoint
CREATE FUNCTION site_survey_operation_seal() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE entry record; actual_before jsonb; after_row site_survey_record%ROWTYPE;
  before_state jsonb; after_state jsonb; report record;
BEGIN
  PERFORM site_survey_assert_actor(NEW.actor_id,NEW.organization_id,false);
  PERFORM 1 FROM manufacturer_profile p JOIN organizations o ON o.id=p.organization_id
    WHERE p.id=NEW.profile_id AND p.organization_id=NEW.organization_id AND o.type='manufacturer'
    FOR NO KEY UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'Survey manufacturer scope does not exist' USING ERRCODE='23514'; END IF;
  SELECT a.*,a.xmin::text AS insert_xid INTO entry FROM audit_entries a WHERE a.id=NEW.audit_entry_id;
  IF NOT FOUND OR entry.organization_id IS DISTINCT FROM NEW.organization_id
    OR entry.user_id IS DISTINCT FROM NEW.actor_id OR entry.object_type IS DISTINCT FROM 'site_survey_record'
    OR entry.object_id IS DISTINCT FROM NEW.survey_record_id::text OR entry.outcome IS DISTINCT FROM 'ok'
    OR entry.action IS DISTINCT FROM NEW.action
    OR entry.diff->>'operationId' IS DISTINCT FROM NEW.id::text
    OR entry.diff#>>'{actor,type}' IS DISTINCT FROM 'user' OR entry.diff#>>'{actor,id}' IS DISTINCT FROM NEW.actor_id::text
    OR NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text
    OR entry.insert_xid::numeric IS DISTINCT FROM mod(pg_current_xact_id()::text::numeric,4294967296)
    OR entry.diff->>'requestFingerprint' IS DISTINCT FROM NEW.request_fingerprint THEN
    RAISE EXCEPTION 'Invalid transaction-bound survey audit operation' USING ERRCODE='23514';
  END IF;
  SELECT to_jsonb(r) INTO actual_before FROM site_survey_record r
    WHERE r.id=NEW.survey_record_id AND r.profile_id=NEW.profile_id AND r.organization_id=NEW.organization_id
    FOR NO KEY UPDATE;
  before_state=entry.diff->'before'; after_state=entry.diff->'after';
  IF before_state IS DISTINCT FROM coalesce(actual_before,'null'::jsonb)
    OR jsonb_typeof(after_state) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Survey before snapshot differs from current record' USING ERRCODE='23514';
  END IF;
  after_row=jsonb_populate_record(NULL::site_survey_record,after_state);
  IF to_jsonb(after_row) IS DISTINCT FROM after_state OR after_row.id IS DISTINCT FROM NEW.survey_record_id
    OR after_row.profile_id IS DISTINCT FROM NEW.profile_id OR after_row.organization_id IS DISTINCT FROM NEW.organization_id
    OR after_row.updated_at IS NULL OR after_row.recorded_at IS NULL OR entry.at IS DISTINCT FROM after_row.updated_at THEN
    RAISE EXCEPTION 'Invalid complete scoped survey after snapshot' USING ERRCODE='23514';
  END IF;
  IF NEW.action='site_survey.updated' THEN
    IF actual_before IS NULL OR (after_state - ARRAY['visit_started_on','visit_ended_on','result','file_object_id',
      'file_version_id','expires_on','comment','updated_at']) IS DISTINCT FROM
      (actual_before - ARRAY['visit_started_on','visit_ended_on','result','file_object_id',
        'file_version_id','expires_on','comment','updated_at'])
      OR after_row.updated_at<=(actual_before->>'updated_at')::timestamptz THEN
      RAISE EXCEPTION 'Survey update changes immutable provenance or clock' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.action='site_survey.created' THEN
    IF actual_before IS NOT NULL OR after_row.source IS DISTINCT FROM 'expert'::survey_source
      OR after_row.recorded_by IS DISTINCT FROM NEW.actor_id OR after_row.recorded_at IS DISTINCT FROM after_row.updated_at
      OR NEW.idempotency_key IS NULL THEN
      RAISE EXCEPTION 'Invalid expert survey creation' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.action='site_survey.legacy_import' THEN
    -- Fully reconciled migration facts only. Unknown legacy dates/source/pins stay in the old table.
    IF actual_before IS NOT NULL OR after_row.source IS DISTINCT FROM 'migration'::survey_source THEN
      RAISE EXCEPTION 'Invalid canonical survey migration intent' USING ERRCODE='23514';
    END IF;
  ELSE RAISE EXCEPTION 'Unknown survey operation' USING ERRCODE='23514'; END IF;
  NEW.before_record_hash=site_survey_row_hash(before_state);
  NEW.after_record_hash=site_survey_row_hash(after_state);
  NEW.before_file_object_id=(before_state->>'file_object_id')::uuid;
  NEW.before_file_version_id=(before_state->>'file_version_id')::uuid;
  NEW.after_file_object_id=after_row.file_object_id;
  NEW.after_file_version_id=after_row.file_version_id;
  -- Normalized old/new FKs keep replaced reports retained independently of JSON audit.
  PERFORM 1 FROM file_object WHERE id IN (NEW.before_file_object_id,NEW.after_file_object_id) ORDER BY id FOR SHARE;
  IF EXISTS(SELECT 1 FROM file_object WHERE id IN (NEW.before_file_object_id,NEW.after_file_object_id)
      AND purge_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Survey report is already claimed for purge' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM file_version WHERE id IN (NEW.before_file_version_id,NEW.after_file_version_id) ORDER BY id FOR SHARE;
  IF after_row.file_object_id IS NOT NULL THEN
    SELECT f.organization_id,f.purpose,f.data_class,v.scan_state,v.detected_media_type,v.byte_size INTO report
      FROM file_object f JOIN file_version v ON v.file_object_id=f.id
      WHERE f.id=after_row.file_object_id AND v.id=after_row.file_version_id;
    IF NOT FOUND OR report.organization_id IS DISTINCT FROM NEW.organization_id
      OR report.purpose IS DISTINCT FROM 'site_survey_report'::file_purpose OR report.data_class IS DISTINCT FROM 'c_imbc'::data_class
      OR report.scan_state IS DISTINCT FROM 'passed'::scan_state OR report.byte_size NOT BETWEEN 1 AND 26214400
      OR report.detected_media_type IS NULL OR report.detected_media_type NOT IN ('application/pdf','image/jpeg','image/png',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') THEN
      RAISE EXCEPTION 'Survey report is not exact clean signed evidence' USING ERRCODE='23514';
    END IF;
  END IF;
  IF entry.diff->'beforeView' IS DISTINCT FROM site_survey_record_view(before_state)
    OR entry.diff->'afterView' IS DISTINCT FROM site_survey_record_view(after_state) THEN
    RAISE EXCEPTION 'Survey immutable receipt differs from its complete row' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Seal must run before the generic FK binding trigger reads the derived pins.
CREATE TRIGGER a_site_survey_operation_seal BEFORE INSERT ON site_survey_operation
FOR EACH ROW EXECUTE FUNCTION site_survey_operation_seal();
--> statement-breakpoint
CREATE FUNCTION site_survey_record_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE operation site_survey_operation%ROWTYPE; old_json jsonb;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Survey history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' THEN old_json=to_jsonb(OLD); END IF;
  SELECT * INTO operation FROM site_survey_operation
    WHERE id=nullif(current_setting('imbc.site_survey_operation_id',true),'')::uuid
      AND survey_record_id=NEW.id AND profile_id=NEW.profile_id AND organization_id=NEW.organization_id
      AND transaction_id=pg_current_xact_id()::text;
  IF NOT FOUND OR site_survey_row_hash(old_json) IS DISTINCT FROM operation.before_record_hash
    OR site_survey_row_hash(to_jsonb(NEW)) IS DISTINCT FROM operation.after_record_hash THEN
    RAISE EXCEPTION 'Survey mutation requires its exact current transaction audit seal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER a_site_survey_record_guard BEFORE INSERT OR UPDATE OR DELETE ON site_survey_record
FOR EACH ROW EXECUTE FUNCTION site_survey_record_guard();
--> statement-breakpoint
CREATE FUNCTION site_survey_operation_complete() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE actual jsonb;
BEGIN
  SELECT to_jsonb(r) INTO actual FROM site_survey_record r
    WHERE r.id=NEW.survey_record_id AND r.profile_id=NEW.profile_id AND r.organization_id=NEW.organization_id;
  IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text
    OR site_survey_row_hash(actual) IS DISTINCT FROM NEW.after_record_hash THEN
    RAISE EXCEPTION 'Survey commit differs from its sealed final record' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER site_survey_operation_complete AFTER INSERT ON site_survey_operation
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION site_survey_operation_complete();
--> statement-breakpoint
CREATE FUNCTION site_survey_request_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE entry record; profile_status profile_status; organization_name text;
BEGIN
  PERFORM site_survey_assert_actor(NEW.requested_by,NEW.organization_id,true);
  SELECT p.status,o.name INTO profile_status,organization_name FROM manufacturer_profile p
    JOIN organizations o ON o.id=p.organization_id AND o.type='manufacturer'
    WHERE p.id=NEW.profile_id AND p.organization_id=NEW.organization_id FOR NO KEY UPDATE OF p;
  IF NOT FOUND OR profile_status IS DISTINCT FROM 'verified'::profile_status THEN
    RAISE EXCEPTION 'Survey request requires an own verified manufacturer profile' USING ERRCODE='23514';
  END IF;
  SELECT a.*,a.xmin::text AS insert_xid INTO entry FROM audit_entries a WHERE a.id=NEW.audit_entry_id;
  IF NOT FOUND OR NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text
    OR entry.insert_xid::numeric IS DISTINCT FROM mod(pg_current_xact_id()::text::numeric,4294967296)
    OR entry.user_id IS DISTINCT FROM NEW.requested_by OR entry.organization_id IS DISTINCT FROM NEW.organization_id
    OR entry.action IS DISTINCT FROM 'site_survey.requested' OR entry.object_type IS DISTINCT FROM 'site_survey_request'
    OR entry.object_id IS DISTINCT FROM NEW.id::text OR entry.outcome IS DISTINCT FROM 'ok'
    OR entry.at IS DISTINCT FROM NEW.requested_at OR entry.diff#>>'{actor,type}' IS DISTINCT FROM 'user'
    OR entry.diff#>>'{actor,id}' IS DISTINCT FROM NEW.requested_by::text
    OR entry.diff->'before' IS DISTINCT FROM 'null'::jsonb OR entry.diff->'after' IS DISTINCT FROM to_jsonb(NEW)
    OR entry.diff->'afterView' IS DISTINCT FROM jsonb_build_object('id',NEW.id,'profileId',NEW.profile_id,
      'organizationId',NEW.organization_id,'organizationName',organization_name,'requestedBy',NEW.requested_by,
      'requestedAt',to_char(NEW.requested_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) THEN
    RAISE EXCEPTION 'Invalid complete transaction-bound survey request audit' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER site_survey_request_guard BEFORE INSERT ON site_survey_request
FOR EACH ROW EXECUTE FUNCTION site_survey_request_guard();
--> statement-breakpoint
CREATE FUNCTION site_survey_append_only() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Survey evidence cannot be changed or deleted' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER site_survey_operation_immutable BEFORE UPDATE OR DELETE ON site_survey_operation
FOR EACH ROW EXECUTE FUNCTION site_survey_append_only();
--> statement-breakpoint
CREATE TRIGGER site_survey_request_immutable BEFORE UPDATE OR DELETE ON site_survey_request
FOR EACH ROW EXECUTE FUNCTION site_survey_append_only();
--> statement-breakpoint
CREATE TRIGGER site_survey_record_no_truncate BEFORE TRUNCATE ON site_survey_record
FOR EACH STATEMENT EXECUTE FUNCTION site_survey_append_only();
--> statement-breakpoint
CREATE TRIGGER site_survey_operation_no_truncate BEFORE TRUNCATE ON site_survey_operation
FOR EACH STATEMENT EXECUTE FUNCTION site_survey_append_only();
--> statement-breakpoint
CREATE TRIGGER site_survey_request_no_truncate BEFORE TRUNCATE ON site_survey_request
FOR EACH STATEMENT EXECUTE FUNCTION site_survey_append_only();
--> statement-breakpoint
SELECT install_file_binding_guards();

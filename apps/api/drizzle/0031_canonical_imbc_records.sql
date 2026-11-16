-- IMBC-15, GEN-08..13, DATA-01..07, AUD-01..03. Additive draft; no legacy/source backfill.
-- Tables/keys generated from schema. Handwritten deferred event uniqueness/FK support exact aggregate correction and sealed creation.
CREATE FUNCTION imbc_records_folder_valid(value text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
 SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE parts text[]; host text; address inet;
 BEGIN
 IF value IS NULL THEN RETURN true; END IF;
 -- DTO writes are safely parsed WHATWG hrefs (including punycode/IPv6). Reads/history use this exact native shape.
 IF length(value)>2048 OR value COLLATE "C" !~ '^[!-~]+$' THEN RETURN false; END IF;
 parts=regexp_match(value,'^(https?)://(\[[0-9a-f:]+\]|[^/?#:@]+)(:([0-9]{1,5}))?(/.*)$');
 IF parts IS NULL OR (parts[4] IS NOT NULL AND parts[4]::int>65535) THEN RETURN false; END IF;
 host=parts[2];
 IF left(host,1)='[' THEN
   BEGIN address=substring(host from 2 for length(host)-2)::inet; EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
   RETURN family(address)=6;
 END IF;
 RETURN host !~ '[A-Z#%/:<>?@\[\]\\^|]';
 END $$;
--> statement-breakpoint
CREATE TYPE "public"."eoi_response" AS ENUM('interested', 'not_interested');--> statement-breakpoint
CREATE TYPE "public"."imbc_note_kind" AS ENUM('general', 'legacy_ranking', 'registry_review', 'migration_context');--> statement-breakpoint
CREATE TYPE "public"."imbc_record_source" AS ENUM('expert', 'migration');--> statement-breakpoint
CREATE TABLE "imbc_engagement" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_confirmed" boolean,
	"response" "eoi_response",
	"response_summary" text,
	"ready_for_site_visit" boolean,
	"added_to_imbc_year" integer,
	"folder_url" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "imbc_record_source" NOT NULL,
	CONSTRAINT "imbc_engagement_scope_uq" UNIQUE("profile_id","organization_id"),
	CONSTRAINT "imbc_engagement_year_ck" CHECK ("imbc_engagement"."added_to_imbc_year" between 1 and 9999),
	CONSTRAINT "imbc_engagement_summary_ck" CHECK (length("imbc_engagement"."response_summary")<=10000),
	CONSTRAINT "imbc_engagement_folder_ck" CHECK (imbc_records_folder_valid("imbc_engagement"."folder_url")),
	CONSTRAINT "imbc_engagement_clock_ck" CHECK ("imbc_engagement"."updated_at">="imbc_engagement"."created_at"),
	CONSTRAINT "imbc_engagement_expert_ck" CHECK ("imbc_engagement"."source"<>'expert' or "imbc_engagement"."recorded_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "imbc_engagement_source" (
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_entry_id" uuid NOT NULL,
	CONSTRAINT "imbc_engagement_source_profile_id_source_entry_id_pk" PRIMARY KEY("profile_id","source_entry_id")
);
--> statement-breakpoint
CREATE TABLE "imbc_eoi_email_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"sent_on" date NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "imbc_record_source" NOT NULL,
	CONSTRAINT "imbc_eoi_event_date_uq" UNIQUE("profile_id","sent_on") DEFERRABLE INITIALLY DEFERRED,
	CONSTRAINT "imbc_eoi_event_scope_uq" UNIQUE("id","profile_id","organization_id"),
	CONSTRAINT "imbc_eoi_event_clock_ck" CHECK ("imbc_eoi_email_event"."updated_at">="imbc_eoi_email_event"."created_at"),
	CONSTRAINT "imbc_eoi_event_date_ck" CHECK ("imbc_eoi_email_event"."sent_on">='0001-01-01'::date and "imbc_eoi_email_event"."sent_on"<='9999-12-31'::date),
	CONSTRAINT "imbc_eoi_event_expert_ck" CHECK ("imbc_eoi_email_event"."source"<>'expert' or "imbc_eoi_email_event"."recorded_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "imbc_note" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_id" uuid,
	"kind" "imbc_note_kind" DEFAULT 'general' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "imbc_record_source" NOT NULL,
	CONSTRAINT "imbc_note_scope_uq" UNIQUE("id","profile_id","organization_id"),
	CONSTRAINT "imbc_note_body_ck" CHECK (length(btrim("imbc_note"."body",U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0 and length("imbc_note"."body")<=10000),
	CONSTRAINT "imbc_note_clock_ck" CHECK ("imbc_note"."updated_at">="imbc_note"."created_at"),
	CONSTRAINT "imbc_note_expert_ck" CHECK ("imbc_note"."source"<>'expert' or "imbc_note"."author_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "imbc_product_context" (
	"product_line_identity_id" uuid PRIMARY KEY NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"programme_id" uuid,
	"priority_id" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "imbc_record_source" NOT NULL,
	CONSTRAINT "imbc_product_context_clock_ck" CHECK ("imbc_product_context"."updated_at">="imbc_product_context"."created_at"),
	CONSTRAINT "imbc_product_context_expert_ck" CHECK ("imbc_product_context"."source"<>'expert' or "imbc_product_context"."recorded_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "imbc_records_operation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"record_kind" text NOT NULL,
	"record_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	"audit_entry_id" uuid NOT NULL,
	"transaction_id" text DEFAULT pg_current_xact_id()::text NOT NULL,
	"before_record_hash" text,
	"after_record_hash" text NOT NULL,
	"before_programme_id" uuid,
	"after_programme_id" uuid,
	"before_priority_id" uuid,
	"after_priority_id" uuid,
	CONSTRAINT "imbc_records_operation_actor_key_uq" UNIQUE("actor_id","idempotency_key"),
	CONSTRAINT "imbc_records_operation_transaction_uq" UNIQUE("record_kind","record_id","transaction_id"),
	CONSTRAINT "imbc_records_operation_audit_entry_id_key" UNIQUE("audit_entry_id"),
	CONSTRAINT "imbc_records_operation_record_kind_check" CHECK ("imbc_records_operation"."record_kind" in ('note','engagement','product_context')),
	CONSTRAINT "imbc_records_operation_request_fingerprint_check" CHECK ("imbc_records_operation"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "imbc_records_operation_action_ck" CHECK ("imbc_records_operation"."action" in ('imbc_note.created','imbc_note.updated','imbc_engagement.created','imbc_engagement.updated','imbc_product_context.created','imbc_product_context.updated'))
);
--> statement-breakpoint
CREATE TABLE "imbc_records_operation_child" (
	"operation_id" uuid NOT NULL,
	"phase" text NOT NULL,
	"child_kind" text NOT NULL,
	"child_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_entry_id" uuid,
	"eoi_event_id" uuid,
	"sent_on" date,
	"recorded_by" uuid,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"source" "imbc_record_source",
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "imbc_records_operation_child_operation_id_phase_child_kind_child_id_pk" PRIMARY KEY("operation_id","phase","child_kind","child_id"),
	CONSTRAINT "imbc_records_operation_child_phase_check" CHECK ("imbc_records_operation_child"."phase" in ('before','after')),
	CONSTRAINT "imbc_records_operation_child_child_kind_check" CHECK ("imbc_records_operation_child"."child_kind" in ('source','eoi')),
	CONSTRAINT "imbc_records_operation_child_shape_ck" CHECK (("imbc_records_operation_child"."child_kind"='source' and "imbc_records_operation_child"."source_entry_id" is not null and "imbc_records_operation_child"."source_entry_id"="imbc_records_operation_child"."child_id" and "imbc_records_operation_child"."eoi_event_id" is null and "imbc_records_operation_child"."sent_on" is null and "imbc_records_operation_child"."recorded_by" is null and "imbc_records_operation_child"."created_at" is null and "imbc_records_operation_child"."updated_at" is null and "imbc_records_operation_child"."source" is null)
    or ("imbc_records_operation_child"."child_kind"='eoi' and "imbc_records_operation_child"."source_entry_id" is null and "imbc_records_operation_child"."eoi_event_id" is not null and "imbc_records_operation_child"."eoi_event_id"="imbc_records_operation_child"."child_id" and "imbc_records_operation_child"."sent_on" is not null and "imbc_records_operation_child"."created_at" is not null and "imbc_records_operation_child"."updated_at" is not null and "imbc_records_operation_child"."source" is not null))
);
--> statement-breakpoint
ALTER TABLE "imbc_engagement" ADD CONSTRAINT "imbc_engagement_recorded_by_user_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_engagement" ADD CONSTRAINT "imbc_engagement_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_engagement_source" ADD CONSTRAINT "imbc_engagement_source_source_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_engagement_source" ADD CONSTRAINT "imbc_engagement_source_scope_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."imbc_engagement"("profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_eoi_email_event" ADD CONSTRAINT "imbc_eoi_email_event_recorded_by_user_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_eoi_email_event" ADD CONSTRAINT "imbc_eoi_email_event_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."imbc_engagement"("profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_note" ADD CONSTRAINT "imbc_note_author_id_user_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_note" ADD CONSTRAINT "imbc_note_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_product_context" ADD CONSTRAINT "imbc_product_context_programme_id_dictionary_entry_id_fk" FOREIGN KEY ("programme_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_product_context" ADD CONSTRAINT "imbc_product_context_priority_id_dictionary_entry_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_product_context" ADD CONSTRAINT "imbc_product_context_recorded_by_user_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_product_context" ADD CONSTRAINT "imbc_product_context_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_product_context" ADD CONSTRAINT "imbc_product_context_product_org_fk" FOREIGN KEY ("product_line_identity_id","organization_id") REFERENCES "public"."product_line_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation" ADD CONSTRAINT "imbc_records_operation_actor_id_user_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation" ADD CONSTRAINT "imbc_records_operation_audit_entry_id_audit_entries_id_fk" FOREIGN KEY ("audit_entry_id") REFERENCES "public"."audit_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation" ADD CONSTRAINT "imbc_records_operation_before_programme_id_dictionary_entry_id_fk" FOREIGN KEY ("before_programme_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation" ADD CONSTRAINT "imbc_records_operation_after_programme_id_dictionary_entry_id_fk" FOREIGN KEY ("after_programme_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation" ADD CONSTRAINT "imbc_records_operation_before_priority_id_dictionary_entry_id_fk" FOREIGN KEY ("before_priority_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation" ADD CONSTRAINT "imbc_records_operation_after_priority_id_dictionary_entry_id_fk" FOREIGN KEY ("after_priority_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation" ADD CONSTRAINT "imbc_records_operation_profile_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation_child" ADD CONSTRAINT "imbc_records_operation_child_operation_id_imbc_records_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."imbc_records_operation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation_child" ADD CONSTRAINT "imbc_records_operation_child_source_entry_id_dictionary_entry_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation_child" ADD CONSTRAINT "imbc_records_operation_child_recorded_by_user_accounts_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation_child" ADD CONSTRAINT "imbc_records_operation_child_profile_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imbc_records_operation_child" ADD CONSTRAINT "imbc_records_operation_child_event_fk" FOREIGN KEY ("eoi_event_id","profile_id","organization_id") REFERENCES "public"."imbc_eoi_email_event"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "imbc_note_profile_idx" ON "imbc_note" USING btree ("profile_id","created_at","id");--> statement-breakpoint
CREATE INDEX "imbc_records_operation_history_idx" ON "imbc_records_operation" USING btree ("profile_id","record_kind","record_id","id");
--> statement-breakpoint
INSERT INTO dictionary(id,code,name) VALUES
 ('9fba673a-27f1-40d2-8bac-eee003100001','acquisition_source','Acquisition source'),
 ('9fba673a-27f1-40d2-8bac-eee003100002','imbc_priority','IMBC priority') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
-- acquisition_source stays empty; approved priority1..6 are loaded through reference-data/release/imbc_priority.json.
--> statement-breakpoint
CREATE FUNCTION imbc_records_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
 SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN value IS NULL OR value='null'::jsonb THEN NULL
 ELSE encode(sha256(convert_to(value::text,'UTF8')),'hex') END $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_snapshot(p_kind text,p_id uuid,p_profile uuid,p_org uuid) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=pg_catalog,public,pg_temp AS $$
 DECLARE r jsonb;
 BEGIN
 IF p_kind='note' THEN SELECT to_jsonb(n) INTO r FROM imbc_note n WHERE id=p_id AND profile_id=p_profile AND organization_id=p_org;
 ELSIF p_kind='engagement' THEN SELECT to_jsonb(n) INTO r FROM imbc_engagement n WHERE profile_id=p_id AND profile_id=p_profile AND organization_id=p_org;
 ELSIF p_kind='product_context' THEN SELECT to_jsonb(n) INTO r FROM imbc_product_context n WHERE product_line_identity_id=p_id AND profile_id=p_profile AND organization_id=p_org;
 ELSE RAISE EXCEPTION 'Unknown IMBC record kind' USING ERRCODE='23514'; END IF;
 IF r IS NULL THEN RETURN 'null'::jsonb; END IF;
 RETURN jsonb_build_object('row',r,'sources',CASE WHEN p_kind='engagement' THEN coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY source_entry_id)
 FROM imbc_engagement_source s WHERE profile_id=p_profile AND organization_id=p_org),'[]'::jsonb) ELSE '[]'::jsonb END,
 'eoiEvents',CASE WHEN p_kind='engagement' THEN coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id)
 FROM imbc_eoi_email_event e WHERE profile_id=p_profile AND organization_id=p_org),'[]'::jsonb) ELSE '[]'::jsonb END);
 END $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_normalize(p_kind text,p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=pg_catalog,public,pg_temp AS $$
 DECLARE r jsonb; sources jsonb; events jsonb;
 BEGIN
 IF p_snapshot IS NULL OR p_snapshot='null'::jsonb THEN RETURN 'null'::jsonb; END IF;
 IF p_kind='note' THEN r=to_jsonb(jsonb_populate_record(NULL::imbc_note,p_snapshot->'row'));
 ELSIF p_kind='engagement' THEN r=to_jsonb(jsonb_populate_record(NULL::imbc_engagement,p_snapshot->'row'));
 ELSIF p_kind='product_context' THEN r=to_jsonb(jsonb_populate_record(NULL::imbc_product_context,p_snapshot->'row'));
 ELSE RAISE EXCEPTION 'Unknown IMBC record kind' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.source_entry_id),'[]'::jsonb) INTO sources
 FROM jsonb_populate_recordset(NULL::imbc_engagement_source,p_snapshot->'sources') s;
 SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) INTO events
 FROM jsonb_populate_recordset(NULL::imbc_eoi_email_event,p_snapshot->'eoiEvents') e;
 RETURN jsonb_build_object('row',r,'sources',sources,'eoiEvents',events);
 END $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_utc6(at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
 SET search_path=pg_catalog,public,pg_temp AS $$ SELECT to_char(at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_view(p_kind text,p_snapshot jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE
 SET search_path=pg_catalog,public,pg_temp AS $$
 DECLARE r jsonb; v jsonb; author_name text; event_views jsonb;
 BEGIN
 IF p_snapshot IS NULL OR p_snapshot='null'::jsonb THEN RETURN 'null'::jsonb; END IF;
 r=p_snapshot->'row';
 SELECT full_name INTO author_name FROM user_accounts WHERE id=coalesce(r->>'author_id',r->>'recorded_by')::uuid;
 v=jsonb_build_object('profileId',r->>'profile_id','organizationId',r->>'organization_id','source',r->>'source',
 'createdAt',imbc_records_utc6((r->>'created_at')::timestamptz),'updatedAt',imbc_records_utc6((r->>'updated_at')::timestamptz));
 IF p_kind='note' THEN RETURN v||jsonb_build_object('id',r->>'id','authorId',r->>'author_id','authorName',author_name,'kind',r->>'kind','body',r->>'body'); END IF;
 v=v||jsonb_build_object('recordedBy',r->>'recorded_by','recordedByName',author_name);
 IF p_kind='product_context' THEN RETURN v||jsonb_build_object('productLineIdentityId',r->>'product_line_identity_id',
 'programmeId',r->>'programme_id','priorityId',r->>'priority_id'); END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'sentOn',e.sent_on,'source',e.source,
 'recordedBy',e.recorded_by,'recordedByName',a.full_name,'createdAt',imbc_records_utc6(e.created_at),'updatedAt',imbc_records_utc6(e.updated_at)) ORDER BY e.id),'[]'::jsonb)
 INTO event_views FROM jsonb_populate_recordset(NULL::imbc_eoi_email_event,p_snapshot->'eoiEvents') e LEFT JOIN user_accounts a ON a.id=e.recorded_by;
 RETURN v||jsonb_build_object('receiptConfirmed',r->'receipt_confirmed','response',r->'response','responseSummary',r->'response_summary',
 'readyForSiteVisit',r->'ready_for_site_visit','addedToImbcYear',r->'added_to_imbc_year','folderUrl',r->'folder_url',
 'sourceEntryIds',(SELECT coalesce(jsonb_agg(s->>'source_entry_id' ORDER BY s->>'source_entry_id'),'[]'::jsonb) FROM jsonb_array_elements(p_snapshot->'sources') s),
 'eoiEvents',event_views);
 END $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_assert_actor(p_actor uuid) RETURNS void LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE actual record;
 BEGIN
 SELECT a.role,a.state,o.type INTO actual FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
 WHERE a.id=p_actor FOR NO KEY UPDATE OF a FOR SHARE OF o;
 IF NOT FOUND OR actual.state<>'active' OR actual.role<>'expert' OR actual.type<>'imbc' THEN
 RAISE EXCEPTION 'Current actor cannot edit IMBC records' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM policy_rule WHERE role=actual.role AND action='imbc_records.edit' AND data_class='c_imbc' AND condition='none' AND effect='allow')
 OR EXISTS(SELECT 1 FROM policy_rule WHERE role=actual.role AND action='imbc_records.edit' AND data_class='c_imbc' AND (effect='deny' OR condition<>'none')) THEN
 RAISE EXCEPTION 'Current policy refuses IMBC record edit' USING ERRCODE='23514'; END IF;
 END $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_operation_seal() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$
 DECLARE entry record; b jsonb; a jsonb; r jsonb; old_child jsonb; child jsonb; field text; expected_action text; clock timestamptz;
 BEGIN
 PERFORM imbc_records_assert_actor(NEW.actor_id);
 PERFORM 1 FROM manufacturer_profile p JOIN organizations o ON o.id=p.organization_id AND o.type='manufacturer'
 WHERE p.id=NEW.profile_id AND p.organization_id=NEW.organization_id FOR NO KEY UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid manufacturer scope' USING ERRCODE='23514'; END IF;
 IF NEW.record_kind='product_context' THEN
 PERFORM 1 FROM product_line_identity WHERE id=NEW.record_id AND profile_id=NEW.profile_id AND organization_id=NEW.organization_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invalid product scope' USING ERRCODE='23514'; END IF; END IF;
 SELECT e.*,e.xmin::text AS insert_xid INTO entry FROM audit_entries e WHERE id=NEW.audit_entry_id;
 IF NOT FOUND OR entry.user_id IS DISTINCT FROM NEW.actor_id OR entry.organization_id IS DISTINCT FROM NEW.organization_id
 OR entry.object_type IS DISTINCT FROM 'imbc_'||NEW.record_kind OR entry.object_id IS DISTINCT FROM NEW.record_id::text
 OR entry.action IS DISTINCT FROM NEW.action OR entry.outcome IS DISTINCT FROM 'ok'
 OR NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text
 OR entry.insert_xid::numeric IS DISTINCT FROM mod(pg_current_xact_id()::text::numeric,4294967296)
 OR entry.diff->>'operationId' IS DISTINCT FROM NEW.id::text OR entry.diff#>>'{actor,type}' IS DISTINCT FROM 'user'
 OR entry.diff#>>'{actor,id}' IS DISTINCT FROM NEW.actor_id::text OR entry.diff->>'requestFingerprint' IS DISTINCT FROM NEW.request_fingerprint THEN
 RAISE EXCEPTION 'Invalid transaction-bound IMBC audit' USING ERRCODE='23514'; END IF;
 b=imbc_records_snapshot(NEW.record_kind,NEW.record_id,NEW.profile_id,NEW.organization_id); a=entry.diff->'after'; r=a->'row';
 IF entry.diff->'before' IS DISTINCT FROM b OR a IS DISTINCT FROM imbc_records_normalize(NEW.record_kind,a)
 OR jsonb_typeof(r) IS DISTINCT FROM 'object' OR r->>'profile_id' IS DISTINCT FROM NEW.profile_id::text
 OR r->>'organization_id' IS DISTINCT FROM NEW.organization_id::text
 OR coalesce(r->>'id',r->>'product_line_identity_id',r->>'profile_id') IS DISTINCT FROM NEW.record_id::text THEN
 RAISE EXCEPTION 'IMBC complete before/after snapshot differs' USING ERRCODE='23514'; END IF;
 expected_action='imbc_'||NEW.record_kind||CASE WHEN b='null'::jsonb THEN '.created' ELSE '.updated' END;
 clock=(r->>'updated_at')::timestamptz;
 IF NEW.action IS DISTINCT FROM expected_action OR clock IS NULL OR entry.at IS DISTINCT FROM clock
 OR (r->>'created_at')::timestamptz IS NULL THEN RAISE EXCEPTION 'Invalid IMBC action/clock' USING ERRCODE='23514'; END IF;
 IF b='null'::jsonb THEN
 IF NEW.record_kind='product_context' THEN
 PERFORM 1 FROM product_line p JOIN section_revision rev ON rev.id=p.section_revision_id AND rev.organization_id=p.organization_id
 JOIN profile_section s ON s.id=rev.profile_section_id AND s.organization_id=rev.organization_id AND s.kind='products'
 WHERE p.identity_id=NEW.record_id AND p.organization_id=NEW.organization_id AND s.profile_id=NEW.profile_id FOR SHARE OF p,rev,s;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserved product identity has no established canonical meaning' USING ERRCODE='23514'; END IF;
 END IF;
 IF r->>'source' IS DISTINCT FROM 'expert' OR coalesce(r->>'author_id',r->>'recorded_by') IS DISTINCT FROM NEW.actor_id::text
 OR clock IS DISTINCT FROM (r->>'created_at')::timestamptz OR (NEW.record_kind='note' AND r->>'kind' IS DISTINCT FROM 'general') THEN
 RAISE EXCEPTION 'Expert cannot fabricate imported provenance' USING ERRCODE='23514'; END IF;
 ELSE
 IF clock<=(b#>>'{row,updated_at}')::timestamptz THEN RAISE EXCEPTION 'Stale IMBC clock' USING ERRCODE='23514'; END IF;
 IF NEW.record_kind='note' THEN
 IF (r-ARRAY['body','updated_at']) IS DISTINCT FROM ((b->'row')-ARRAY['body','updated_at']) THEN
 RAISE EXCEPTION 'Immutable note provenance changed' USING ERRCODE='23514'; END IF;
 ELSIF NEW.record_kind='engagement' THEN
 IF (r-ARRAY['receipt_confirmed','response','response_summary','ready_for_site_visit','added_to_imbc_year','folder_url','updated_at'])
 IS DISTINCT FROM ((b->'row')-ARRAY['receipt_confirmed','response','response_summary','ready_for_site_visit','added_to_imbc_year','folder_url','updated_at']) THEN
 RAISE EXCEPTION 'Immutable engagement provenance changed' USING ERRCODE='23514'; END IF;
 ELSE
 IF (r-ARRAY['programme_id','priority_id','updated_at']) IS DISTINCT FROM ((b->'row')-ARRAY['programme_id','priority_id','updated_at']) THEN
 RAISE EXCEPTION 'Immutable product-context provenance changed' USING ERRCODE='23514'; END IF;
 END IF; END IF;
 IF NEW.record_kind<>'engagement' AND ((a->'sources')<>'[]'::jsonb OR (a->'eoiEvents')<>'[]'::jsonb) THEN
 RAISE EXCEPTION 'Only engagement has historical children' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(a->'sources')>100 OR jsonb_array_length(a->'eoiEvents')>200
 OR (SELECT count(*)<>count(DISTINCT c->>'source_entry_id') FROM jsonb_array_elements(a->'sources') c)
 OR (SELECT count(*)<>count(DISTINCT c->>'id') OR count(*)<>count(DISTINCT c->>'sent_on') FROM jsonb_array_elements(a->'eoiEvents') c) THEN
 RAISE EXCEPTION 'Duplicate or excessive engagement children' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM dictionary_entry WHERE id IN (
 SELECT (c->>'source_entry_id')::uuid FROM jsonb_array_elements(a->'sources') c
 UNION SELECT (r->>'programme_id')::uuid UNION SELECT (r->>'priority_id')::uuid) ORDER BY id FOR SHARE;
 FOR child IN SELECT value FROM jsonb_array_elements(a->'sources') LOOP
 IF child->>'profile_id' IS DISTINCT FROM NEW.profile_id::text OR child->>'organization_id' IS DISTINCT FROM NEW.organization_id::text
 OR NOT EXISTS(SELECT 1 FROM dictionary_entry e JOIN dictionary d ON d.id=e.dictionary_id WHERE e.id=(child->>'source_entry_id')::uuid
 AND d.code='acquisition_source' AND (e.retired_at IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(b->'sources','[]'::jsonb)) x WHERE x=child))) THEN
 RAISE EXCEPTION 'Invalid acquisition source' USING ERRCODE='23514'; END IF; END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(b->'eoiEvents','[]'::jsonb)) prior_event
 WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'eoiEvents') n WHERE n->>'id'=prior_event->>'id')) THEN
 RAISE EXCEPTION 'Historical EOI events cannot be removed' USING ERRCODE='23514'; END IF;
 FOR child IN SELECT value FROM jsonb_array_elements(a->'eoiEvents') LOOP
 SELECT value INTO old_child FROM jsonb_array_elements(coalesce(b->'eoiEvents','[]'::jsonb)) x WHERE x->>'id'=child->>'id';
 IF child->>'profile_id' IS DISTINCT FROM NEW.profile_id::text OR child->>'organization_id' IS DISTINCT FROM NEW.organization_id::text
 OR child->>'id' IS NULL OR child->>'sent_on' IS NULL OR (child->>'sent_on')::date NOT BETWEEN '0001-01-01'::date AND '9999-12-31'::date THEN
 RAISE EXCEPTION 'Invalid historical EOI scope/date' USING ERRCODE='23514'; END IF;
 IF old_child IS NULL THEN
 IF EXISTS(SELECT 1 FROM imbc_eoi_email_event WHERE id=(child->>'id')::uuid) THEN RAISE EXCEPTION 'EOI identity already belongs to established history' USING ERRCODE='23514'; END IF;
 IF child->>'source' IS DISTINCT FROM 'expert' OR child->>'recorded_by' IS DISTINCT FROM NEW.actor_id::text
 OR (child->>'created_at')::timestamptz IS DISTINCT FROM clock OR (child->>'updated_at')::timestamptz IS DISTINCT FROM clock THEN
 RAISE EXCEPTION 'Invalid new historical EOI provenance' USING ERRCODE='23514'; END IF;
 ELSE
 IF (child-ARRAY['sent_on','updated_at']) IS DISTINCT FROM (old_child-ARRAY['sent_on','updated_at'])
 OR (CASE WHEN child->>'sent_on'=old_child->>'sent_on' THEN child IS DISTINCT FROM old_child
 ELSE (child->>'updated_at')::timestamptz IS DISTINCT FROM clock OR clock<=(old_child->>'updated_at')::timestamptz END) THEN
 RAISE EXCEPTION 'Historical EOI correction changes provenance' USING ERRCODE='23514'; END IF;
 END IF; END LOOP;
 IF NEW.record_kind='product_context' THEN
 FOREACH field IN ARRAY ARRAY['programme_id','priority_id'] LOOP
 IF r->>field IS NOT NULL AND NOT EXISTS(SELECT 1 FROM dictionary_entry e JOIN dictionary d ON d.id=e.dictionary_id
 WHERE e.id=(r->>field)::uuid AND d.code=CASE field WHEN 'programme_id' THEN 'programme' ELSE 'imbc_priority' END
 AND (e.retired_at IS NULL OR r->>field=b#>>ARRAY['row',field])) THEN
 RAISE EXCEPTION 'Invalid product-context dictionary' USING ERRCODE='23514'; END IF; END LOOP;
 NEW.before_programme_id=(b#>>'{row,programme_id}')::uuid; NEW.after_programme_id=(r->>'programme_id')::uuid;
 NEW.before_priority_id=(b#>>'{row,priority_id}')::uuid; NEW.after_priority_id=(r->>'priority_id')::uuid;
 ELSE
 NEW.before_programme_id=NULL; NEW.after_programme_id=NULL; NEW.before_priority_id=NULL; NEW.after_priority_id=NULL;
 END IF;
 IF entry.diff->'beforeView' IS DISTINCT FROM imbc_records_view(NEW.record_kind,b)
 OR entry.diff->'afterView' IS DISTINCT FROM imbc_records_view(NEW.record_kind,a) THEN
 RAISE EXCEPTION 'Immutable IMBC receipt differs from complete row' USING ERRCODE='23514'; END IF;
 NEW.before_record_hash=imbc_records_hash(b); NEW.after_record_hash=imbc_records_hash(a);
 RETURN NEW;
 END $$;
--> statement-breakpoint
CREATE TRIGGER a_imbc_records_operation_seal BEFORE INSERT ON imbc_records_operation FOR EACH ROW EXECUTE FUNCTION imbc_records_operation_seal();
--> statement-breakpoint
CREATE FUNCTION imbc_records_child_snapshots() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE diff jsonb; phase_name text; c jsonb;
 BEGIN
 SELECT e.diff INTO diff FROM audit_entries e WHERE e.id=NEW.audit_entry_id;
 FOREACH phase_name IN ARRAY ARRAY['before','after'] LOOP
 FOR c IN SELECT value FROM jsonb_array_elements(coalesce(diff#>ARRAY[phase_name,'sources'],'[]'::jsonb)) LOOP
 INSERT INTO imbc_records_operation_child(operation_id,phase,child_kind,child_id,profile_id,organization_id,source_entry_id,snapshot)
 VALUES(NEW.id,phase_name,'source',(c->>'source_entry_id')::uuid,NEW.profile_id,NEW.organization_id,(c->>'source_entry_id')::uuid,c); END LOOP;
 FOR c IN SELECT value FROM jsonb_array_elements(coalesce(diff#>ARRAY[phase_name,'eoiEvents'],'[]'::jsonb)) LOOP
 INSERT INTO imbc_records_operation_child(operation_id,phase,child_kind,child_id,profile_id,organization_id,eoi_event_id,sent_on,recorded_by,created_at,updated_at,source,snapshot)
 VALUES(NEW.id,phase_name,'eoi',(c->>'id')::uuid,NEW.profile_id,NEW.organization_id,(c->>'id')::uuid,(c->>'sent_on')::date,
 (c->>'recorded_by')::uuid,(c->>'created_at')::timestamptz,(c->>'updated_at')::timestamptz,(c->>'source')::imbc_record_source,c); END LOOP;
 END LOOP; RETURN NULL; END $$;
--> statement-breakpoint
CREATE TRIGGER imbc_records_child_snapshots AFTER INSERT ON imbc_records_operation FOR EACH ROW EXECUTE FUNCTION imbc_records_child_snapshots();
--> statement-breakpoint
CREATE FUNCTION imbc_records_child_snapshot_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE operation imbc_records_operation%ROWTYPE; diff jsonb; key_name text; array_name text;
 BEGIN
 SELECT * INTO operation FROM imbc_records_operation WHERE id=NEW.operation_id AND transaction_id=pg_current_xact_id()::text;
 SELECT e.diff INTO diff FROM audit_entries e WHERE id=operation.audit_entry_id;
 key_name=CASE NEW.child_kind WHEN 'source' THEN 'source_entry_id' ELSE 'id' END;
 array_name=CASE NEW.child_kind WHEN 'source' THEN 'sources' ELSE 'eoiEvents' END;
 IF operation.id IS NULL OR NEW.profile_id IS DISTINCT FROM operation.profile_id OR NEW.organization_id IS DISTINCT FROM operation.organization_id
 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(diff#>ARRAY[NEW.phase,array_name],'[]'::jsonb)) x
 WHERE x=NEW.snapshot AND x->>key_name=NEW.child_id::text)
 OR (NEW.child_kind='source' AND NEW.snapshot IS DISTINCT FROM jsonb_build_object('profile_id',NEW.profile_id,'organization_id',NEW.organization_id,'source_entry_id',NEW.source_entry_id))
 OR (NEW.child_kind='eoi' AND NEW.snapshot IS DISTINCT FROM jsonb_build_object('id',NEW.child_id,'profile_id',NEW.profile_id,'organization_id',NEW.organization_id,
 'sent_on',NEW.sent_on,'recorded_by',NEW.recorded_by,'created_at',NEW.created_at,'updated_at',NEW.updated_at,'source',NEW.source)) THEN
 RAISE EXCEPTION 'Uncorrelated normalized IMBC history child' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER a_imbc_records_child_snapshot_guard BEFORE INSERT ON imbc_records_operation_child FOR EACH ROW EXECUTE FUNCTION imbc_records_child_snapshot_guard();
--> statement-breakpoint
CREATE FUNCTION imbc_records_row_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE op imbc_records_operation%ROWTYPE; diff jsonb; kind_name text; id_value uuid; old_json jsonb;
 BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMBC record cannot be deleted' USING ERRCODE='23514'; END IF;
 kind_name=CASE TG_TABLE_NAME WHEN 'imbc_note' THEN 'note' WHEN 'imbc_engagement' THEN 'engagement' ELSE 'product_context' END;
 id_value=coalesce(to_jsonb(NEW)->>'id',to_jsonb(NEW)->>'product_line_identity_id',to_jsonb(NEW)->>'profile_id')::uuid;
 SELECT * INTO op FROM imbc_records_operation WHERE id=nullif(current_setting('imbc.records_operation_id',true),'')::uuid
 AND record_kind=kind_name AND record_id=id_value AND profile_id=NEW.profile_id AND organization_id=NEW.organization_id
 AND transaction_id=pg_current_xact_id()::text;
 SELECT e.diff INTO diff FROM audit_entries e WHERE id=op.audit_entry_id;
 IF TG_OP='UPDATE' THEN old_json=to_jsonb(OLD); END IF;
 IF op.id IS NULL OR diff#>'{before,row}' IS DISTINCT FROM old_json OR diff#>'{after,row}' IS DISTINCT FROM to_jsonb(NEW) THEN
 RAISE EXCEPTION 'IMBC row requires exact current transaction seal' USING ERRCODE='23514'; END IF; RETURN NEW;
 END $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_engagement_child_guard() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE op imbc_records_operation%ROWTYPE; diff jsonb; row_json jsonb; old_json jsonb; key_name text; array_name text; old_intent jsonb; new_intent jsonb;
 BEGIN
 IF TG_TABLE_NAME='imbc_eoi_email_event' AND TG_OP='DELETE' THEN RAISE EXCEPTION 'EOI history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='imbc_engagement_source' AND TG_OP='UPDATE' THEN RAISE EXCEPTION 'Replace normalized source set' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN row_json=to_jsonb(OLD); ELSE row_json=to_jsonb(NEW); END IF;
 IF TG_OP='UPDATE' THEN old_json=to_jsonb(OLD); ELSIF TG_OP='DELETE' THEN old_json=row_json; END IF;
 SELECT * INTO op FROM imbc_records_operation WHERE id=nullif(current_setting('imbc.records_operation_id',true),'')::uuid
 AND record_kind='engagement' AND record_id=(row_json->>'profile_id')::uuid AND profile_id=(row_json->>'profile_id')::uuid
 AND organization_id=(row_json->>'organization_id')::uuid AND transaction_id=pg_current_xact_id()::text;
 SELECT e.diff INTO diff FROM audit_entries e WHERE id=op.audit_entry_id;
 key_name=CASE TG_TABLE_NAME WHEN 'imbc_engagement_source' THEN 'source_entry_id' ELSE 'id' END;
 array_name=CASE TG_TABLE_NAME WHEN 'imbc_engagement_source' THEN 'sources' ELSE 'eoiEvents' END;
 SELECT value INTO old_intent FROM jsonb_array_elements(coalesce(diff#>ARRAY['before',array_name],'[]'::jsonb)) x WHERE x->>key_name=row_json->>key_name;
 SELECT value INTO new_intent FROM jsonb_array_elements(coalesce(diff#>ARRAY['after',array_name],'[]'::jsonb)) x WHERE x->>key_name=row_json->>key_name;
 IF op.id IS NULL OR old_intent IS DISTINCT FROM old_json OR (CASE WHEN TG_OP='DELETE' THEN new_intent IS NOT NULL ELSE new_intent IS DISTINCT FROM row_json END) THEN
 RAISE EXCEPTION 'Historical child requires complete engagement seal' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
 END $$;
--> statement-breakpoint
CREATE FUNCTION imbc_records_operation_complete() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ DECLARE actual jsonb; diff jsonb; expected_count int; actual_count int;
 BEGIN
 actual=imbc_records_snapshot(NEW.record_kind,NEW.record_id,NEW.profile_id,NEW.organization_id);
 SELECT e.diff INTO diff FROM audit_entries e WHERE id=NEW.audit_entry_id;
 SELECT jsonb_array_length(coalesce(diff#>'{before,sources}','[]'::jsonb))+jsonb_array_length(coalesce(diff#>'{after,sources}','[]'::jsonb))
 +jsonb_array_length(coalesce(diff#>'{before,eoiEvents}','[]'::jsonb))+jsonb_array_length(coalesce(diff#>'{after,eoiEvents}','[]'::jsonb)) INTO expected_count;
 SELECT count(*) INTO actual_count FROM imbc_records_operation_child WHERE operation_id=NEW.id;
 IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text OR imbc_records_hash(actual) IS DISTINCT FROM NEW.after_record_hash
 OR expected_count IS DISTINCT FROM actual_count THEN
 RAISE EXCEPTION 'IMBC commit differs from complete sealed snapshot' USING ERRCODE='23514'; END IF; RETURN NULL;
 END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER imbc_records_operation_complete AFTER INSERT ON imbc_records_operation
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION imbc_records_operation_complete();
--> statement-breakpoint
CREATE FUNCTION imbc_records_append_only() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN RAISE EXCEPTION 'IMBC history is append only' USING ERRCODE='23514'; END $$;

--> statement-breakpoint
CREATE TRIGGER a_imbc_note_guard BEFORE INSERT OR UPDATE OR DELETE ON imbc_note FOR EACH ROW EXECUTE FUNCTION imbc_records_row_guard();

--> statement-breakpoint
CREATE TRIGGER a_imbc_engagement_guard BEFORE INSERT OR UPDATE OR DELETE ON imbc_engagement FOR EACH ROW EXECUTE FUNCTION imbc_records_row_guard();

--> statement-breakpoint
CREATE TRIGGER a_imbc_product_context_guard BEFORE INSERT OR UPDATE OR DELETE ON imbc_product_context FOR EACH ROW EXECUTE FUNCTION imbc_records_row_guard();

--> statement-breakpoint
CREATE TRIGGER a_imbc_eoi_email_event_guard BEFORE INSERT OR UPDATE OR DELETE ON imbc_eoi_email_event FOR EACH ROW EXECUTE FUNCTION imbc_records_engagement_child_guard();

--> statement-breakpoint
CREATE TRIGGER a_imbc_engagement_source_guard BEFORE INSERT OR UPDATE OR DELETE ON imbc_engagement_source FOR EACH ROW EXECUTE FUNCTION imbc_records_engagement_child_guard();

--> statement-breakpoint
CREATE TRIGGER imbc_records_operation_immutable BEFORE UPDATE OR DELETE ON imbc_records_operation FOR EACH ROW EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_records_operation_child_immutable BEFORE UPDATE OR DELETE ON imbc_records_operation_child FOR EACH ROW EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_note_no_truncate BEFORE TRUNCATE ON imbc_note FOR EACH STATEMENT EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_engagement_no_truncate BEFORE TRUNCATE ON imbc_engagement FOR EACH STATEMENT EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_product_context_no_truncate BEFORE TRUNCATE ON imbc_product_context FOR EACH STATEMENT EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_eoi_email_event_no_truncate BEFORE TRUNCATE ON imbc_eoi_email_event FOR EACH STATEMENT EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_engagement_source_no_truncate BEFORE TRUNCATE ON imbc_engagement_source FOR EACH STATEMENT EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_records_operation_no_truncate BEFORE TRUNCATE ON imbc_records_operation FOR EACH STATEMENT EXECUTE FUNCTION imbc_records_append_only();

--> statement-breakpoint
CREATE TRIGGER imbc_records_operation_child_no_truncate BEFORE TRUNCATE ON imbc_records_operation_child FOR EACH STATEMENT EXECUTE FUNCTION imbc_records_append_only();

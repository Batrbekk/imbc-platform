CREATE TABLE "e_ondiris_record" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"bin" text NOT NULL,
	"registration_number" text NOT NULL,
	"legal_name" text,
	"place_name" text,
	"production_address" text,
	"website" text,
	"phone" text,
	"email" text,
	"product_name" text,
	"production_capacity" text,
	"tn_ved_code" text,
	"kpved_code" text,
	"kpved_name" text,
	"enstru_code" text,
	"enstru_name" text,
	"in_country_value_share" numeric(5, 2),
	"included_on" date,
	"active" boolean,
	"content_hash" text NOT NULL,
	"pulled_at" timestamp with time zone NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	CONSTRAINT "e_ondiris_record_bin_ck" CHECK ("e_ondiris_record"."bin" ~ '^[0-9]{12}$'),
	CONSTRAINT "e_ondiris_record_registration_ck" CHECK ("e_ondiris_record"."registration_number" ~ '^[0-9]+$'),
	CONSTRAINT "e_ondiris_record_tn_ved_ck" CHECK ("e_ondiris_record"."tn_ved_code" IS NULL OR "e_ondiris_record"."tn_ved_code" ~ '^[0-9]{10}$'),
	CONSTRAINT "e_ondiris_record_dvc_ck" CHECK ("e_ondiris_record"."in_country_value_share" IS NULL OR "e_ondiris_record"."in_country_value_share" BETWEEN 0 AND 100),
	CONSTRAINT "e_ondiris_record_hash_ck" CHECK ("e_ondiris_record"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "e_ondiris_sync_scope" (
	"bin" text PRIMARY KEY NOT NULL,
	"accepted_observed_at" timestamp with time zone NOT NULL,
	"accepted_scope_hash" text NOT NULL,
	"provenance" text NOT NULL,
	CONSTRAINT "e_ondiris_sync_scope_bin_ck" CHECK ("e_ondiris_sync_scope"."bin" ~ '^[0-9]{12}$'),
	CONSTRAINT "e_ondiris_sync_scope_hash_ck" CHECK ("e_ondiris_sync_scope"."accepted_scope_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "e_ondiris_sync_scope_provenance_ck" CHECK ("e_ondiris_sync_scope"."provenance" IN ('synthetic', 'recorded', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "e_ondiris_profile_refresh" (
	"bin" text PRIMARY KEY NOT NULL,
	"requested_observed_at" timestamp with time zone NOT NULL,
	"requested_scope_hash" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"applied_observed_at" timestamp with time zone,
	"applied_scope_hash" text,
	"target_revision_id" uuid,
	CONSTRAINT "e_ondiris_profile_refresh_state_ck" CHECK ("e_ondiris_profile_refresh"."state" IN ('pending','applied','deferred','ambiguous','no_profile')),
	CONSTRAINT "e_ondiris_profile_refresh_attempt_ck" CHECK ("e_ondiris_profile_refresh"."attempt_count" >= 0),
	CONSTRAINT "e_ondiris_profile_refresh_requested_hash_ck" CHECK ("e_ondiris_profile_refresh"."requested_scope_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "e_ondiris_profile_refresh_applied_hash_ck" CHECK ("e_ondiris_profile_refresh"."applied_scope_hash" IS NULL OR "e_ondiris_profile_refresh"."applied_scope_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "e_ondiris_profile_refresh_applied_pair_ck" CHECK (("e_ondiris_profile_refresh"."applied_observed_at" IS NULL) = ("e_ondiris_profile_refresh"."applied_scope_hash" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "product_line" DROP CONSTRAINT "product_line_source_snapshot_reserved_ck";--> statement-breakpoint
ALTER TABLE "e_ondiris_profile_refresh" ADD CONSTRAINT "e_ondiris_profile_refresh_bin_e_ondiris_sync_scope_bin_fk" FOREIGN KEY ("bin") REFERENCES "public"."e_ondiris_sync_scope"("bin") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "e_ondiris_profile_refresh" ADD CONSTRAINT "e_ondiris_profile_refresh_target_revision_id_section_revision_id_fk" FOREIGN KEY ("target_revision_id") REFERENCES "public"."section_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "e_ondiris_record_version_uq" ON "e_ondiris_record" USING btree ("bin","registration_number","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "e_ondiris_record_current_uq" ON "e_ondiris_record" USING btree ("bin","registration_number") WHERE "e_ondiris_record"."is_current";--> statement-breakpoint
CREATE INDEX "e_ondiris_record_bin_idx" ON "e_ondiris_record" USING btree ("bin");--> statement-breakpoint
CREATE INDEX "e_ondiris_profile_refresh_pending_idx" ON "e_ondiris_profile_refresh" USING btree ("state","last_attempt_at");--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_e_ondiris_snapshot_fk" FOREIGN KEY ("e_ondiris_record_id") REFERENCES "public"."e_ondiris_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_line" ADD CONSTRAINT "product_line_e_ondiris_source_ck" CHECK ("product_line"."e_ondiris_record_id" is null or "product_line"."source" = 'e_ondiris');
--> statement-breakpoint
-- The only mutable source-record column is the synchronization pointer. Frozen FK readers retain facts.
CREATE FUNCTION guard_e_ondiris_record_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'is_current') = (to_jsonb(OLD) - 'is_current') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'e-Ondiris source snapshots are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER e_ondiris_record_immutable BEFORE UPDATE OR DELETE ON e_ondiris_record
  FOR EACH ROW EXECUTE FUNCTION guard_e_ondiris_record_immutable();
CREATE TRIGGER e_ondiris_record_no_truncate BEFORE TRUNCATE ON e_ondiris_record
  FOR EACH STATEMENT EXECUTE FUNCTION guard_e_ondiris_record_immutable();

--> statement-breakpoint
-- Source COW retains prior working versions as immutable history, without sending or publishing them.
ALTER TABLE section_revision DROP CONSTRAINT section_revision_metadata_ck;
ALTER TABLE section_revision ADD CONSTRAINT section_revision_metadata_ck CHECK (revision_number>0 AND edit_version>=0 AND completeness_percent BETWEEN 0 AND 100 AND state IN ('working','submitted','verified','rejected','superseded'));


--> statement-breakpoint
-- A profile-created event queues only an already accepted local scope, atomically in the creation transaction.
-- No second connection/profile lock, source call, quota debit or worker loop occurs inside API onboarding.
CREATE FUNCTION queue_created_profile_e_ondiris_refresh() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_bin text;
BEGIN
  SELECT bin INTO profile_bin FROM organizations WHERE id=NEW.organization_id;
  IF profile_bin IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('e-ondiris:bin:' || profile_bin,0));
  INSERT INTO e_ondiris_profile_refresh(bin,requested_observed_at,requested_scope_hash)
    SELECT bin,accepted_observed_at,accepted_scope_hash FROM e_ondiris_sync_scope WHERE bin=profile_bin
    ON CONFLICT(bin) DO UPDATE SET requested_observed_at=EXCLUDED.requested_observed_at,
      requested_scope_hash=EXCLUDED.requested_scope_hash,state='pending',last_attempt_at=NULL;
  RETURN NEW;
END;
$$;
CREATE TRIGGER manufacturer_profile_e_ondiris_created AFTER INSERT ON manufacturer_profile
  FOR EACH ROW EXECUTE FUNCTION queue_created_profile_e_ondiris_refresh();


--> statement-breakpoint
CREATE FUNCTION guard_product_e_ondiris_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snapshot e_ondiris_record%ROWTYPE; owner_bin text;
BEGIN
  IF NEW.e_ondiris_record_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO snapshot FROM e_ondiris_record WHERE id=NEW.e_ondiris_record_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'e-Ondiris snapshot missing' USING ERRCODE='23503'; END IF;
  SELECT bin INTO owner_bin FROM organizations WHERE id=NEW.organization_id FOR SHARE;
  IF NEW.source<>'e_ondiris' OR owner_bin IS DISTINCT FROM snapshot.bin OR
    NEW.unified_register_registration_number IS DISTINCT FROM snapshot.registration_number OR
    NEW.name_en IS NOT NULL OR NEW.name_ru IS DISTINCT FROM snapshot.product_name OR
    NEW.tn_ved_code IS DISTINCT FROM snapshot.tn_ved_code OR
    NEW.capacity_quantity IS NOT NULL OR NEW.capacity_unit_id IS NOT NULL OR
    NEW.capacity_text IS DISTINCT FROM snapshot.production_capacity OR
    NEW.in_country_value_share IS DISTINCT FROM snapshot.in_country_value_share OR
    NEW.enstru_code IS DISTINCT FROM snapshot.enstru_code OR NEW.enstru_name IS DISTINCT FROM snapshot.enstru_name OR
    NEW.unified_register_active IS DISTINCT FROM snapshot.active OR NEW.unified_register_included_on IS DISTINCT FROM snapshot.included_on THEN
    RAISE EXCEPTION 'e-Ondiris snapshot binding mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_line_e_ondiris_binding BEFORE INSERT OR UPDATE ON product_line FOR EACH ROW EXECUTE FUNCTION guard_product_e_ondiris_binding();
CREATE FUNCTION guard_organization_e_ondiris_bin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bin IS DISTINCT FROM OLD.bin AND EXISTS (
    SELECT 1 FROM product_line p JOIN e_ondiris_record r ON r.id=p.e_ondiris_record_id
    WHERE p.organization_id=OLD.id AND r.bin IS DISTINCT FROM NEW.bin
  ) THEN RAISE EXCEPTION 'linked source BIN is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_e_ondiris_bin BEFORE UPDATE OF bin ON organizations FOR EACH ROW EXECUTE FUNCTION guard_organization_e_ondiris_bin();

-- Materialization/copy is parent-first; validate exact source classifications at COMMIT, after child rows exist.
CREATE FUNCTION validate_product_e_ondiris_classifications(line_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE line product_line%ROWTYPE; snapshot e_ondiris_record%ROWTYPE; n integer;
BEGIN
  SELECT * INTO line FROM product_line WHERE id=line_id;
  IF NOT FOUND OR line.e_ondiris_record_id IS NULL THEN RETURN; END IF;
  SELECT * INTO snapshot FROM e_ondiris_record WHERE id=line.e_ondiris_record_id;
  IF line.tn_ved_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM dictionary_entry e JOIN dictionary d ON d.id=e.dictionary_id
    WHERE e.id=line.tn_ved_entry_id AND d.code='tn_ved' AND e.code=snapshot.tn_ved_code
  ) THEN RAISE EXCEPTION 'source TN VED reference mismatch' USING ERRCODE='23514'; END IF;
  SELECT count(*) INTO n FROM product_line_kpved WHERE product_line_id=line.id;
  IF (snapshot.kpved_code IS NULL AND n<>0) OR (snapshot.kpved_code IS NOT NULL AND (n<>1 OR NOT EXISTS (
    SELECT 1 FROM product_line_kpved k WHERE k.product_line_id=line.id AND k.code=snapshot.kpved_code
      AND k.source_name IS NOT DISTINCT FROM snapshot.kpved_name
      AND (k.kpved_entry_id IS NULL OR EXISTS (SELECT 1 FROM dictionary_entry e JOIN dictionary d ON d.id=e.dictionary_id
        WHERE e.id=k.kpved_entry_id AND d.code='kpved' AND e.code=snapshot.kpved_code))
  ))) THEN RAISE EXCEPTION 'source KP VED classification mismatch' USING ERRCODE='23514'; END IF;
END;
$$;
CREATE FUNCTION product_e_ondiris_classifications_constraint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='product_line' THEN PERFORM validate_product_e_ondiris_classifications(NEW.id);
  ELSIF TG_OP='DELETE' THEN PERFORM validate_product_e_ondiris_classifications(OLD.product_line_id);
  ELSE
    PERFORM validate_product_e_ondiris_classifications(NEW.product_line_id);
    IF TG_OP='UPDATE' AND OLD.product_line_id IS DISTINCT FROM NEW.product_line_id THEN
      PERFORM validate_product_e_ondiris_classifications(OLD.product_line_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER product_line_source_classifications AFTER INSERT OR UPDATE ON product_line
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_e_ondiris_classifications_constraint();
CREATE CONSTRAINT TRIGGER product_line_kpved_source_classifications AFTER INSERT OR UPDATE OR DELETE ON product_line_kpved
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION product_e_ondiris_classifications_constraint();

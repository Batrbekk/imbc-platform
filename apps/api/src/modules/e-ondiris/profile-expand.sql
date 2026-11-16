-- Integration fragment for migration 0024, after source storage-expand.sql. No live execution.
CREATE TABLE e_ondiris_profile_refresh (
  bin text PRIMARY KEY REFERENCES e_ondiris_sync_scope(bin),
  requested_observed_at timestamptz NOT NULL,
  requested_scope_hash text NOT NULL CONSTRAINT e_ondiris_profile_refresh_requested_hash_ck CHECK (requested_scope_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CONSTRAINT e_ondiris_profile_refresh_state_ck CHECK (state IN ('pending','applied','deferred','ambiguous','no_profile')),
  attempt_count integer NOT NULL DEFAULT 0 CONSTRAINT e_ondiris_profile_refresh_attempt_ck CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  applied_observed_at timestamptz,
  applied_scope_hash text CONSTRAINT e_ondiris_profile_refresh_applied_hash_ck CHECK (applied_scope_hash IS NULL OR applied_scope_hash ~ '^[0-9a-f]{64}$'),
  target_revision_id uuid REFERENCES section_revision(id),
  CONSTRAINT e_ondiris_profile_refresh_applied_pair_ck CHECK ((applied_observed_at IS NULL) = (applied_scope_hash IS NULL))
);
CREATE INDEX e_ondiris_profile_refresh_pending_idx ON e_ondiris_profile_refresh(state,last_attempt_at);

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

-- Keep historical nullable registry references; do not invent an upstream snapshot for old frozen rows.
ALTER TABLE product_line DROP CONSTRAINT product_line_source_snapshot_reserved_ck;
ALTER TABLE product_line ADD CONSTRAINT product_line_e_ondiris_snapshot_fk FOREIGN KEY(e_ondiris_record_id) REFERENCES e_ondiris_record(id);
ALTER TABLE product_line ADD CONSTRAINT product_line_e_ondiris_source_ck CHECK (e_ondiris_record_id IS NULL OR source='e_ondiris');

-- Source COW retains prior working versions as immutable history, without sending or publishing them.
ALTER TABLE section_revision DROP CONSTRAINT section_revision_metadata_ck;
ALTER TABLE section_revision ADD CONSTRAINT section_revision_metadata_ck CHECK (revision_number>0 AND edit_version>=0 AND completeness_percent BETWEEN 0 AND 100 AND state IN ('working','submitted','verified','rejected','superseded'));

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

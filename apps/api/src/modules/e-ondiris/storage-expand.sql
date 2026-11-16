-- Integration fragment only: no migration journal entry and never run against the live VM by this agent.
CREATE TABLE e_ondiris_record (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  bin text NOT NULL CONSTRAINT e_ondiris_record_bin_ck CHECK (bin ~ '^[0-9]{12}$'),
  registration_number text NOT NULL CONSTRAINT e_ondiris_record_registration_ck CHECK (registration_number ~ '^[0-9]+$'),
  legal_name text, place_name text, production_address text, website text, phone text, email text,
  product_name text, production_capacity text,
  tn_ved_code text CONSTRAINT e_ondiris_record_tn_ved_ck CHECK (tn_ved_code IS NULL OR tn_ved_code ~ '^[0-9]{10}$'),
  kpved_code text, kpved_name text, enstru_code text, enstru_name text,
  in_country_value_share numeric(5,2) CONSTRAINT e_ondiris_record_dvc_ck CHECK (in_country_value_share IS NULL OR in_country_value_share BETWEEN 0 AND 100),
  included_on date, active boolean,
  content_hash text NOT NULL CONSTRAINT e_ondiris_record_hash_ck CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  pulled_at timestamptz NOT NULL,
  is_current boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX e_ondiris_record_version_uq ON e_ondiris_record(bin, registration_number, content_hash);
CREATE UNIQUE INDEX e_ondiris_record_current_uq ON e_ondiris_record(bin, registration_number) WHERE is_current;
CREATE INDEX e_ondiris_record_bin_idx ON e_ondiris_record(bin);
CREATE TABLE e_ondiris_sync_scope (
  bin text PRIMARY KEY CONSTRAINT e_ondiris_sync_scope_bin_ck CHECK (bin ~ '^[0-9]{12}$'),
  accepted_observed_at timestamptz NOT NULL,
  accepted_scope_hash text NOT NULL CONSTRAINT e_ondiris_sync_scope_hash_ck CHECK (accepted_scope_hash ~ '^[0-9a-f]{64}$'),
  provenance text NOT NULL CONSTRAINT e_ondiris_sync_scope_provenance_ck CHECK (provenance IN ('synthetic', 'recorded', 'provider'))
);

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

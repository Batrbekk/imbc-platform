ALTER TABLE "file_object" ADD COLUMN "purge_requested_at" timestamp with time zone;
--> statement-breakpoint
-- Every direct, composite, or version-number FK is interpreted from PostgreSQL's own column mapping.
CREATE FUNCTION file_binding_target_ids(p_relation oid, p_row jsonb) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE fk record; found_ids uuid[]; all_ids uuid[] := '{}'::uuid[];
BEGIN
  FOR fk IN
    SELECT c.oid, c.confrelid, rn.nspname AS ref_schema, r.relname AS ref_table,
           sn.nspname AS owner_schema, s.relname AS owner_table,
           string_agg(format('r.%I = n.%I', ra.attname, sa.attname), ' AND ' ORDER BY k.ordinality) AS matches
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class s ON s.oid=c.conrelid
    JOIN pg_catalog.pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_catalog.pg_class r ON r.oid=c.confrelid
    JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(local_num,ref_num,ordinality)
    JOIN pg_catalog.pg_attribute sa ON sa.attrelid=c.conrelid AND sa.attnum=k.local_num
    JOIN pg_catalog.pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=k.ref_num
    WHERE c.contype='f' AND c.conrelid=p_relation
      AND c.confrelid IN ('public.file_object'::regclass,'public.file_version'::regclass)
    GROUP BY c.oid,c.confrelid,rn.nspname,r.relname,sn.nspname,s.relname
  LOOP
    EXECUTE format('SELECT coalesce(array_agg(DISTINCT %s), ''{}''::uuid[]) FROM %I.%I r
      CROSS JOIN LATERAL jsonb_populate_record(NULL::%I.%I,$1) n WHERE %s',
      CASE WHEN fk.confrelid='public.file_object'::regclass THEN 'r.id' ELSE 'r.file_object_id' END,
      fk.ref_schema,fk.ref_table,fk.owner_schema,fk.owner_table,fk.matches)
      INTO found_ids USING p_row;
    all_ids := all_ids || found_ids;
  END LOOP;
  RETURN coalesce((SELECT array_agg(DISTINCT id ORDER BY id) FROM unnest(all_ids) id),'{}'::uuid[]);
END $$;
--> statement-breakpoint
CREATE FUNCTION file_binding_not_purging() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_ids uuid[]; after_ids uuid[];
BEGIN
  before_ids := public.file_binding_target_ids(TG_RELID,to_jsonb(NEW));
  -- Same parent lock order as Save/capture/scanning; a FK to a version also serializes on its file object.
  PERFORM id FROM public.file_object WHERE id=ANY(before_ids) ORDER BY id FOR SHARE;
  IF EXISTS (SELECT 1 FROM public.file_object WHERE id=ANY(before_ids) AND purge_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION 'file claimed for purge cannot be bound' USING ERRCODE='23514', CONSTRAINT='file_binding_not_purging';
  END IF;
  -- A version reassigned during the initial resolution must not smuggle an unlocked object into this write.
  after_ids := public.file_binding_target_ids(TG_RELID,to_jsonb(NEW));
  IF NOT (after_ids <@ before_ids) THEN
    RAISE EXCEPTION 'file binding changed while locking' USING ERRCODE='23514', CONSTRAINT='file_binding_not_purging';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION install_file_binding_guards() RETURNS void LANGUAGE plpgsql AS $$
DECLARE owner record;
BEGIN
  FOR owner IN
    SELECT DISTINCT n.nspname, r.relname FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
    WHERE c.contype='f' AND c.confrelid IN ('public.file_object'::regclass,'public.file_version'::regclass)
    ORDER BY n.nspname,r.relname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS file_binding_not_purging ON %I.%I',owner.nspname,owner.relname);
    EXECUTE format('CREATE TRIGGER file_binding_not_purging BEFORE INSERT OR UPDATE ON %I.%I
      FOR EACH ROW EXECUTE FUNCTION public.file_binding_not_purging()',owner.nspname,owner.relname);
  END LOOP;
END $$;
--> statement-breakpoint
SELECT install_file_binding_guards();
--> statement-breakpoint
CREATE FUNCTION file_has_references(p_file uuid) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE fk record; referenced boolean;
BEGIN
  FOR fk IN
    SELECT c.oid, c.confrelid, rn.nspname AS ref_schema, r.relname AS ref_table,
           sn.nspname AS owner_schema, s.relname AS owner_table,
           string_agg(format('r.%I = o.%I', ra.attname, sa.attname), ' AND ' ORDER BY k.ordinality) AS matches
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class s ON s.oid=c.conrelid
    JOIN pg_catalog.pg_namespace sn ON sn.oid=s.relnamespace
    JOIN pg_catalog.pg_class r ON r.oid=c.confrelid
    JOIN pg_catalog.pg_namespace rn ON rn.oid=r.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(local_num,ref_num,ordinality)
    JOIN pg_catalog.pg_attribute sa ON sa.attrelid=c.conrelid AND sa.attnum=k.local_num
    JOIN pg_catalog.pg_attribute ra ON ra.attrelid=c.confrelid AND ra.attnum=k.ref_num
    WHERE c.contype='f' AND c.confrelid IN ('public.file_object'::regclass,'public.file_version'::regclass)
      AND NOT (c.conrelid='public.file_version'::regclass AND c.confrelid='public.file_object'::regclass)
    GROUP BY c.oid,c.confrelid,rn.nspname,r.relname,sn.nspname,s.relname
    ORDER BY sn.nspname,s.relname,c.oid
  LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I o JOIN %I.%I r ON %s WHERE %s=$1)',
      fk.owner_schema,fk.owner_table,fk.ref_schema,fk.ref_table,fk.matches,
      CASE WHEN fk.confrelid='public.file_object'::regclass THEN 'r.id' ELSE 'r.file_object_id' END)
      INTO referenced USING p_file;
    IF referenced THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
--> statement-breakpoint
CREATE FUNCTION file_purge_claim_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.purge_requested_at IS NOT NULL AND NEW.purge_requested_at IS DISTINCT FROM OLD.purge_requested_at THEN
    RAISE EXCEPTION 'file purge claim cannot be changed' USING ERRCODE='23514', CONSTRAINT='file_purge_claim_immutable';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER file_purge_claim_immutable BEFORE UPDATE OF purge_requested_at ON file_object
FOR EACH ROW EXECUTE FUNCTION file_purge_claim_immutable();

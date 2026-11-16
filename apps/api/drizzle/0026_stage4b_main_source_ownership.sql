CREATE TABLE "adata_main_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"bin" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"legal" jsonb NOT NULL,
	"phones" text[] NOT NULL,
	"emails" text[] NOT NULL,
	CONSTRAINT "adata_main_snapshot_bin_ck" CHECK ("adata_main_snapshot"."bin" ~ '^[0-9]{12}$'),
	CONSTRAINT "adata_main_snapshot_hash_ck" CHECK ("adata_main_snapshot"."content_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "main_contact_ownership" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"main_information_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"field" text NOT NULL,
	"owner" text NOT NULL,
	"value" text,
	"adata_snapshot_id" uuid,
	"e_ondiris_record_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	CONSTRAINT "main_contact_ownership_field_ck" CHECK ("main_contact_ownership"."field" IN ('companyPhone','contactEmail')),
	CONSTRAINT "main_contact_ownership_owner_ck" CHECK ("main_contact_ownership"."owner" IN ('unclaimed','legacy_unknown','manufacturer','adata','e_ondiris')),
	CONSTRAINT "main_contact_ownership_source_ck" CHECK (
    ("main_contact_ownership"."owner"='adata' AND "main_contact_ownership"."adata_snapshot_id" IS NOT NULL AND cardinality("main_contact_ownership"."e_ondiris_record_ids")=0 AND "main_contact_ownership"."value" IS NOT NULL)
    OR ("main_contact_ownership"."owner"='e_ondiris' AND "main_contact_ownership"."adata_snapshot_id" IS NULL AND cardinality("main_contact_ownership"."e_ondiris_record_ids")>0 AND "main_contact_ownership"."value" IS NOT NULL)
    OR ("main_contact_ownership"."owner" IN ('manufacturer','legacy_unknown') AND "main_contact_ownership"."adata_snapshot_id" IS NULL AND cardinality("main_contact_ownership"."e_ondiris_record_ids")=0)
    OR ("main_contact_ownership"."owner"='unclaimed' AND "main_contact_ownership"."value" IS NULL AND "main_contact_ownership"."adata_snapshot_id" IS NULL AND cardinality("main_contact_ownership"."e_ondiris_record_ids")=0))
);
--> statement-breakpoint
CREATE TABLE "main_site_ownership" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"main_information_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"address_owner" text NOT NULL,
	"city_owner" text NOT NULL,
	"region_owner" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "main_site_ownership_address_ck" CHECK ("main_site_ownership"."address_owner" IN ('unclaimed','legacy_unknown','manufacturer','e_ondiris')),
	CONSTRAINT "main_site_ownership_city_ck" CHECK ("main_site_ownership"."city_owner" IN ('unclaimed','legacy_unknown','manufacturer')),
	CONSTRAINT "main_site_ownership_region_ck" CHECK ("main_site_ownership"."region_owner" IN ('unclaimed','legacy_unknown','manufacturer'))
);
--> statement-breakpoint
CREATE TABLE "main_site_source_binding" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"main_information_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"registration_number" text NOT NULL,
	"identity_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	CONSTRAINT "main_site_source_binding_registration_ck" CHECK ("main_site_source_binding"."registration_number" ~ '^[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "main_source_pin" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"main_information_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"adata_snapshot_id" uuid,
	"latest_attempt_id" uuid,
	"latest_attempt_completed_at" timestamp with time zone,
	"adata_state" text NOT NULL,
	"e_ondiris_observed_at" timestamp with time zone,
	"e_ondiris_scope_hash" text,
	CONSTRAINT "main_source_pin_state_ck" CHECK ("main_source_pin"."adata_state" IN ('not_requested','waiting','received','not_configured','quota_exhausted','unavailable')),
	CONSTRAINT "main_source_pin_eo_pair_ck" CHECK (("main_source_pin"."e_ondiris_observed_at" IS NULL) = ("main_source_pin"."e_ondiris_scope_hash" IS NULL)),
	CONSTRAINT "main_source_pin_eo_hash_ck" CHECK ("main_source_pin"."e_ondiris_scope_hash" IS NULL OR "main_source_pin"."e_ondiris_scope_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "main_source_refresh_outbox" (
	"profile_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_attempt_id" uuid NOT NULL,
	"requested_completed_at" timestamp with time zone NOT NULL,
	"requested_state" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"applied_attempt_id" uuid,
	"applied_completed_at" timestamp with time zone,
	"applied_state" text,
	"target_revision_id" uuid,
	CONSTRAINT "main_source_refresh_outbox_state_ck" CHECK ("main_source_refresh_outbox"."state" IN ('pending','applied','deferred')),
	CONSTRAINT "main_source_refresh_outbox_attempt_ck" CHECK ("main_source_refresh_outbox"."attempt_count" >= 0),
	CONSTRAINT "main_source_refresh_outbox_requested_state_ck" CHECK ("main_source_refresh_outbox"."requested_state" IN ('received','unavailable','not_configured','quota_exhausted')),
	CONSTRAINT "main_source_refresh_outbox_applied_state_ck" CHECK ("main_source_refresh_outbox"."applied_state" IS NULL OR "main_source_refresh_outbox"."applied_state" IN ('received','unavailable','not_configured','quota_exhausted')),
	CONSTRAINT "main_source_refresh_outbox_applied_pair_ck" CHECK (("main_source_refresh_outbox"."applied_attempt_id" IS NULL)=("main_source_refresh_outbox"."applied_completed_at" IS NULL) AND ("main_source_refresh_outbox"."applied_attempt_id" IS NULL)=("main_source_refresh_outbox"."applied_state" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "adata_main_snapshot_id_org_uq" ON "adata_main_snapshot" USING btree ("id","organization_id");
--> statement-breakpoint
ALTER TABLE "adata_main_snapshot" ADD CONSTRAINT "adata_main_snapshot_attempt_id_external_check_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."external_check_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adata_main_snapshot" ADD CONSTRAINT "adata_main_snapshot_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_contact_ownership" ADD CONSTRAINT "main_contact_ownership_main_org_fk" FOREIGN KEY ("main_information_id","organization_id") REFERENCES "public"."main_information"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_contact_ownership" ADD CONSTRAINT "main_contact_ownership_adata_org_fk" FOREIGN KEY ("adata_snapshot_id","organization_id") REFERENCES "public"."adata_main_snapshot"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_site_ownership" ADD CONSTRAINT "main_site_ownership_main_org_fk" FOREIGN KEY ("main_information_id","organization_id") REFERENCES "public"."main_information"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_site_ownership" ADD CONSTRAINT "main_site_ownership_identity_org_fk" FOREIGN KEY ("identity_id","organization_id") REFERENCES "public"."production_site_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_site_source_binding" ADD CONSTRAINT "main_site_source_binding_snapshot_id_e_ondiris_record_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."e_ondiris_record"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_site_source_binding" ADD CONSTRAINT "main_site_source_binding_main_org_fk" FOREIGN KEY ("main_information_id","organization_id") REFERENCES "public"."main_information"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_site_source_binding" ADD CONSTRAINT "main_site_source_binding_identity_org_fk" FOREIGN KEY ("identity_id","organization_id") REFERENCES "public"."production_site_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_pin" ADD CONSTRAINT "main_source_pin_latest_attempt_id_external_check_attempt_id_fk" FOREIGN KEY ("latest_attempt_id") REFERENCES "public"."external_check_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_pin" ADD CONSTRAINT "main_source_pin_main_org_fk" FOREIGN KEY ("main_information_id","organization_id") REFERENCES "public"."main_information"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_pin" ADD CONSTRAINT "main_source_pin_adata_org_fk" FOREIGN KEY ("adata_snapshot_id","organization_id") REFERENCES "public"."adata_main_snapshot"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_refresh_outbox" ADD CONSTRAINT "main_source_refresh_outbox_profile_id_manufacturer_profile_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."manufacturer_profile"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_refresh_outbox" ADD CONSTRAINT "main_source_refresh_outbox_requested_attempt_id_external_check_attempt_id_fk" FOREIGN KEY ("requested_attempt_id") REFERENCES "public"."external_check_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_refresh_outbox" ADD CONSTRAINT "main_source_refresh_outbox_applied_attempt_id_external_check_attempt_id_fk" FOREIGN KEY ("applied_attempt_id") REFERENCES "public"."external_check_attempt"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_refresh_outbox" ADD CONSTRAINT "main_source_refresh_outbox_target_revision_id_section_revision_id_fk" FOREIGN KEY ("target_revision_id") REFERENCES "public"."section_revision"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_source_refresh_outbox" ADD CONSTRAINT "main_source_refresh_outbox_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "adata_main_snapshot_attempt_uq" ON "adata_main_snapshot" USING btree ("attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "main_contact_ownership_field_uq" ON "main_contact_ownership" USING btree ("main_information_id","field");--> statement-breakpoint
CREATE UNIQUE INDEX "main_site_ownership_identity_uq" ON "main_site_ownership" USING btree ("main_information_id","identity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "main_site_source_binding_registration_uq" ON "main_site_source_binding" USING btree ("main_information_id","registration_number");--> statement-breakpoint
CREATE UNIQUE INDEX "main_source_pin_main_uq" ON "main_source_pin" USING btree ("main_information_id");--> statement-breakpoint
CREATE INDEX "main_source_refresh_outbox_pending_idx" ON "main_source_refresh_outbox" USING btree ("state","last_attempt_at");
--> statement-breakpoint
-- Below is the additional guard fragment to append to canonical generated 0026 DDL.
-- All pre-0026 values have unknown field ownership. This adds technical provenance without guessing a source or changing facts.
INSERT INTO main_contact_ownership(main_information_id,organization_id,field,owner,value)
  SELECT id,organization_id,'companyPhone','legacy_unknown',company_phone FROM main_information
  UNION ALL SELECT id,organization_id,'contactEmail','legacy_unknown',contact_email FROM main_information;
INSERT INTO main_site_ownership(main_information_id,organization_id,identity_id,address_owner,city_owner,region_owner)
  SELECT main_information_id,organization_id,identity_id,'legacy_unknown','legacy_unknown','legacy_unknown' FROM production_site;
CREATE FUNCTION stage4b_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE receipt external_check_attempt%ROWTYPE; expected_profile uuid; expected_org uuid; expected_bin text; scalar_key text; item jsonb;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Main Adata source snapshot is immutable' USING ERRCODE='23514'; END IF;
  SELECT * INTO receipt FROM external_check_attempt WHERE id=NEW.attempt_id;
  SELECT c.profile_id,c.organization_id,o.bin INTO expected_profile,expected_org,expected_bin
    FROM external_check c JOIN organizations o ON o.id=c.organization_id WHERE c.id=receipt.external_check_id AND c.connector='adata';
  IF NOT FOUND OR receipt.state<>'received' OR receipt.completed_at IS NULL OR NEW.observed_at IS DISTINCT FROM receipt.completed_at
    OR NEW.bin IS DISTINCT FROM receipt.bin OR NEW.bin IS DISTINCT FROM expected_bin OR NEW.profile_id IS DISTINCT FROM expected_profile OR NEW.organization_id IS DISTINCT FROM expected_org THEN
    RAISE EXCEPTION 'Main Adata source receipt binding mismatch' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(receipt.value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Main Adata source identity packet type mismatch' USING ERRCODE='23514'; END IF;
  IF receipt.value#>'{basic,biin}' IS NULL OR receipt.value#>'{basic,biin}'='null'::jsonb THEN
    IF EXISTS(SELECT 1 FROM jsonb_each(receipt.value) field WHERE field.value<>'null'::jsonb) OR NEW.legal IS DISTINCT FROM '{"legalName":null,"legalForm":null,"directorFullName":null,"stateRegisteredOn":null,"legalAddress":null,"founders":[],"oked":[]}'::jsonb OR cardinality(NEW.phones)<>0 OR cardinality(NEW.emails)<>0 THEN
      RAISE EXCEPTION 'Main Adata facts have no verified source identity' USING ERRCODE='23514';
    END IF;
  ELSIF jsonb_typeof(receipt.value#>'{basic,biin}') IS DISTINCT FROM 'string' OR receipt.value#>>'{basic,biin}' IS DISTINCT FROM NEW.bin THEN
    RAISE EXCEPTION 'Main Adata returned identity mismatch' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(NEW.legal)<>'object' OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(NEW.legal) key)
    IS DISTINCT FROM ARRAY['directorFullName','founders','legalAddress','legalForm','legalName','oked','stateRegisteredOn']::text[] THEN
    RAISE EXCEPTION 'Main Adata source field inventory mismatch' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(NEW.legal->'founders')<>'array' OR jsonb_typeof(NEW.legal->'oked')<>'array' THEN
    RAISE EXCEPTION 'Main Adata legal lists must be arrays' USING ERRCODE='23514';
  END IF;
  FOREACH scalar_key IN ARRAY ARRAY['legalName','legalForm','directorFullName','stateRegisteredOn','legalAddress'] LOOP
    IF jsonb_typeof(NEW.legal->scalar_key) NOT IN ('string','null') THEN RAISE EXCEPTION 'Main legal scalar source type mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.legal->'founders') LOOP
    IF jsonb_typeof(item)<>'string' THEN RAISE EXCEPTION 'Main founder source type mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.legal->'oked') LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(item) k) IS DISTINCT FROM ARRAY['code','name']::text[]
      OR jsonb_typeof(item->'code')<>'string' OR jsonb_typeof(item->'name') NOT IN ('string','null') THEN
      RAISE EXCEPTION 'Main OKED source field inventory mismatch' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER adata_main_snapshot_guard BEFORE INSERT OR UPDATE OR DELETE ON adata_main_snapshot FOR EACH ROW EXECUTE FUNCTION stage4b_snapshot_guard();

CREATE TRIGGER main_source_pin_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON main_source_pin FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent','main_information','main_information_id','main_information');
CREATE TRIGGER main_contact_ownership_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON main_contact_ownership FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent','main_information','main_information_id','main_information');
CREATE TRIGGER main_site_ownership_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON main_site_ownership FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent','main_information','main_information_id','main_information');
CREATE TRIGGER main_site_source_binding_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON main_site_source_binding FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent','main_information','main_information_id','main_information');

CREATE FUNCTION stage4b_validate_main(p_main uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE m main_information%ROWTYPE; pin main_source_pin%ROWTYPE; src adata_main_snapshot%ROWTYPE; c main_contact_ownership%ROWTYPE;
  owner_profile uuid; owner_bin text; actual jsonb; binding record; raw_value text; normalized text; n integer;
BEGIN
  SELECT * INTO m FROM main_information WHERE id=p_main;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT s.profile_id,o.bin INTO owner_profile,owner_bin FROM section_revision r JOIN profile_section s ON s.id=r.profile_section_id JOIN organizations o ON o.id=r.organization_id WHERE r.id=m.section_revision_id;
  SELECT * INTO pin FROM main_source_pin WHERE main_information_id=m.id;
  IF pin.latest_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM external_check_attempt a JOIN external_check check_row ON check_row.id=a.external_check_id WHERE a.id=pin.latest_attempt_id AND check_row.profile_id=owner_profile AND check_row.organization_id=m.organization_id AND check_row.connector='adata' AND a.bin=owner_bin) THEN
    RAISE EXCEPTION 'Main latest source receipt scope mismatch' USING ERRCODE='23514';
  END IF;
  IF pin.adata_snapshot_id IS NOT NULL THEN
    SELECT * INTO src FROM adata_main_snapshot WHERE id=pin.adata_snapshot_id;
    IF src.profile_id IS DISTINCT FROM owner_profile OR src.bin IS DISTINCT FROM owner_bin OR src.organization_id IS DISTINCT FROM m.organization_id
      OR m.legal_name IS DISTINCT FROM src.legal->>'legalName' OR m.legal_form_source_name IS DISTINCT FROM src.legal->>'legalForm'
      OR m.director_full_name IS DISTINCT FROM src.legal->>'directorFullName' OR m.state_registered_on::text IS DISTINCT FROM src.legal->>'stateRegisteredOn'
      OR m.legal_address IS DISTINCT FROM src.legal->>'legalAddress' OR m.legal_data_checked_at IS DISTINCT FROM src.observed_at THEN
      RAISE EXCEPTION 'Main legal facts differ from their immutable source' USING ERRCODE='23514';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'name',source_name) ORDER BY position),'[]'::jsonb) INTO actual FROM main_information_oked WHERE main_information_id=m.id;
    IF actual IS DISTINCT FROM src.legal->'oked' THEN RAISE EXCEPTION 'Main full OKED differs from its source' USING ERRCODE='23514'; END IF;
    SELECT coalesce(jsonb_agg(name ORDER BY position_in_list),'[]'::jsonb) INTO actual FROM company_founder WHERE main_information_id=m.id;
    IF actual IS DISTINCT FROM src.legal->'founders' THEN RAISE EXCEPTION 'Main founders differ from their source' USING ERRCODE='23514'; END IF;
  END IF;
  FOR c IN SELECT * FROM main_contact_ownership WHERE main_information_id=m.id LOOP
    IF c.value IS DISTINCT FROM (CASE c.field WHEN 'companyPhone' THEN m.company_phone ELSE m.contact_email END) THEN
      RAISE EXCEPTION 'Main contact ownership differs from canonical value' USING ERRCODE='23514';
    END IF;
    IF c.owner='adata' THEN
      SELECT * INTO src FROM adata_main_snapshot WHERE id=c.adata_snapshot_id;
      IF src.profile_id IS DISTINCT FROM owner_profile OR src.bin IS DISTINCT FROM owner_bin OR NOT (c.value=ANY(CASE c.field WHEN 'companyPhone' THEN src.phones ELSE src.emails END)) THEN
        RAISE EXCEPTION 'Main contact differs from its Adata source' USING ERRCODE='23514';
      END IF;
    ELSIF c.owner='e_ondiris' THEN
      SELECT count(*) INTO n FROM e_ondiris_record WHERE id=ANY(c.e_ondiris_record_ids) AND e_ondiris_record.bin=owner_bin;
      IF n<>cardinality(c.e_ondiris_record_ids) THEN RAISE EXCEPTION 'Main contact e-Ondiris source scope mismatch' USING ERRCODE='23514'; END IF;
      FOR raw_value IN SELECT CASE c.field WHEN 'companyPhone' THEN phone ELSE email END FROM e_ondiris_record WHERE id=ANY(c.e_ondiris_record_ids) LOOP
        normalized := CASE c.field WHEN 'contactEmail' THEN lower(btrim(raw_value)) ELSE '+' || regexp_replace(regexp_replace(btrim(raw_value),'^(\+|00)','',''), '[ ().-]','','g') END;
        IF normalized IS DISTINCT FROM c.value THEN RAISE EXCEPTION 'Main contact differs from its e-Ondiris source' USING ERRCODE='23514'; END IF;
      END LOOP;
    END IF;
  END LOOP;
  FOR binding IN SELECT owner.*,site.address,site.id AS site_id FROM main_site_ownership owner LEFT JOIN production_site site ON site.main_information_id=owner.main_information_id AND site.identity_id=owner.identity_id WHERE owner.main_information_id=m.id LOOP
    IF binding.deleted=(binding.site_id IS NOT NULL) THEN RAISE EXCEPTION 'Main site deletion provenance mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  FOR binding IN SELECT b.*,owner.address_owner,owner.deleted,site.address,s.bin AS source_bin,s.registration_number AS source_registration,s.production_address FROM main_site_source_binding b
    LEFT JOIN main_site_ownership owner ON owner.main_information_id=b.main_information_id AND owner.identity_id=b.identity_id
    LEFT JOIN production_site site ON site.main_information_id=b.main_information_id AND site.identity_id=b.identity_id
    JOIN e_ondiris_record s ON s.id=b.snapshot_id WHERE b.main_information_id=m.id LOOP
    IF binding.address_owner IS NULL OR binding.source_bin IS DISTINCT FROM owner_bin OR binding.source_registration IS DISTINCT FROM binding.registration_number
      OR (NOT binding.deleted AND binding.address_owner='e_ondiris' AND binding.address IS DISTINCT FROM binding.production_address) THEN
      RAISE EXCEPTION 'Main source site registration/provenance mismatch' USING ERRCODE='23514';
    END IF;
  END LOOP;
END $$;
-- Site events validate only their current identity/registration. Main/pin events still
-- validate the complete final graph, without rescanning every site for every site row.
CREATE FUNCTION stage4b_validate_site(p_main uuid,p_identity uuid,p_registration text DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE owner_profile uuid; owner_bin text; owner main_site_ownership%ROWTYPE; site production_site%ROWTYPE; binding record;
BEGIN
  SELECT sec.profile_id,o.bin INTO owner_profile,owner_bin FROM main_information m JOIN section_revision r ON r.id=m.section_revision_id JOIN profile_section sec ON sec.id=r.profile_section_id JOIN organizations o ON o.id=m.organization_id WHERE m.id=p_main;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO owner FROM main_site_ownership WHERE main_information_id=p_main AND identity_id=p_identity;
  SELECT * INTO site FROM production_site WHERE main_information_id=p_main AND identity_id=p_identity;
  IF owner.id IS NOT NULL AND owner.deleted=(site.id IS NOT NULL) THEN RAISE EXCEPTION 'Main site deletion provenance mismatch' USING ERRCODE='23514'; END IF;
  FOR binding IN SELECT b.*,s.bin AS source_bin,s.registration_number AS source_registration,s.production_address FROM main_site_source_binding b JOIN e_ondiris_record s ON s.id=b.snapshot_id
    WHERE b.main_information_id=p_main AND b.identity_id=p_identity AND (p_registration IS NULL OR b.registration_number=p_registration) LOOP
    IF owner.id IS NULL OR binding.source_bin IS DISTINCT FROM owner_bin OR binding.source_registration IS DISTINCT FROM binding.registration_number
      OR (NOT owner.deleted AND owner.address_owner='e_ondiris' AND site.address IS DISTINCT FROM binding.production_address) THEN
      RAISE EXCEPTION 'Main source site registration/provenance mismatch' USING ERRCODE='23514';
    END IF;
  END LOOP;
END $$;
CREATE FUNCTION stage4b_main_constraint() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; old_main uuid; old_identity uuid; new_main uuid; new_identity uuid;
BEGIN
  IF TG_TABLE_NAME IN ('production_site','main_site_ownership','main_site_source_binding') THEN
    IF TG_OP<>'INSERT' THEN
      item:=to_jsonb(OLD); old_main:=(item->>'main_information_id')::uuid; old_identity:=(item->>'identity_id')::uuid;
      PERFORM stage4b_validate_site(old_main,old_identity,CASE WHEN TG_TABLE_NAME='main_site_source_binding' THEN item->>'registration_number' ELSE NULL END);
    END IF;
    IF TG_OP<>'DELETE' THEN
      item:=to_jsonb(NEW); new_main:=(item->>'main_information_id')::uuid; new_identity:=(item->>'identity_id')::uuid;
      IF TG_OP='INSERT' OR (new_main,new_identity) IS DISTINCT FROM (old_main,old_identity) OR TG_TABLE_NAME='main_site_source_binding' THEN
        PERFORM stage4b_validate_site(new_main,new_identity,CASE WHEN TG_TABLE_NAME='main_site_source_binding' THEN item->>'registration_number' ELSE NULL END);
      END IF;
    END IF;
  ELSE
    IF TG_OP<>'INSERT' THEN item:=to_jsonb(OLD); old_main:=CASE WHEN TG_TABLE_NAME='main_information' THEN (item->>'id')::uuid ELSE (item->>'main_information_id')::uuid END; PERFORM stage4b_validate_main(old_main); END IF;
    IF TG_OP<>'DELETE' THEN item:=to_jsonb(NEW); new_main:=CASE WHEN TG_TABLE_NAME='main_information' THEN (item->>'id')::uuid ELSE (item->>'main_information_id')::uuid END; IF TG_OP='INSERT' OR new_main IS DISTINCT FROM old_main THEN PERFORM stage4b_validate_main(new_main); END IF; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER main_information_source_binding AFTER INSERT OR UPDATE OR DELETE ON main_information DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();
CREATE CONSTRAINT TRIGGER main_oked_source_binding AFTER INSERT OR UPDATE OR DELETE ON main_information_oked DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();
CREATE CONSTRAINT TRIGGER main_founder_source_binding AFTER INSERT OR UPDATE OR DELETE ON company_founder DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();
CREATE CONSTRAINT TRIGGER main_site_content_binding AFTER INSERT OR UPDATE OR DELETE ON production_site DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();
CREATE CONSTRAINT TRIGGER main_pin_source_binding AFTER INSERT OR UPDATE OR DELETE ON main_source_pin DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();
CREATE CONSTRAINT TRIGGER main_contact_source_binding AFTER INSERT OR UPDATE OR DELETE ON main_contact_ownership DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();
CREATE CONSTRAINT TRIGGER main_site_owner_binding AFTER INSERT OR UPDATE OR DELETE ON main_site_ownership DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();
CREATE CONSTRAINT TRIGGER main_site_registry_binding AFTER INSERT OR UPDATE OR DELETE ON main_site_source_binding DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage4b_main_constraint();

CREATE FUNCTION stage4b_outbox_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM external_check_attempt a JOIN external_check c ON c.id=a.external_check_id JOIN organizations o ON o.id=c.organization_id
    WHERE a.id=NEW.requested_attempt_id AND c.profile_id=NEW.profile_id AND c.organization_id=NEW.organization_id AND c.connector='adata' AND a.bin=o.bin) THEN
    RAISE EXCEPTION 'Main source outbox receipt scope mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.applied_attempt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM external_check_attempt a JOIN external_check c ON c.id=a.external_check_id WHERE a.id=NEW.applied_attempt_id AND c.profile_id=NEW.profile_id AND c.organization_id=NEW.organization_id AND c.connector='adata') THEN
    RAISE EXCEPTION 'Main source outbox applied scope mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.target_revision_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM section_revision r JOIN profile_section s ON s.id=r.profile_section_id WHERE r.id=NEW.target_revision_id AND s.profile_id=NEW.profile_id AND r.organization_id=NEW.organization_id AND s.kind='main_information') THEN
    RAISE EXCEPTION 'Main source outbox target scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER main_source_outbox_scope BEFORE INSERT OR UPDATE ON main_source_refresh_outbox FOR EACH ROW EXECUTE FUNCTION stage4b_outbox_scope();

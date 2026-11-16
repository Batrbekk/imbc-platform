-- NFR-06/DATA-01: explicitly migrate only empty working skeleton containers, retaining all legacy rows.
LOCK TABLE profile_sections, section_revisions, contacts, shareholders, product_lines, equipment_items, equipment_product_links, certificates, documents IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts','shareholders','product_lines','equipment_items','equipment_product_links','certificates','documents'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'stage 3: legacy % contains % business rows; an explicit history-preserving converter is required', t, n; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM section_revisions WHERE state <> 'working' OR data <> '{}'::jsonb OR submitted_at IS NOT NULL OR number <> 1;
  IF n <> 0 THEN RAISE EXCEPTION 'stage 3: section_revisions contains % nonempty or frozen records; converter required', n; END IF;
  SELECT count(*) INTO n FROM profile_sections WHERE verified_revision_id IS NOT NULL OR pending_revision_id IS NOT NULL OR completeness_pct <> 0 OR confirmed_at IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'stage 3: profile_sections contains % reviewed or completed records; converter required', n; END IF;
END $$;
--> statement-breakpoint
-- These technical and range constraints do not strengthen draft completeness requirements.
ALTER TABLE manufacturer_profile ADD CONSTRAINT manufacturer_profile_completeness_ck CHECK (completeness_percent BETWEEN 0 AND 100);
ALTER TABLE profile_section ADD CONSTRAINT profile_section_completeness_ck CHECK (completeness_percent BETWEEN 0 AND 100);
ALTER TABLE section_revision ADD CONSTRAINT section_revision_metadata_ck CHECK (revision_number > 0 AND edit_version >= 0 AND completeness_percent BETWEEN 0 AND 100 AND state IN ('working','submitted','verified','rejected'));
--> statement-breakpoint
-- A circular pointer is deferred: freezing and changing pointers belong to one transaction.
ALTER TABLE profile_section ADD CONSTRAINT profile_section_verified_revision_fk FOREIGN KEY (verified_revision_id, id, organization_id) REFERENCES section_revision (id, profile_section_id, organization_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE profile_section ADD CONSTRAINT profile_section_pending_revision_fk FOREIGN KEY (pending_revision_id, id, organization_id) REFERENCES section_revision (id, profile_section_id, organization_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE profile_section ADD CONSTRAINT profile_section_working_revision_fk FOREIGN KEY (working_revision_id, id, organization_id) REFERENCES section_revision (id, profile_section_id, organization_id) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_create_sections(p_profile uuid, p_org uuid, p_origin revision_origin DEFAULT 'manufacturer') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO profile_section (profile_id, organization_id, kind)
    SELECT p_profile, p_org, unnest(enum_range(NULL::section_kind)) ON CONFLICT (profile_id, kind) DO NOTHING;
  INSERT INTO section_revision (profile_section_id, organization_id, revision_number, state, origin, author_id, created_at)
    SELECT s.id, p_org, 1, 'working', p_origin, old_revision.author_id, coalesce(old_revision.created_at, now())
    FROM profile_section s
    LEFT JOIN profile_sections old_section ON old_section.profile_id=p_profile AND old_section.kind::text=CASE WHEN s.kind='main_information' THEN 'main' ELSE s.kind::text END
    LEFT JOIN section_revisions old_revision ON old_revision.id=old_section.working_revision_id AND old_revision.state='working' AND old_revision.data='{}'::jsonb AND old_revision.number=1
    WHERE s.profile_id=p_profile AND NOT EXISTS (SELECT 1 FROM section_revision r WHERE r.profile_section_id=s.id)
    ON CONFLICT (profile_section_id, revision_number) DO NOTHING;
  UPDATE profile_section s SET working_revision_id=r.id
    FROM section_revision r WHERE s.profile_id=p_profile AND r.profile_section_id=s.id AND r.state='working' AND s.working_revision_id IS NULL;
  INSERT INTO main_information (section_revision_id, organization_id)
    SELECT r.id, p_org FROM section_revision r JOIN profile_section s ON s.id=r.profile_section_id
    WHERE s.profile_id=p_profile AND s.kind='main_information' AND r.state='working'
    ON CONFLICT (section_revision_id) DO NOTHING;
END $$;
--> statement-breakpoint
SELECT stage3_create_sections(id, organization_id, 'migration') FROM manufacturer_profile;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_profile_sections_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM stage3_create_sections(NEW.id, NEW.organization_id, 'manufacturer'); RETURN NEW; END $$;
CREATE TRIGGER manufacturer_profile_create_sections AFTER INSERT ON manufacturer_profile FOR EACH ROW EXECUTE FUNCTION stage3_profile_sections_after_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.profile_id IS DISTINCT FROM OLD.profile_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'stage 3: stable identity ownership is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER production_site_identity_immutable BEFORE UPDATE ON production_site_identity FOR EACH ROW EXECUTE FUNCTION stage3_identity_immutable();
--> statement-breakpoint
CREATE TRIGGER product_line_identity_immutable BEFORE UPDATE ON product_line_identity FOR EACH ROW EXECUTE FUNCTION stage3_identity_immutable();
--> statement-breakpoint
CREATE TRIGGER certificate_identity_immutable BEFORE UPDATE ON certificate_identity FOR EACH ROW EXECUTE FUNCTION stage3_identity_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_section_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.profile_id IS DISTINCT FROM OLD.profile_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'stage 3: section ownership and kind are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profile_section_immutable BEFORE UPDATE ON profile_section FOR EACH ROW EXECUTE FUNCTION stage3_section_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_validate_section_pointers(p_section uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s profile_section%ROWTYPE;
BEGIN
  SELECT * INTO s FROM profile_section WHERE id=p_section;
  IF NOT FOUND THEN RETURN; END IF;
  -- A deferred check can be forced early with SET CONSTRAINTS. Keep every pointed revision SHARE-locked
  -- until commit: FK KEY SHARE alone does not prevent a concurrent non-key UPDATE of its state.
  -- UUID order gives all pointer checks the same lock order, and duplicate pointers acquire one lock.
  PERFORM id FROM section_revision
    WHERE id=ANY(ARRAY[s.working_revision_id, s.verified_revision_id, s.pending_revision_id])
    ORDER BY id FOR SHARE;
  IF s.working_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM section_revision WHERE id=s.working_revision_id AND profile_section_id=s.id AND organization_id=s.organization_id AND state='working') THEN
    RAISE EXCEPTION 'stage 3: working pointer does not name a working revision of this section' USING ERRCODE='23514';
  END IF;
  IF s.verified_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM section_revision WHERE id=s.verified_revision_id AND profile_section_id=s.id AND organization_id=s.organization_id AND state='verified') THEN
    RAISE EXCEPTION 'stage 3: verified pointer does not name a verified revision of this section' USING ERRCODE='23514';
  END IF;
  IF s.pending_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM section_revision WHERE id=s.pending_revision_id AND profile_section_id=s.id AND organization_id=s.organization_id AND state='submitted') THEN
    RAISE EXCEPTION 'stage 3: pending pointer does not name a submitted revision of this section' USING ERRCODE='23514';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_pointers_constraint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='profile_section' THEN PERFORM stage3_validate_section_pointers(NEW.id);
  ELSE PERFORM stage3_validate_section_pointers(NEW.profile_section_id); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER profile_section_pointers AFTER INSERT OR UPDATE ON profile_section DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage3_pointers_constraint();
CREATE CONSTRAINT TRIGGER section_revision_pointers AFTER INSERT OR UPDATE ON section_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION stage3_pointers_constraint();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state <> 'working' THEN RAISE EXCEPTION 'stage 3: frozen revision cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.profile_section_id IS DISTINCT FROM OLD.profile_section_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.revision_number IS DISTINCT FROM OLD.revision_number THEN
    RAISE EXCEPTION 'stage 3: revision identity and ownership are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state <> 'working' THEN
    IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR NOT (NEW.state=OLD.state OR (OLD.state='submitted' AND NEW.state IN ('verified','rejected'))) THEN
      RAISE EXCEPTION 'stage 3: frozen revision metadata is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER section_revision_immutable BEFORE UPDATE OR DELETE ON section_revision FOR EACH ROW EXECUTE FUNCTION stage3_revision_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_assert_content_mutable(p_revision uuid, p_org uuid, p_kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r section_revision%ROWTYPE; actual_kind text;
BEGIN
  SELECT * INTO r FROM section_revision WHERE id=p_revision FOR SHARE;
  IF NOT FOUND OR r.organization_id IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'stage 3: content parent tenant mismatch' USING ERRCODE='23503';
  END IF;
  SELECT kind::text INTO actual_kind FROM profile_section WHERE id=r.profile_section_id;
  IF p_kind IS NOT NULL AND actual_kind IS DISTINCT FROM p_kind THEN
    RAISE EXCEPTION 'stage 3: content belongs to a different section kind' USING ERRCODE='23514';
  END IF;
  IF r.state <> 'working' THEN RAISE EXCEPTION 'stage 3: frozen revision content is immutable' USING ERRCODE='23514'; END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stage3_content_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; revision uuid; parent uuid; i integer; n integer; scan scan_state;
BEGIN
  -- Both OLD and NEW matter: reparenting must not extract a row from frozen history.
  n := CASE WHEN TG_OP='UPDATE' THEN 2 ELSE 1 END;
  FOR i IN 1..n LOOP
    item := CASE WHEN TG_OP='DELETE' OR (TG_OP='UPDATE' AND i=1) THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    IF TG_ARGV[0]='direct' THEN revision := (item->>'section_revision_id')::uuid;
    ELSE
      parent := (item->>TG_ARGV[2])::uuid;
      EXECUTE format('SELECT section_revision_id FROM %I WHERE id=$1', TG_ARGV[1]) INTO revision USING parent;
    END IF;
    IF revision IS NULL THEN RAISE EXCEPTION 'stage 3: content parent not found' USING ERRCODE='23503'; END IF;
    PERFORM stage3_assert_content_mutable(revision, (item->>'organization_id')::uuid, NULLIF(TG_ARGV[3],''));
  END LOOP;
  IF TG_TABLE_NAME='revision_file_version' AND TG_OP <> 'DELETE' THEN
    -- Lock the file in the same revision -> file order as submission and replacement.
    PERFORM 1 FROM file_object WHERE id=NEW.file_object_id FOR SHARE;
    SELECT scan_state INTO scan FROM file_version WHERE id=NEW.file_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'stage 3: snapshot version not found' USING ERRCODE='23503'; END IF;
    IF scan <> 'passed' THEN RAISE EXCEPTION 'stage 3: snapshot version is not passed' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
--> statement-breakpoint
CREATE TRIGGER main_information_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON main_information FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'main_information');
--> statement-breakpoint
CREATE TRIGGER contact_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON contact FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'contacts');
--> statement-breakpoint
CREATE TRIGGER personnel_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON personnel FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'personnel');
--> statement-breakpoint
CREATE TRIGGER product_line_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON product_line FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'products');
--> statement-breakpoint
CREATE TRIGGER products_section_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON products_section FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'products');
--> statement-breakpoint
CREATE TRIGGER production_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON production FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'production');
--> statement-breakpoint
CREATE TRIGGER equipment_item_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON equipment_item FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'production');
--> statement-breakpoint
CREATE TRIGGER certificate_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON certificate FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'certificates');
--> statement-breakpoint
CREATE TRIGGER document_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON document FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', 'documents');
--> statement-breakpoint
CREATE TRIGGER submission_requirement_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON submission_requirement FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', '');
--> statement-breakpoint
CREATE TRIGGER revision_file_version_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON revision_file_version FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('direct', '', '', '');
--> statement-breakpoint
CREATE TRIGGER main_information_oked_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON main_information_oked FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'main_information', 'main_information_id', 'main_information');
--> statement-breakpoint
CREATE TRIGGER company_founder_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON company_founder FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'main_information', 'main_information_id', 'main_information');
--> statement-breakpoint
CREATE TRIGGER production_site_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON production_site FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'main_information', 'main_information_id', 'main_information');
--> statement-breakpoint
CREATE TRIGGER personnel_org_chart_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON personnel_org_chart FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'personnel', 'personnel_id', 'personnel');
--> statement-breakpoint
CREATE TRIGGER personnel_cv_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON personnel_cv FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'personnel', 'personnel_id', 'personnel');
--> statement-breakpoint
CREATE TRIGGER product_line_kpved_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON product_line_kpved FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'product_line', 'product_line_id', 'products');
--> statement-breakpoint
CREATE TRIGGER product_line_certificate_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON product_line_certificate FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'product_line', 'product_line_id', 'products');
--> statement-breakpoint
CREATE TRIGGER production_process_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON production_process FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'production', 'production_id', 'production');
--> statement-breakpoint
CREATE TRIGGER production_photo_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON production_photo FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'production', 'production_id', 'production');
--> statement-breakpoint
CREATE TRIGGER equipment_product_line_revision_guard BEFORE INSERT OR UPDATE OR DELETE ON equipment_product_line FOR EACH ROW EXECUTE FUNCTION stage3_content_guard('parent', 'equipment_item', 'equipment_item_id', 'production');

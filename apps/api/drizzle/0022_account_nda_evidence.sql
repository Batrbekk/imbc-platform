CREATE TABLE "nda_acceptance_bridge" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"nda_acceptance_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"nda_version_id" uuid NOT NULL,
	"account_nda_acceptance_id" uuid NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_nda_acceptance" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"nda_version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"ip_address" text NOT NULL,
	CONSTRAINT "account_nda_acceptance_ip_ck" CHECK (nullif(btrim("account_nda_acceptance"."ip_address"), '') is not null)
);
--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD COLUMN "organization_id" uuid;
--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD COLUMN "account_nda_acceptance_id" uuid;
--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD COLUMN "linked_at" timestamp with time zone;
--> statement-breakpoint
CREATE UNIQUE INDEX "nda_acceptance_bridge_legacy_uq" ON "nda_acceptance_bridge" USING btree ("nda_acceptance_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nda_acceptance_bridge_source_uq" ON "nda_acceptance_bridge" USING btree ("account_nda_acceptance_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_nda_acceptance_account_version_uq" ON "account_nda_acceptance" USING btree ("user_account_id","nda_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "account_nda_acceptance_id_org_version_uq" ON "account_nda_acceptance" USING btree ("id","organization_id","nda_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_id_org_uq" ON "user_accounts" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nda_acceptance_id_profile_org_version_uq" ON "nda_acceptance" USING btree ("id","profile_id","organization_id","nda_version_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "nda_acceptance_source_uq" ON "nda_acceptance" USING btree ("account_nda_acceptance_id");
--> statement-breakpoint
ALTER TABLE "nda_acceptance_bridge" ADD CONSTRAINT "nda_acceptance_bridge_legacy_scope_fk" FOREIGN KEY ("nda_acceptance_id","profile_id","organization_id","nda_version_id") REFERENCES "public"."nda_acceptance"("id","profile_id","organization_id","nda_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nda_acceptance_bridge" ADD CONSTRAINT "nda_acceptance_bridge_source_scope_fk" FOREIGN KEY ("account_nda_acceptance_id","organization_id","nda_version_id") REFERENCES "public"."account_nda_acceptance"("id","organization_id","nda_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_nda_acceptance" ADD CONSTRAINT "account_nda_acceptance_nda_version_id_nda_version_id_fk" FOREIGN KEY ("nda_version_id") REFERENCES "public"."nda_version"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "account_nda_acceptance" ADD CONSTRAINT "account_nda_acceptance_account_org_fk" FOREIGN KEY ("user_account_id","organization_id") REFERENCES "public"."user_accounts"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD CONSTRAINT "nda_acceptance_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD CONSTRAINT "nda_acceptance_source_org_version_fk" FOREIGN KEY ("account_nda_acceptance_id","organization_id","nda_version_id") REFERENCES "public"."account_nda_acceptance"("id","organization_id","nda_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nda_acceptance" ADD CONSTRAINT "nda_acceptance_link_ck" CHECK (("nda_acceptance"."account_nda_acceptance_id" is null) = ("nda_acceptance"."linked_at" is null));
--> statement-breakpoint
-- Pending original ticks are authoritative before password/profile time. No current-time substitute.
INSERT INTO account_nda_acceptance(user_account_id,organization_id,nda_version_id,accepted_at,ip_address)
  SELECT a.id,a.organization_id,a.registration_nda_version_id,a.registration_nda_accepted_at,host(a.registration_ip)
  FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
  WHERE a.role='manufacturer' AND o.type='manufacturer' AND a.registration_nda_version_id IS NOT NULL
  ON CONFLICT(user_account_id,nda_version_id) DO NOTHING;
--> statement-breakpoint
UPDATE nda_acceptance n SET organization_id=p.organization_id FROM manufacturer_profile p WHERE p.id=n.profile_id;
--> statement-breakpoint
ALTER TABLE nda_acceptance ALTER COLUMN organization_id SET NOT NULL;
--> statement-breakpoint
-- Only exact legacy consent audit UUID identifies its original actor; audit time is NOT consent time.
WITH actors AS (
  SELECT n.id,min(e.user_id::text)::uuid AS actor_id FROM nda_acceptance n
    JOIN audit_entries e ON e.object_type='nda_acceptance' AND e.object_id=n.id::text
      AND e.action='nda.accepted' AND e.outcome='ok'
    GROUP BY n.id HAVING count(DISTINCT e.user_id)=1 AND bool_and(e.user_id IS NOT NULL)
      AND bool_and(e.organization_id IS NOT DISTINCT FROM n.organization_id)
), facts AS (
  SELECT n.*,a.id AS actor_id FROM nda_acceptance n JOIN actors x ON x.id=n.id
    JOIN user_accounts a ON a.id=x.actor_id AND a.organization_id=n.organization_id AND a.role='manufacturer'
    JOIN organizations o ON o.id=a.organization_id AND o.type='manufacturer'
)
INSERT INTO account_nda_acceptance(user_account_id,organization_id,nda_version_id,accepted_at,ip_address)
  SELECT actor_id,organization_id,nda_version_id,accepted_at,ip_address FROM facts
  ON CONFLICT(user_account_id,nda_version_id) DO NOTHING;
--> statement-breakpoint
WITH actors AS (
  SELECT n.id,min(e.user_id::text)::uuid AS actor_id FROM nda_acceptance n
    JOIN audit_entries e ON e.object_type='nda_acceptance' AND e.object_id=n.id::text
      AND e.action='nda.accepted' AND e.outcome='ok'
    GROUP BY n.id HAVING count(DISTINCT e.user_id)=1 AND bool_and(e.user_id IS NOT NULL)
      AND bool_and(e.organization_id IS NOT DISTINCT FROM n.organization_id)
)
UPDATE nda_acceptance n SET account_nda_acceptance_id=c.id,linked_at=now()
  FROM actors x JOIN account_nda_acceptance c ON c.user_account_id=x.actor_id
  WHERE n.id=x.id AND c.organization_id=n.organization_id AND c.nda_version_id=n.nda_version_id
    AND c.accepted_at=n.accepted_at AND c.ip_address=n.ip_address;
--> statement-breakpoint
CREATE FUNCTION nda_evidence_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'NDA evidence and links are append-only' USING ERRCODE='23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER account_nda_acceptance_immutable BEFORE UPDATE OR DELETE ON account_nda_acceptance
 FOR EACH ROW EXECUTE FUNCTION nda_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER nda_acceptance_immutable BEFORE UPDATE OR DELETE ON nda_acceptance
 FOR EACH ROW EXECUTE FUNCTION nda_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER nda_acceptance_bridge_immutable BEFORE UPDATE OR DELETE ON nda_acceptance_bridge
 FOR EACH ROW EXECUTE FUNCTION nda_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER account_nda_acceptance_no_truncate BEFORE TRUNCATE ON account_nda_acceptance
 FOR EACH STATEMENT EXECUTE FUNCTION nda_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER nda_acceptance_no_truncate BEFORE TRUNCATE ON nda_acceptance
 FOR EACH STATEMENT EXECUTE FUNCTION nda_evidence_append_only();
--> statement-breakpoint
CREATE TRIGGER nda_acceptance_bridge_no_truncate BEFORE TRUNCATE ON nda_acceptance_bridge
 FOR EACH STATEMENT EXECUTE FUNCTION nda_evidence_append_only();
--> statement-breakpoint
CREATE FUNCTION account_nda_acceptance_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM a.id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
    WHERE a.id=NEW.user_account_id AND a.organization_id=NEW.organization_id
      AND a.role='manufacturer' AND o.type='manufacturer' FOR SHARE OF a,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'NDA account is outside manufacturer scope' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_nda_acceptance_scope BEFORE INSERT ON account_nda_acceptance
 FOR EACH ROW EXECUTE FUNCTION account_nda_acceptance_scope_guard();
--> statement-breakpoint
CREATE FUNCTION capture_pending_account_nda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.registration_nda_version_id,NEW.registration_nda_accepted_at,NEW.registration_ip)
    IS NOT DISTINCT FROM ROW(OLD.registration_nda_version_id,OLD.registration_nda_accepted_at,OLD.registration_ip) THEN RETURN NEW; END IF;
  IF NEW.registration_nda_version_id IS NOT NULL THEN
    INSERT INTO account_nda_acceptance(user_account_id,organization_id,nda_version_id,accepted_at,ip_address)
      VALUES(NEW.id,NEW.organization_id,NEW.registration_nda_version_id,NEW.registration_nda_accepted_at,host(NEW.registration_ip))
      ON CONFLICT(user_account_id,nda_version_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER user_accounts_capture_nda AFTER INSERT OR UPDATE ON user_accounts
 FOR EACH ROW EXECUTE FUNCTION capture_pending_account_nda();
--> statement-breakpoint
CREATE FUNCTION nda_acceptance_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_org uuid; source account_nda_acceptance%ROWTYPE; source_id uuid;
BEGIN
  SELECT organization_id INTO profile_org FROM manufacturer_profile WHERE id=NEW.profile_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NDA profile not found' USING ERRCODE='23514'; END IF;
  -- This separate statement runs AFTER a wait for the shared profile parent serialization lock.
  IF NEW.organization_id IS NULL THEN NEW.organization_id:=profile_org; END IF;
  IF NEW.organization_id IS DISTINCT FROM profile_org THEN RAISE EXCEPTION 'NDA profile outside tenant' USING ERRCODE='23514'; END IF;
  IF NEW.account_nda_acceptance_id IS NULL AND NOT EXISTS(SELECT 1 FROM nda_acceptance
    WHERE profile_id=NEW.profile_id AND nda_version_id=NEW.nda_version_id) THEN
    -- R1 insertion knows no canonical column. Attach only its exact pending triplet, never a guessed actor.
    SELECT c.id INTO source_id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
      JOIN account_nda_acceptance c ON c.user_account_id=a.id AND c.organization_id=a.organization_id
      WHERE a.organization_id=profile_org AND a.role='manufacturer' AND o.type='manufacturer'
        AND a.registration_nda_version_id=NEW.nda_version_id AND a.registration_nda_accepted_at=NEW.accepted_at
        AND host(a.registration_ip)=NEW.ip_address AND c.nda_version_id=NEW.nda_version_id
        AND c.accepted_at=NEW.accepted_at AND c.ip_address=NEW.ip_address;
    NEW.account_nda_acceptance_id:=source_id;
  END IF;
  IF NEW.account_nda_acceptance_id IS NOT NULL THEN
    SELECT * INTO source FROM account_nda_acceptance WHERE id=NEW.account_nda_acceptance_id;
    IF NOT FOUND OR source.organization_id IS DISTINCT FROM profile_org OR source.nda_version_id IS DISTINCT FROM NEW.nda_version_id
      OR source.accepted_at IS DISTINCT FROM NEW.accepted_at OR source.ip_address IS DISTINCT FROM NEW.ip_address THEN
      RAISE EXCEPTION 'NDA link differs from its original canonical facts' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM nda_acceptance_bridge WHERE account_nda_acceptance_id=source.id) OR EXISTS(
      SELECT 1 FROM nda_acceptance WHERE account_nda_acceptance_id=source.id
        AND (profile_id IS DISTINCT FROM NEW.profile_id OR nda_version_id IS DISTINCT FROM NEW.nda_version_id)) THEN
      RAISE EXCEPTION 'NDA source already linked' USING ERRCODE='23514';
    END IF;
    NEW.linked_at:=coalesce(NEW.linked_at,now());
  ELSIF NEW.linked_at IS NOT NULL THEN RAISE EXCEPTION 'Unresolved legacy NDA has no linking time' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER nda_acceptance_scope BEFORE INSERT ON nda_acceptance
 FOR EACH ROW EXECUTE FUNCTION nda_acceptance_scope_guard();
--> statement-breakpoint
CREATE FUNCTION nda_acceptance_bridge_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile_org uuid; legacy nda_acceptance%ROWTYPE; source account_nda_acceptance%ROWTYPE;
BEGIN
  SELECT organization_id INTO profile_org FROM manufacturer_profile WHERE id=NEW.profile_id FOR UPDATE;
  IF NOT FOUND OR profile_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'NDA bridge outside tenant' USING ERRCODE='23514'; END IF;
  SELECT * INTO legacy FROM nda_acceptance WHERE id=NEW.nda_acceptance_id;
  IF NOT FOUND OR legacy.profile_id IS DISTINCT FROM NEW.profile_id OR legacy.organization_id IS DISTINCT FROM NEW.organization_id
    OR legacy.nda_version_id IS DISTINCT FROM NEW.nda_version_id OR legacy.account_nda_acceptance_id IS NOT NULL THEN
    RAISE EXCEPTION 'NDA bridge requires an exact unresolved legacy link' USING ERRCODE='23514';
  END IF;
  SELECT * INTO source FROM account_nda_acceptance WHERE id=NEW.account_nda_acceptance_id;
  IF NOT FOUND OR source.organization_id IS DISTINCT FROM NEW.organization_id OR source.nda_version_id IS DISTINCT FROM NEW.nda_version_id THEN
    RAISE EXCEPTION 'NDA bridge source outside tenant or version' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM nda_acceptance WHERE account_nda_acceptance_id=source.id) OR EXISTS(
    SELECT 1 FROM nda_acceptance_bridge WHERE account_nda_acceptance_id=source.id AND nda_acceptance_id IS DISTINCT FROM NEW.nda_acceptance_id) THEN
    RAISE EXCEPTION 'NDA source already linked' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER nda_acceptance_bridge_scope BEFORE INSERT ON nda_acceptance_bridge
 FOR EACH ROW EXECUTE FUNCTION nda_acceptance_bridge_scope_guard();
--> statement-breakpoint
CREATE FUNCTION link_account_nda_acceptances(profile_uuid uuid,account_uuid uuid) RETURNS TABLE(id uuid) LANGUAGE plpgsql AS $$
DECLARE account_org uuid; profile_org uuid; consent account_nda_acceptance%ROWTYPE; legacy nda_acceptance%ROWTYPE;
  created_uuid uuid; bridge_source uuid;
BEGIN
  SELECT a.organization_id INTO account_org FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
    WHERE a.id=account_uuid AND a.role='manufacturer' AND o.type='manufacturer' FOR NO KEY UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'NDA account scope denied' USING ERRCODE='23514'; END IF;
  SELECT organization_id INTO profile_org FROM manufacturer_profile WHERE manufacturer_profile.id=profile_uuid FOR UPDATE;
  IF NOT FOUND OR profile_org IS DISTINCT FROM account_org THEN RAISE EXCEPTION 'NDA profile scope denied' USING ERRCODE='23514'; END IF;
  FOR consent IN SELECT c.* FROM account_nda_acceptance c WHERE c.user_account_id=account_uuid AND c.organization_id=account_org ORDER BY c.nda_version_id LOOP
    SELECT n.* INTO legacy FROM nda_acceptance n WHERE n.profile_id=profile_uuid AND n.nda_version_id=consent.nda_version_id;
    IF NOT FOUND THEN
      INSERT INTO nda_acceptance(profile_id,organization_id,nda_version_id,account_nda_acceptance_id,accepted_at,ip_address,linked_at)
        VALUES(profile_uuid,account_org,consent.nda_version_id,consent.id,consent.accepted_at,consent.ip_address,now()) RETURNING nda_acceptance.id INTO created_uuid;
      id:=created_uuid; RETURN NEXT;
    ELSIF legacy.account_nda_acceptance_id IS NULL THEN
      SELECT b.account_nda_acceptance_id INTO bridge_source FROM nda_acceptance_bridge b WHERE b.nda_acceptance_id=legacy.id;
      IF FOUND AND bridge_source IS DISTINCT FROM consent.id THEN RAISE EXCEPTION 'NDA legacy link has another source' USING ERRCODE='23514'; END IF;
      IF NOT FOUND THEN
        INSERT INTO nda_acceptance_bridge(nda_acceptance_id,profile_id,organization_id,nda_version_id,account_nda_acceptance_id)
          VALUES(legacy.id,profile_uuid,account_org,consent.nda_version_id,consent.id);
        id:=legacy.id; RETURN NEXT;
      END IF;
    ELSIF legacy.account_nda_acceptance_id IS DISTINCT FROM consent.id THEN
      RAISE EXCEPTION 'NDA profile link has another source' USING ERRCODE='23514';
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
-- Read-only operational reconciliation counts; unresolved legacy facts are never upgraded by inference.
CREATE VIEW nda_evidence_migration_report AS SELECT
  (SELECT count(*) FROM account_nda_acceptance) AS canonical_account_acceptances,
  (SELECT count(*) FROM nda_acceptance WHERE account_nda_acceptance_id IS NOT NULL) AS direct_profile_links,
  (SELECT count(*) FROM nda_acceptance WHERE account_nda_acceptance_id IS NULL) AS raw_unresolved_legacy_rows,
  (SELECT count(*) FROM nda_acceptance_bridge) AS bridge_resolved_legacy_rows,
  (SELECT count(*) FROM nda_acceptance n WHERE n.account_nda_acceptance_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM nda_acceptance_bridge b WHERE b.nda_acceptance_id=n.id)) AS effective_unresolved_legacy_rows;

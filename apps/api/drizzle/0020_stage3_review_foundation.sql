CREATE SEQUENCE "public"."profile_review_assignment_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE SEQUENCE "public"."profile_review_decision_order_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;
--> statement-breakpoint
CREATE TABLE "profile_section_candidate" (
	"profile_section_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_assignment_id" uuid NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"accepted_decision_id" uuid
);
--> statement-breakpoint
CREATE TABLE "review_assignment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"assignment_order" bigint DEFAULT 0 NOT NULL,
	"reused_from_assignment_id" uuid,
	"expert_id" uuid,
	"assigned_by" uuid,
	"received_at" timestamp with time zone NOT NULL,
	"assigned_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"closed_by" uuid,
	"close_operation_key" uuid,
	"submitted_by" uuid NOT NULL,
	"accuracy_confirmed_at" timestamp with time zone NOT NULL,
	"submission_mode" text NOT NULL,
	"operation_key" uuid NOT NULL,
	"request_fingerprint" text NOT NULL,
	CONSTRAINT "review_assignment_mode_ck" CHECK ("review_assignment"."submission_mode" in ('initial', 'resubmit', 'verified_changes')),
	CONSTRAINT "review_assignment_fingerprint_ck" CHECK ("review_assignment"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "review_assignment_order_ck" CHECK ("review_assignment"."assignment_order" > 0),
	CONSTRAINT "review_assignment_assigned_ck" CHECK (("review_assignment"."expert_id" is null and "review_assignment"."assigned_at" is null and "review_assignment"."assigned_by" is null)
    or ("review_assignment"."expert_id" is not null and "review_assignment"."assigned_at" is not null and "review_assignment"."assigned_by" is not null)),
	CONSTRAINT "review_assignment_closed_ck" CHECK (("review_assignment"."closed_at" is null and "review_assignment"."close_reason" is null and "review_assignment"."closed_by" is null and "review_assignment"."close_operation_key" is null)
    or ("review_assignment"."closed_at" is not null and "review_assignment"."closed_by" is not null and "review_assignment"."close_reason" is not null and
      (("review_assignment"."close_reason" = 'review_result' and "review_assignment"."close_operation_key" is null)
        or ("review_assignment"."close_reason" = 'manufacturer_unlock' and "review_assignment"."close_operation_key" is not null)))),
	CONSTRAINT "review_assignment_times_ck" CHECK ("review_assignment"."accuracy_confirmed_at" = "review_assignment"."received_at"
    and ("review_assignment"."assigned_at" is null or "review_assignment"."assigned_at" >= "review_assignment"."received_at")
    and ("review_assignment"."closed_at" is null or "review_assignment"."closed_at" >= "review_assignment"."received_at"))
);
--> statement-breakpoint
CREATE TABLE "review_assignment_section" (
	"review_assignment_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_section_id" uuid NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_required" boolean NOT NULL,
	"retained_decision_id" uuid,
	CONSTRAINT "review_assignment_section_review_assignment_id_profile_section_id_pk" PRIMARY KEY("review_assignment_id","profile_section_id"),
	CONSTRAINT "review_assignment_section_retained_ck" CHECK ("review_assignment_section"."review_required" = ("review_assignment_section"."retained_decision_id" is null))
);
--> statement-breakpoint
CREATE TABLE "review_decision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"review_assignment_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"expert_id" uuid NOT NULL,
	"profile_section_id" uuid NOT NULL,
	"subject_revision_id" uuid NOT NULL,
	"section_revision_id" uuid,
	"certificate_id" uuid,
	"document_id" uuid,
	"file_version_id" uuid,
	"file_object_id" uuid,
	"outcome" "record_status" NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone NOT NULL,
	"decision_order" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "review_decision_one_subject_ck" CHECK (num_nonnulls("review_decision"."section_revision_id", "review_decision"."certificate_id", "review_decision"."document_id", "review_decision"."file_version_id") = 1),
	CONSTRAINT "review_decision_section_context_ck" CHECK ("review_decision"."section_revision_id" is null or "review_decision"."section_revision_id" = "review_decision"."subject_revision_id"),
	CONSTRAINT "review_decision_file_context_ck" CHECK (("review_decision"."file_version_id" is null) = ("review_decision"."file_object_id" is null)),
	CONSTRAINT "review_decision_outcome_ck" CHECK ("review_decision"."outcome" in ('verified', 'rejected')),
	CONSTRAINT "review_decision_order_ck" CHECK ("review_decision"."decision_order" > 0),
	CONSTRAINT "review_decision_rejected_comment_ck" CHECK ("review_decision"."outcome" <> 'rejected' or nullif(btrim("review_decision"."comment"), '') is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_order_uq" ON "review_assignment" USING btree ("assignment_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_id_org_uq" ON "review_assignment" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_id_profile_org_uq" ON "review_assignment" USING btree ("id","profile_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_active_uq" ON "review_assignment" USING btree ("profile_id") WHERE "review_assignment"."closed_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_operation_uq" ON "review_assignment" USING btree ("profile_id","operation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_close_operation_uq" ON "review_assignment" USING btree ("profile_id","close_operation_key") WHERE "review_assignment"."close_operation_key" is not null;
--> statement-breakpoint
CREATE INDEX "review_assignment_queue_idx" ON "review_assignment" USING btree ("received_at","id") WHERE "review_assignment"."closed_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "review_assignment_section_context_uq" ON "review_assignment_section" USING btree ("review_assignment_id","profile_section_id","section_revision_id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_decision_order_uq" ON "review_decision" USING btree ("decision_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_decision_id_org_uq" ON "review_decision" USING btree ("id","organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "review_decision_id_subject_org_uq" ON "review_decision" USING btree ("id","section_revision_id","organization_id");
--> statement-breakpoint
CREATE INDEX "review_decision_assignment_time_idx" ON "review_decision" USING btree ("review_assignment_id","decided_at","id");
--> statement-breakpoint
CREATE INDEX "review_decision_section_effective_idx" ON "review_decision" USING btree ("section_revision_id","organization_id","decision_order") WHERE "review_decision"."section_revision_id" is not null;
--> statement-breakpoint
CREATE INDEX "review_decision_certificate_effective_idx" ON "review_decision" USING btree ("certificate_id","organization_id","decision_order") WHERE "review_decision"."certificate_id" is not null;
--> statement-breakpoint
CREATE INDEX "review_decision_document_effective_idx" ON "review_decision" USING btree ("document_id","organization_id","decision_order") WHERE "review_decision"."document_id" is not null;
--> statement-breakpoint
CREATE INDEX "review_decision_file_effective_idx" ON "review_decision" USING btree ("file_version_id","organization_id","decision_order") WHERE "review_decision"."file_version_id" is not null;
--> statement-breakpoint
ALTER TABLE "profile_section_candidate" ADD CONSTRAINT "profile_section_candidate_map_fk" FOREIGN KEY ("review_assignment_id","profile_section_id","section_revision_id","organization_id") REFERENCES "public"."review_assignment_section"("review_assignment_id","profile_section_id","section_revision_id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "profile_section_candidate" ADD CONSTRAINT "profile_section_candidate_accepted_fk" FOREIGN KEY ("accepted_decision_id","section_revision_id","organization_id") REFERENCES "public"."review_decision"("id","section_revision_id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_expert_id_user_accounts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_assigned_by_user_accounts_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_closed_by_user_accounts_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_submitted_by_user_accounts_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment" ADD CONSTRAINT "review_assignment_reused_from_fk" FOREIGN KEY ("reused_from_assignment_id","profile_id","organization_id") REFERENCES "public"."review_assignment"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment_section" ADD CONSTRAINT "review_assignment_section_assignment_fk" FOREIGN KEY ("review_assignment_id","profile_id","organization_id") REFERENCES "public"."review_assignment"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment_section" ADD CONSTRAINT "review_assignment_section_section_org_fk" FOREIGN KEY ("profile_section_id","organization_id") REFERENCES "public"."profile_section"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment_section" ADD CONSTRAINT "review_assignment_section_revision_fk" FOREIGN KEY ("section_revision_id","profile_section_id","organization_id") REFERENCES "public"."section_revision"("id","profile_section_id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_assignment_section" ADD CONSTRAINT "review_assignment_section_retained_fk" FOREIGN KEY ("retained_decision_id","section_revision_id","organization_id") REFERENCES "public"."review_decision"("id","section_revision_id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_expert_id_user_accounts_id_fk" FOREIGN KEY ("expert_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_assignment_org_fk" FOREIGN KEY ("review_assignment_id","organization_id") REFERENCES "public"."review_assignment"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_map_fk" FOREIGN KEY ("review_assignment_id","profile_section_id","subject_revision_id","organization_id") REFERENCES "public"."review_assignment_section"("review_assignment_id","profile_section_id","section_revision_id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_section_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_certificate_org_fk" FOREIGN KEY ("certificate_id","organization_id") REFERENCES "public"."certificate"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_document_org_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."document"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "review_decision" ADD CONSTRAINT "review_decision_version_object_fk" FOREIGN KEY ("file_version_id","file_object_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Canonical expand only. Plural R1 reviews and manufacturer_profiles compatibility view are preserved.
CREATE FUNCTION profile_review_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'review evidence is append-only' USING ERRCODE='23514', CONSTRAINT='profile_review_append_only';
END $$;
--> statement-breakpoint
CREATE TRIGGER review_decision_append_only BEFORE UPDATE OR DELETE ON review_decision
  FOR EACH ROW EXECUTE FUNCTION profile_review_append_only();
CREATE TRIGGER review_assignment_section_append_only BEFORE UPDATE OR DELETE ON review_assignment_section
  FOR EACH ROW EXECUTE FUNCTION profile_review_append_only();
--> statement-breakpoint
CREATE FUNCTION profile_review_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_assignment review_assignment%ROWTYPE; previous_id uuid; assignment_changed boolean;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'review assignment history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.closed_at IS NOT NULL OR
      (to_jsonb(NEW)-ARRAY['expert_id','assigned_by','assigned_at','closed_at','close_reason','closed_by','close_operation_key'])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['expert_id','assigned_by','assigned_at','closed_at','close_reason','closed_by','close_operation_key']) THEN
      RAISE EXCEPTION 'review assignment provenance or closed history is immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.closed_at IS NOT NULL AND (NEW.expert_id IS DISTINCT FROM OLD.expert_id OR
        NEW.assigned_by IS DISTINCT FROM OLD.assigned_by OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at) THEN
      RAISE EXCEPTION 'closing an assignment cannot reassign its expert' USING ERRCODE='23514';
    END IF;
    IF NEW.closed_at IS NOT NULL THEN
      IF NEW.close_reason='manufacturer_unlock' THEN
        PERFORM a.id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
          WHERE a.id=NEW.closed_by AND a.organization_id=NEW.organization_id
            AND a.role='manufacturer' AND a.state='active' AND o.type='manufacturer' FOR SHARE OF a,o;
      ELSE
        PERFORM a.id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
          WHERE a.id=NEW.closed_by AND a.id=OLD.expert_id
            AND a.role='expert' AND a.state='active' AND o.type='imbc' FOR SHARE OF a,o;
      END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'closing actor does not own this operation' USING ERRCODE='23514'; END IF;
    END IF;
  ELSE
    -- Database order and this parent lock select an immediate prior cycle independently of caller dates/UUIDs.
    PERFORM id FROM manufacturer_profile WHERE id=NEW.profile_id AND organization_id=NEW.organization_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'assignment profile is outside this tenant' USING ERRCODE='23514'; END IF;
    NEW.assignment_order := nextval('profile_review_assignment_order_seq');
    IF NEW.closed_at IS NOT NULL THEN RAISE EXCEPTION 'new assignment must be open' USING ERRCODE='23514'; END IF;
    -- Persisted actor scope, not generic user UUID membership. Actor deactivation later never rewrites history.
    PERFORM a.id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
      WHERE a.id=NEW.submitted_by AND a.organization_id=NEW.organization_id
        AND a.role='manufacturer' AND a.state='active' AND o.type='manufacturer' FOR SHARE OF a,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'submit actor does not own this manufacturer tenant' USING ERRCODE='23514'; END IF;
    IF NEW.reused_from_assignment_id IS NOT NULL THEN
      SELECT * INTO source_assignment FROM review_assignment WHERE id=NEW.reused_from_assignment_id
        AND profile_id=NEW.profile_id AND organization_id=NEW.organization_id FOR SHARE;
      IF NOT FOUND OR source_assignment.closed_at IS NULL THEN
        RAISE EXCEPTION 'automatic assignment source must be closed in this exact profile' USING ERRCODE='23514';
      END IF;
      SELECT id INTO previous_id FROM review_assignment WHERE profile_id=NEW.profile_id AND organization_id=NEW.organization_id
        ORDER BY assignment_order DESC LIMIT 1 FOR SHARE;
      IF NEW.reused_from_assignment_id IS DISTINCT FROM previous_id OR NEW.submission_mode='initial'
        OR source_assignment.expert_id IS NULL OR NEW.expert_id IS DISTINCT FROM source_assignment.expert_id
        OR NEW.assigned_by IS DISTINCT FROM source_assignment.assigned_by THEN
        RAISE EXCEPTION 'automatic assignment must preserve the immediate previous expert and provenance' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  assignment_changed := TG_OP='INSERT' OR NEW.expert_id IS DISTINCT FROM OLD.expert_id
    OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at;
  IF NEW.expert_id IS NOT NULL AND assignment_changed THEN
    PERFORM a.id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
      WHERE a.id=NEW.expert_id AND a.role='expert' AND a.state='active' AND o.type='imbc' FOR SHARE OF a,o;
    IF NOT FOUND THEN RAISE EXCEPTION 'review assignee must be an active IMBC expert' USING ERRCODE='23514'; END IF;
    -- Manual/new assignment is by an active IMBC administrator or by this expert taking it personally.
    -- Only a proven INSERT reuse preserves a historical assigned_by account, even if it is now inactive.
    IF NOT (TG_OP='INSERT' AND NEW.reused_from_assignment_id IS NOT NULL) THEN
      PERFORM a.id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
        WHERE a.id=NEW.assigned_by AND a.state='active' AND o.type='imbc'
          AND (a.role='administrator' OR (a.role='expert' AND a.id=NEW.expert_id)) FOR SHARE OF a,o;
      IF NOT FOUND THEN RAISE EXCEPTION 'assignment author must be an active IMBC administrator or the assigned expert' USING ERRCODE='23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_assignment_guard BEFORE INSERT OR UPDATE OR DELETE ON review_assignment
  FOR EACH ROW EXECUTE FUNCTION profile_review_assignment_guard();
--> statement-breakpoint
CREATE FUNCTION profile_review_effective_decision(p_profile uuid, p_org uuid, p_section uuid DEFAULT NULL,
    p_certificate uuid DEFAULT NULL, p_document uuid DEFAULT NULL, p_file uuid DEFAULT NULL) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT d.id FROM review_decision d JOIN review_assignment a ON a.id=d.review_assignment_id AND a.organization_id=d.organization_id
    WHERE a.profile_id=p_profile AND d.organization_id=p_org AND num_nonnulls(p_section,p_certificate,p_document,p_file)=1
      AND (d.section_revision_id=p_section OR d.certificate_id=p_certificate OR d.document_id=p_document OR d.file_version_id=p_file)
    ORDER BY d.decision_order DESC LIMIT 1
$$;
--> statement-breakpoint
CREATE FUNCTION profile_review_effective_section_acceptance(p_decision uuid, p_revision uuid, p_profile uuid, p_org uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(p_decision IS NOT NULL AND p_decision=profile_review_effective_decision(p_profile,p_org,p_revision)
    AND EXISTS (SELECT 1 FROM review_decision WHERE id=p_decision AND outcome='verified'),false)
$$;
--> statement-breakpoint
CREATE FUNCTION profile_review_validate_retained(p_decision uuid, p_revision uuid, p_profile uuid, p_org uuid,
    p_require_closed boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source_assignment review_assignment%ROWTYPE;
BEGIN
  IF p_decision IS NULL THEN RETURN; END IF;
  -- SHARE serializes the validation with a decision insert or close on this source assignment.
  SELECT * INTO source_assignment FROM review_assignment WHERE id=(SELECT review_assignment_id FROM review_decision WHERE id=p_decision)
    AND profile_id=p_profile AND organization_id=p_org FOR SHARE;
  IF NOT FOUND OR (p_require_closed AND source_assignment.closed_at IS NULL) THEN
    RAISE EXCEPTION 'retained decision source must be scoped and closed before reuse' USING ERRCODE='23514';
  END IF;
  -- Separate statement after a possible wait observes the newest DB-ordered append-only outcome.
  IF NOT profile_review_effective_section_acceptance(p_decision,p_revision,p_profile,p_org) THEN
    RAISE EXCEPTION 'retained decision must be the effective verified outcome for this exact subject' USING ERRCODE='23514';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION profile_review_map_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment review_assignment%ROWTYPE;
BEGIN
  -- Serialize map insertion with reassign/close. Closed assignments never gain new context rows.
  SELECT * INTO assignment FROM review_assignment WHERE id=NEW.review_assignment_id FOR UPDATE;
  IF assignment.closed_at IS NOT NULL THEN RAISE EXCEPTION 'closed assignment context is immutable' USING ERRCODE='23514'; END IF;
  PERFORM id FROM profile_section WHERE id=NEW.profile_section_id AND profile_id=NEW.profile_id
    AND organization_id=NEW.organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mapped section does not belong to this exact profile' USING ERRCODE='23514'; END IF;
  PERFORM profile_review_validate_retained(NEW.retained_decision_id,NEW.section_revision_id,NEW.profile_id,NEW.organization_id,true);
  IF NEW.retained_decision_id IS NOT NULL AND EXISTS (SELECT 1 FROM review_decision
      WHERE id=NEW.retained_decision_id AND review_assignment_id=NEW.review_assignment_id) THEN
    RAISE EXCEPTION 'retained decision must come from an earlier assignment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_assignment_section_guard BEFORE INSERT ON review_assignment_section
  FOR EACH ROW EXECUTE FUNCTION profile_review_map_guard();
--> statement-breakpoint
CREATE FUNCTION profile_review_validate_map(p_assignment uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM review_assignment_section WHERE review_assignment_id=p_assignment;
  IF n<>7 THEN RAISE EXCEPTION 'review assignment requires all seven sections' USING ERRCODE='23514', CONSTRAINT='review_assignment_full_map'; END IF;
  -- Lock frozen state through COMMIT even if a caller forces deferred checks early.
  PERFORM r.id FROM section_revision r JOIN review_assignment_section m ON m.section_revision_id=r.id
    WHERE m.review_assignment_id=p_assignment ORDER BY r.id FOR SHARE OF r;
  IF EXISTS (SELECT 1 FROM review_assignment_section m JOIN section_revision r ON r.id=m.section_revision_id
      JOIN profile_section s ON s.id=m.profile_section_id
      WHERE m.review_assignment_id=p_assignment AND
        (r.state='working' OR r.submitted_at IS NULL OR s.profile_id<>m.profile_id OR s.organization_id<>m.organization_id)) THEN
    RAISE EXCEPTION 'review assignment map must contain exact frozen profile revisions' USING ERRCODE='23514', CONSTRAINT='review_assignment_full_map';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION profile_review_map_constraint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='review_assignment' THEN PERFORM profile_review_validate_map(NEW.id);
  ELSE PERFORM profile_review_validate_map(NEW.review_assignment_id); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER review_assignment_full_map AFTER INSERT ON review_assignment
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION profile_review_map_constraint();
CREATE CONSTRAINT TRIGGER review_assignment_section_full_map AFTER INSERT ON review_assignment_section
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION profile_review_map_constraint();
--> statement-breakpoint
CREATE FUNCTION profile_review_decision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment review_assignment%ROWTYPE;
BEGIN
  -- Close/reassignment waits for this decision, and the post-wait read observes its final assignee.
  SELECT * INTO assignment FROM review_assignment WHERE id=NEW.review_assignment_id FOR UPDATE;
  IF assignment.closed_at IS NOT NULL OR assignment.expert_id IS DISTINCT FROM NEW.expert_id THEN
    RAISE EXCEPTION 'decision requires the current open assigned expert' USING ERRCODE='23514';
  END IF;
  IF NEW.decided_at < assignment.received_at THEN RAISE EXCEPTION 'decision predates submission' USING ERRCODE='23514'; END IF;
  PERFORM a.id FROM user_accounts a JOIN organizations o ON o.id=a.organization_id
    WHERE a.id=NEW.expert_id AND a.role='expert' AND a.state='active' AND o.type='imbc' FOR SHARE OF a,o;
  IF NOT FOUND THEN RAISE EXCEPTION 'decision actor must be an active IMBC expert' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM review_assignment_section m JOIN section_revision r ON r.id=m.section_revision_id
      WHERE m.review_assignment_id=NEW.review_assignment_id AND m.profile_section_id=NEW.profile_section_id
        AND m.section_revision_id=NEW.subject_revision_id AND m.organization_id=NEW.organization_id
        AND m.review_required AND r.state<>'working' AND r.submitted_at IS NOT NULL) THEN
    RAISE EXCEPTION 'decision requires this exact changed frozen assignment subject' USING ERRCODE='23514';
  END IF;
  IF NEW.certificate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM certificate
      WHERE id=NEW.certificate_id AND section_revision_id=NEW.subject_revision_id AND organization_id=NEW.organization_id AND NOT not_held) THEN
    RAISE EXCEPTION 'certificate decision is outside exact map or is an ISO absence declaration' USING ERRCODE='23514';
  END IF;
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document
      WHERE id=NEW.document_id AND section_revision_id=NEW.subject_revision_id AND organization_id=NEW.organization_id) THEN
    RAISE EXCEPTION 'document decision is outside exact map' USING ERRCODE='23514';
  END IF;
  IF NEW.file_version_id IS NOT NULL THEN
    PERFORM v.id FROM revision_file_version f JOIN file_version v ON v.id=f.file_version_id AND v.file_object_id=f.file_object_id
      WHERE f.section_revision_id=NEW.subject_revision_id AND f.organization_id=NEW.organization_id
        AND f.file_object_id=NEW.file_object_id AND f.file_version_id=NEW.file_version_id AND v.scan_state='passed' FOR SHARE OF v;
    IF NOT FOUND THEN RAISE EXCEPTION 'file decision must use the exact passed captured version in the map' USING ERRCODE='23514'; END IF;
  END IF;
  -- Never trust supplied decidedAt, UUID order or a caller decision_order for effective latest outcome.
  -- Sequence allocation happens AFTER assignment lock/validation, cache=1, and is globally monotonic.
  NEW.decision_order := nextval('profile_review_decision_order_seq');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER review_decision_guard BEFORE INSERT ON review_decision FOR EACH ROW EXECUTE FUNCTION profile_review_decision_guard();
--> statement-breakpoint
CREATE FUNCTION profile_review_candidate_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_profile uuid;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.profile_section_id IS DISTINCT FROM OLD.profile_section_id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id) THEN
    RAISE EXCEPTION 'candidate section ownership is immutable' USING ERRCODE='23514';
  END IF;
  SELECT profile_id INTO p_profile FROM profile_section WHERE id=NEW.profile_section_id AND organization_id=NEW.organization_id FOR SHARE;
  PERFORM profile_review_validate_retained(NEW.accepted_decision_id,NEW.section_revision_id,p_profile,NEW.organization_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER profile_section_candidate_guard BEFORE INSERT OR UPDATE ON profile_section_candidate
  FOR EACH ROW EXECUTE FUNCTION profile_review_candidate_guard();
--> statement-breakpoint
-- The catalogue-driven purge guard must include new exact file decisions before first production use.
SELECT install_file_binding_guards();

ALTER TABLE "review_assignment_section" DROP CONSTRAINT "review_assignment_section_retained_ck";--> statement-breakpoint
ALTER TABLE "review_assignment_section" ADD COLUMN "retained_from_assignment_id" uuid;--> statement-breakpoint
ALTER TABLE "review_assignment_section" ADD CONSTRAINT "review_assignment_section_retained_from_fk" FOREIGN KEY ("retained_from_assignment_id","profile_id","organization_id") REFERENCES "public"."review_assignment"("id","profile_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_assignment_section" ADD CONSTRAINT "review_assignment_section_retained_ck" CHECK (("review_assignment_section"."review_required" = ("review_assignment_section"."retained_decision_id" is null))
      or ("review_assignment_section"."review_required" and "review_assignment_section"."retained_from_assignment_id" is not null and "review_assignment_section"."retained_decision_id" is not null));
--> statement-breakpoint
-- MAN-43/NOT-29: keep the exact unchanged unlock graph, including rejected and partial decisions.
-- MAN-44's narrower Returned retention remains on the existing verified-only path.
CREATE FUNCTION profile_review_unlock_revision_retained(p_source uuid,p_revision uuid,p_profile uuid,p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM review_assignment a
    JOIN review_assignment_section m ON m.review_assignment_id=a.id AND m.profile_id=a.profile_id AND m.organization_id=a.organization_id
    JOIN section_revision r ON r.id=m.section_revision_id AND r.profile_section_id=m.profile_section_id AND r.organization_id=m.organization_id
    WHERE a.id=p_source AND a.profile_id=p_profile AND a.organization_id=p_org
      AND a.close_reason='manufacturer_unlock' AND a.closed_at IS NOT NULL
      AND m.section_revision_id=p_revision AND r.state<>'working' AND r.submitted_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM revision_file_version f
        JOIN file_version v ON v.id=f.file_version_id AND v.file_object_id=f.file_object_id
        JOIN file_object o ON o.id=f.file_object_id AND o.organization_id=f.organization_id
        WHERE f.section_revision_id=p_revision AND f.organization_id=p_org
          AND (v.scan_state<>'passed' OR o.purge_requested_at IS NOT NULL)))
$$;
--> statement-breakpoint
-- Walk only immutable maps that this exact source inherited. Later assignments and decisions for
-- another assignment cannot replace the historical source result. A source's own final
-- completion takes precedence over the baseline inherited when that source was opened.
CREATE FUNCTION profile_review_unlock_effective_decision(p_source uuid,p_revision uuid,p_profile uuid,p_org uuid,
    p_certificate uuid DEFAULT NULL,p_document uuid DEFAULT NULL,p_file uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  WITH RECURSIVE chain AS (
    SELECT a.id,a.assignment_order,a.received_at,m.profile_section_id,m.retained_decision_id,m.retained_from_assignment_id
    FROM review_assignment a JOIN review_assignment_section m
      ON m.review_assignment_id=a.id AND m.profile_id=a.profile_id AND m.organization_id=a.organization_id
    WHERE a.id=p_source AND a.profile_id=p_profile AND a.organization_id=p_org
      AND a.close_reason='manufacturer_unlock' AND a.closed_at IS NOT NULL AND m.section_revision_id=p_revision
    UNION ALL
    SELECT previous.id,previous.assignment_order,previous.received_at,m.profile_section_id,m.retained_decision_id,m.retained_from_assignment_id
    FROM chain source JOIN review_assignment previous ON previous.id=coalesce(source.retained_from_assignment_id,
      (SELECT review_assignment_id FROM review_decision WHERE id=source.retained_decision_id))
    JOIN review_assignment_section m ON m.review_assignment_id=previous.id AND m.profile_id=previous.profile_id
      AND m.organization_id=previous.organization_id AND m.profile_section_id=source.profile_section_id
    WHERE previous.profile_id=p_profile AND previous.organization_id=p_org AND m.section_revision_id=p_revision
      AND previous.assignment_order<source.assignment_order AND previous.closed_at IS NOT NULL
      AND previous.closed_at<=source.received_at
      AND (source.retained_from_assignment_id IS NULL OR previous.close_reason='manufacturer_unlock')
  )
  SELECT d.id FROM chain a JOIN review_decision d ON d.review_assignment_id=a.id AND d.organization_id=p_org
  WHERE num_nonnulls(p_certificate,p_document,p_file)<=1
    AND ((p_file IS NULL AND d.profile_section_id=a.profile_section_id AND d.subject_revision_id=p_revision
        AND ((num_nonnulls(p_certificate,p_document,p_file)=0 AND d.section_revision_id=p_revision)
          OR d.certificate_id=p_certificate OR d.document_id=p_document))
      -- One decision on an exact file version applies to every section capturing that version.
      -- Its authoring subject is still pinned to this same historical source assignment's map.
      OR (d.file_version_id=p_file AND EXISTS(SELECT 1 FROM revision_file_version f
          WHERE f.section_revision_id=p_revision AND f.organization_id=p_org AND f.file_version_id=p_file)
        AND EXISTS(SELECT 1 FROM review_assignment_section own WHERE own.review_assignment_id=a.id
          AND own.profile_section_id=d.profile_section_id AND own.section_revision_id=d.subject_revision_id
          AND own.profile_id=p_profile AND own.organization_id=p_org)))
  ORDER BY a.assignment_order DESC,d.decision_order DESC LIMIT 1
$$;
--> statement-breakpoint
CREATE FUNCTION profile_review_unlock_retained_decision(p_source uuid,p_revision uuid,p_profile uuid,p_org uuid)
RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT profile_review_unlock_effective_decision(p_source,p_revision,p_profile,p_org)
$$;
--> statement-breakpoint
CREATE FUNCTION profile_review_unlock_needs_review(p_source uuid,p_revision uuid,p_profile uuid,p_org uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE retained uuid; section_outcome text;
BEGIN
  retained=profile_review_unlock_retained_decision(p_source,p_revision,p_profile,p_org);
  IF retained IS NULL THEN RETURN true; END IF;
  SELECT outcome::text INTO section_outcome FROM review_decision WHERE id=retained;
  RETURN EXISTS(SELECT 1 FROM document d WHERE d.section_revision_id=p_revision AND d.organization_id=p_org
      AND NOT EXISTS(SELECT 1 FROM review_decision item WHERE item.id=profile_review_unlock_effective_decision(p_source,p_revision,p_profile,p_org,NULL,d.id,NULL)
        AND (section_outcome='rejected' OR item.outcome='verified')))
    OR EXISTS(SELECT 1 FROM certificate c WHERE c.section_revision_id=p_revision AND c.organization_id=p_org AND NOT c.not_held
      AND NOT EXISTS(SELECT 1 FROM review_decision item WHERE item.id=profile_review_unlock_effective_decision(p_source,p_revision,p_profile,p_org,c.id,NULL,NULL)
        AND (section_outcome='rejected' OR item.outcome='verified')))
    OR (section_outcome='verified' AND EXISTS(SELECT 1 FROM revision_file_version f
      JOIN review_decision item ON item.id=profile_review_unlock_effective_decision(p_source,p_revision,p_profile,p_org,NULL,NULL,f.file_version_id)
      WHERE f.section_revision_id=p_revision AND f.organization_id=p_org AND item.outcome='rejected'));
END $$;
--> statement-breakpoint
-- Historical notifications validate immutable provenance only. New working edits, purge requests or
-- changed scanner state must never rewrite/refuse an already closed result and its old comment.
CREATE FUNCTION profile_review_unlock_retained_provenance(p_current uuid,p_source uuid,p_revision uuid,p_section uuid,
    p_profile uuid,p_org uuid,p_decision uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT EXISTS(SELECT 1 FROM review_assignment current_assignment
    JOIN review_assignment source_assignment ON source_assignment.profile_id=current_assignment.profile_id
      AND source_assignment.organization_id=current_assignment.organization_id
    JOIN review_assignment_section m ON m.review_assignment_id=source_assignment.id
      AND m.profile_id=source_assignment.profile_id AND m.organization_id=source_assignment.organization_id
    JOIN section_revision r ON r.id=m.section_revision_id AND r.profile_section_id=m.profile_section_id
      AND r.organization_id=m.organization_id
    WHERE current_assignment.id=p_current AND current_assignment.profile_id=p_profile AND current_assignment.organization_id=p_org
      AND source_assignment.id=p_source AND source_assignment.close_reason='manufacturer_unlock' AND source_assignment.closed_at IS NOT NULL
      AND source_assignment.assignment_order<current_assignment.assignment_order AND source_assignment.closed_at<=current_assignment.received_at
      AND source_assignment.id=(SELECT id FROM review_assignment WHERE profile_id=p_profile AND organization_id=p_org
        AND assignment_order<current_assignment.assignment_order ORDER BY assignment_order DESC LIMIT 1)
      AND m.profile_section_id=p_section AND m.section_revision_id=p_revision AND r.state<>'working' AND r.submitted_at IS NOT NULL
      AND p_decision IS NOT DISTINCT FROM profile_review_unlock_retained_decision(p_source,p_revision,p_profile,p_org))
$$;
--> statement-breakpoint
CREATE FUNCTION profile_review_validate_unlock_retained(p_current uuid,p_source uuid,p_revision uuid,p_section uuid,
    p_profile uuid,p_org uuid,p_decision uuid,p_review_required boolean)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_assignment review_assignment%ROWTYPE; source_assignment review_assignment%ROWTYPE; expected uuid;
BEGIN
  SELECT * INTO current_assignment FROM review_assignment WHERE id=p_current AND profile_id=p_profile AND organization_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unlock retention requires the current scoped assignment' USING ERRCODE='23514'; END IF;
  SELECT * INTO source_assignment FROM review_assignment WHERE id=p_source AND profile_id=p_profile AND organization_id=p_org FOR SHARE;
  IF NOT FOUND OR source_assignment.close_reason IS DISTINCT FROM 'manufacturer_unlock' OR source_assignment.closed_at IS NULL
    OR source_assignment.assignment_order>=current_assignment.assignment_order OR source_assignment.closed_at>current_assignment.received_at
    OR source_assignment.id IS DISTINCT FROM (SELECT id FROM review_assignment WHERE profile_id=p_profile AND organization_id=p_org
      AND assignment_order<current_assignment.assignment_order ORDER BY assignment_order DESC LIMIT 1) THEN
    RAISE EXCEPTION 'Unlock retention requires the immediately previous closed unlock' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM profile_section_candidate c JOIN profile_section s ON s.id=c.profile_section_id AND s.organization_id=c.organization_id
    WHERE c.profile_section_id=p_section AND c.organization_id=p_org AND s.profile_id=p_profile
      AND c.review_assignment_id=p_source AND c.section_revision_id=p_revision
      AND (s.working_revision_id IS NULL OR s.working_revision_id=p_revision);
  IF NOT FOUND OR NOT profile_review_unlock_revision_retained(p_source,p_revision,p_profile,p_org) THEN
    RAISE EXCEPTION 'Unlock retention requires the exact unchanged frozen candidate' USING ERRCODE='23514';
  END IF;
  expected=profile_review_unlock_retained_decision(p_source,p_revision,p_profile,p_org);
  IF p_decision IS DISTINCT FROM expected
    OR p_review_required IS DISTINCT FROM profile_review_unlock_needs_review(p_source,p_revision,p_profile,p_org)
    OR (p_decision IS NOT NULL AND p_decision IS DISTINCT FROM profile_review_effective_decision(p_profile,p_org,p_revision)) THEN
    RAISE EXCEPTION 'Unlock retention differs from its exact source decisions' USING ERRCODE='23514';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION profile_review_map_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE assignment review_assignment%ROWTYPE;
BEGIN
  SELECT * INTO assignment FROM review_assignment WHERE id=NEW.review_assignment_id FOR UPDATE;
  IF NOT FOUND OR assignment.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Closed or missing assignment context is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM id FROM profile_section WHERE id=NEW.profile_section_id AND profile_id=NEW.profile_id
    AND organization_id=NEW.organization_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mapped section does not belong to this exact profile' USING ERRCODE='23514'; END IF;
  IF NEW.retained_from_assignment_id IS NULL THEN
    PERFORM profile_review_validate_retained(NEW.retained_decision_id,NEW.section_revision_id,NEW.profile_id,NEW.organization_id,true);
  ELSE
    PERFORM profile_review_validate_unlock_retained(NEW.review_assignment_id,NEW.retained_from_assignment_id,NEW.section_revision_id,
      NEW.profile_section_id,NEW.profile_id,NEW.organization_id,NEW.retained_decision_id,NEW.review_required);
  END IF;
  IF NEW.retained_decision_id IS NOT NULL AND EXISTS(SELECT 1 FROM review_decision
      WHERE id=NEW.retained_decision_id AND review_assignment_id=NEW.review_assignment_id) THEN
    RAISE EXCEPTION 'Retained decision must come from an earlier assignment' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

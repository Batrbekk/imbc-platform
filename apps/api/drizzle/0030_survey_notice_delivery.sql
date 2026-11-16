ALTER TABLE "site_survey_notice_outbox" DROP CONSTRAINT "survey_notice_state_ck";--> statement-breakpoint
ALTER TABLE "site_survey_notice_outbox" ADD COLUMN "dispatch_id" uuid;--> statement-breakpoint
ALTER TABLE "site_survey_notice_outbox" ADD COLUMN "notification_job_id" uuid;--> statement-breakpoint
ALTER TABLE "site_survey_notice_outbox" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_survey_notice_outbox" ADD COLUMN "last_outcome" text;--> statement-breakpoint
ALTER TABLE "site_survey_publication_state" ADD COLUMN "last_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_notice_dispatch_uq" ON "site_survey_notice_outbox" USING btree ("dispatch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_notice_job_uq" ON "site_survey_notice_outbox" USING btree ("notification_job_id");--> statement-breakpoint
-- Older queued marks have no durable job/token. Preserve their event and recover them as pending.
UPDATE "site_survey_notice_outbox" SET "state"='pending',"queued_at"=NULL,"last_outcome"='legacy_queue_recovery' WHERE "state"='queued';--> statement-breakpoint
ALTER TABLE "site_survey_notice_outbox" ADD CONSTRAINT "survey_notice_state_ck" CHECK ("site_survey_notice_outbox"."state" in ('pending','queued','completed','obsolete')
    and (("site_survey_notice_outbox"."state" = 'queued') = ("site_survey_notice_outbox"."dispatch_id" is not null))
    and (("site_survey_notice_outbox"."state" = 'queued') = ("site_survey_notice_outbox"."notification_job_id" is not null))
    and (("site_survey_notice_outbox"."state" in ('completed','obsolete')) = ("site_survey_notice_outbox"."resolved_at" is not null))
    and ("site_survey_notice_outbox"."state" <> 'pending' or "site_survey_notice_outbox"."queued_at" is null)
    and ("site_survey_notice_outbox"."state" <> 'queued' or "site_survey_notice_outbox"."queued_at" is not null));--> statement-breakpoint
CREATE FUNCTION site_survey_notice_identity_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
DECLARE publication record;
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT site_surveyed,generation INTO publication FROM site_survey_publication_state
      WHERE profile_id=NEW.profile_id AND organization_id=NEW.organization_id;
    IF NEW.state<>'pending' OR NEW.queued_at IS NOT NULL OR NEW.dispatch_id IS NOT NULL
      OR NEW.notification_job_id IS NOT NULL OR NEW.resolved_at IS NOT NULL OR NOT FOUND
      OR NOT publication.site_surveyed OR publication.generation<>NEW.generation THEN
      RAISE EXCEPTION 'Invalid initial Survey notice' USING ERRCODE='23514';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW.profile_id,NEW.organization_id,NEW.generation,NEW.survey_record_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.profile_id,OLD.organization_id,OLD.generation,OLD.survey_record_id,OLD.created_at)
      OR NEW.attempt_count<OLD.attempt_count
      OR (OLD.state IN ('completed','obsolete') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
      RAISE EXCEPTION 'Survey notice identity or completion is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER site_survey_notice_identity_guard BEFORE INSERT OR UPDATE ON site_survey_notice_outbox
FOR EACH ROW EXECUTE FUNCTION site_survey_notice_identity_guard();--> statement-breakpoint
CREATE FUNCTION site_survey_publication_identity_guard() RETURNS trigger LANGUAGE plpgsql
SET search_path=public,pg_temp AS $$
BEGIN
  IF ROW(NEW.profile_id,NEW.organization_id) IS DISTINCT FROM ROW(OLD.profile_id,OLD.organization_id)
    OR NEW.generation<OLD.generation THEN
    RAISE EXCEPTION 'Survey publication identity and generation cannot rewind' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER site_survey_publication_identity_guard BEFORE UPDATE ON site_survey_publication_state
FOR EACH ROW EXECUTE FUNCTION site_survey_publication_identity_guard();--> statement-breakpoint
-- Runtime has SELECT only on release rules. This parameter-free primitive protects the full predicate,
-- including a newly inserted deny condition, without granting runtime policy-write privileges.
CREATE FUNCTION site_survey_lock_notification_policy() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  LOCK TABLE public.policy_rule,public.notification_rule IN SHARE MODE;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION site_survey_lock_notification_policy() FROM PUBLIC;

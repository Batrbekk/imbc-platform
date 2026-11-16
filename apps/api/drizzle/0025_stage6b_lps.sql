CREATE TABLE "lps_company" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "lps_company_name_ck" CHECK ("lps_company"."name" <> '' and "lps_company"."name" = btrim("lps_company"."name")),
	CONSTRAINT "lps_company_deleted_ck" CHECK (("lps_company"."deleted_at" is null) = ("lps_company"."deleted_by" is null))
);
--> statement-breakpoint
CREATE TABLE "lps_company_country" (
	"lps_company_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	CONSTRAINT "lps_company_country_lps_company_id_country_id_pk" PRIMARY KEY("lps_company_id","country_id")
);
--> statement-breakpoint
CREATE TABLE "lps_contact" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lps_entry_id" uuid NOT NULL,
	"full_name" text,
	"role_title" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lps_contact_name_ck" CHECK ("lps_contact"."full_name" <> '' and "lps_contact"."full_name" = btrim("lps_contact"."full_name")),
	CONSTRAINT "lps_contact_role_ck" CHECK ("lps_contact"."role_title" <> '' and "lps_contact"."role_title" = btrim("lps_contact"."role_title")),
	CONSTRAINT "lps_contact_order_ck" CHECK ("lps_contact"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lps_contact_email" (
	"lps_contact_id" uuid NOT NULL,
	"email" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lps_contact_email_lps_contact_id_email_pk" PRIMARY KEY("lps_contact_id","email"),
	CONSTRAINT "lps_contact_email_ck" CHECK ("lps_contact_email"."email" <> '' and "lps_contact_email"."email" = lower(btrim("lps_contact_email"."email"))),
	CONSTRAINT "lps_contact_email_order_ck" CHECK ("lps_contact_email"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lps_contact_phone" (
	"lps_contact_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lps_contact_phone_lps_contact_id_phone_pk" PRIMARY KEY("lps_contact_id","phone"),
	CONSTRAINT "lps_contact_phone_ck" CHECK ("lps_contact_phone"."phone" ~ '^[+][1-9][0-9]{6,14}( ext[.] [0-9]+)?$'),
	CONSTRAINT "lps_contact_phone_order_ck" CHECK ("lps_contact_phone"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "lps_entry" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lps_company_id" uuid NOT NULL,
	"source_type_id" uuid NOT NULL,
	"scope_description" text NOT NULL,
	"status_id" uuid NOT NULL,
	"planned_launch" text,
	"comment" text,
	"investment_usd" numeric,
	"new_jobs" integer,
	"last_updated_on" date,
	"migration_key" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	CONSTRAINT "lps_entry_scope_ck" CHECK ("lps_entry"."scope_description" <> '' and "lps_entry"."scope_description" = btrim("lps_entry"."scope_description")),
	CONSTRAINT "lps_entry_investment_ck" CHECK ("lps_entry"."investment_usd" >= 0 and "lps_entry"."investment_usd" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
	CONSTRAINT "lps_entry_jobs_ck" CHECK ("lps_entry"."new_jobs" >= 0),
	CONSTRAINT "lps_entry_deleted_ck" CHECK (("lps_entry"."deleted_at" is null) = ("lps_entry"."deleted_by" is null))
);
--> statement-breakpoint
CREATE TABLE "lps_entry_commodity" (
	"lps_entry_id" uuid NOT NULL,
	"commodity_type_id" uuid NOT NULL,
	CONSTRAINT "lps_entry_commodity_lps_entry_id_commodity_type_id_pk" PRIMARY KEY("lps_entry_id","commodity_type_id")
);
--> statement-breakpoint
CREATE TABLE "lps_location" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lps_entry_id" uuid NOT NULL,
	"city" text,
	"region_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "lps_location_pair_uq" UNIQUE NULLS NOT DISTINCT("lps_entry_id","city","region_id"),
	CONSTRAINT "lps_location_place_ck" CHECK ("lps_location"."city" is not null or "lps_location"."region_id" is not null),
	CONSTRAINT "lps_location_city_ck" CHECK ("lps_location"."city" <> '' and "lps_location"."city" = btrim("lps_location"."city")),
	CONSTRAINT "lps_location_order_ck" CHECK ("lps_location"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lps_company" ADD CONSTRAINT "lps_company_created_by_user_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_company" ADD CONSTRAINT "lps_company_updated_by_user_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_company" ADD CONSTRAINT "lps_company_deleted_by_user_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_company_country" ADD CONSTRAINT "lps_company_country_lps_company_id_lps_company_id_fk" FOREIGN KEY ("lps_company_id") REFERENCES "public"."lps_company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_company_country" ADD CONSTRAINT "lps_company_country_country_id_dictionary_entry_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_contact" ADD CONSTRAINT "lps_contact_lps_entry_id_lps_entry_id_fk" FOREIGN KEY ("lps_entry_id") REFERENCES "public"."lps_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_contact_email" ADD CONSTRAINT "lps_contact_email_lps_contact_id_lps_contact_id_fk" FOREIGN KEY ("lps_contact_id") REFERENCES "public"."lps_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_contact_phone" ADD CONSTRAINT "lps_contact_phone_lps_contact_id_lps_contact_id_fk" FOREIGN KEY ("lps_contact_id") REFERENCES "public"."lps_contact"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry" ADD CONSTRAINT "lps_entry_lps_company_id_lps_company_id_fk" FOREIGN KEY ("lps_company_id") REFERENCES "public"."lps_company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry" ADD CONSTRAINT "lps_entry_source_type_id_dictionary_entry_id_fk" FOREIGN KEY ("source_type_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry" ADD CONSTRAINT "lps_entry_status_id_dictionary_entry_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry" ADD CONSTRAINT "lps_entry_created_by_user_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry" ADD CONSTRAINT "lps_entry_updated_by_user_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry" ADD CONSTRAINT "lps_entry_deleted_by_user_accounts_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry_commodity" ADD CONSTRAINT "lps_entry_commodity_lps_entry_id_lps_entry_id_fk" FOREIGN KEY ("lps_entry_id") REFERENCES "public"."lps_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_entry_commodity" ADD CONSTRAINT "lps_entry_commodity_commodity_type_id_dictionary_entry_id_fk" FOREIGN KEY ("commodity_type_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_location" ADD CONSTRAINT "lps_location_lps_entry_id_lps_entry_id_fk" FOREIGN KEY ("lps_entry_id") REFERENCES "public"."lps_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lps_location" ADD CONSTRAINT "lps_location_region_id_dictionary_entry_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."dictionary_entry"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lps_contact_entry_idx" ON "lps_contact" USING btree ("lps_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lps_entry_migration_key_uq" ON "lps_entry" USING btree ("migration_key");--> statement-breakpoint
CREATE INDEX "lps_entry_company_status_idx" ON "lps_entry" USING btree ("lps_company_id","status_id");--> statement-breakpoint
CREATE INDEX "lps_entry_status_idx" ON "lps_entry" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "lps_entry_last_updated_idx" ON "lps_entry" USING btree ("last_updated_on");--> statement-breakpoint
CREATE INDEX "lps_location_entry_idx" ON "lps_location" USING btree ("lps_entry_id");
--> statement-breakpoint
INSERT INTO dictionary(code,name) VALUES('country','country') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
INSERT INTO dictionary(code,name) VALUES('programme','programme') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
INSERT INTO dictionary(code,name) VALUES('lps_status','lps_status') ON CONFLICT(code) DO NOTHING;
--> statement-breakpoint
-- Guards required in migration 0025, independently of HTTP validation.
CREATE FUNCTION lps_write_serialization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock_shared(2146711107,3);
 PERFORM pg_advisory_xact_lock(2146711110,0);
 RETURN NULL;
END $$;
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['lps_company','lps_company_country','lps_entry','lps_entry_commodity','lps_location','lps_contact','lps_contact_email','lps_contact_phone'] LOOP
   EXECUTE format('CREATE TRIGGER lps_write_serialization BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION lps_write_serialization()',relation);
 END LOOP;
END $$;
CREATE FUNCTION lps_assert_reference(reference_id uuid, dictionary_code text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM dictionary_entry e JOIN dictionary d ON d.id=e.dictionary_id
   WHERE e.id=reference_id AND d.code=dictionary_code
     AND (dictionary_code <> 'country' OR e.code ~ '^[A-Z]{2}$')
     AND (dictionary_code <> 'programme' OR e.code IN ('LC','LPS'))
     AND (dictionary_code <> 'commodity_type' OR EXISTS (
       SELECT 1 FROM dictionary_entry p JOIN dictionary pd ON pd.id=p.dictionary_id
       WHERE p.id=e.parent_entry_id AND pd.code='commodity_group' AND p.code IN ('A','B','C','D','E'))))
 THEN RAISE EXCEPTION 'Invalid LPS reference' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION lps_entry_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleted timestamptz; lo integer; hi integer; parts text[];
BEGIN
 IF TG_OP='UPDATE' THEN
   IF OLD.deleted_at IS NOT NULL OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
   THEN RAISE EXCEPTION 'Immutable deleted LPS entry or creation provenance' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT deleted_at INTO deleted FROM lps_company WHERE id=NEW.lps_company_id FOR UPDATE;
 IF NOT FOUND OR deleted IS NOT NULL THEN RAISE EXCEPTION 'LPS company unavailable' USING ERRCODE='23514'; END IF;
 PERFORM lps_assert_reference(NEW.source_type_id,'programme');
 PERFORM lps_assert_reference(NEW.status_id,'lps_status');
 IF TG_OP='UPDATE' AND OLD.migration_key IS NOT NULL AND NEW.migration_key IS DISTINCT FROM OLD.migration_key
 THEN RAISE EXCEPTION 'Immutable LPS migration key' USING ERRCODE='23514'; END IF;
 IF NEW.planned_launch IS NOT NULL AND NEW.planned_launch <> 'TBD' THEN
   IF NEW.planned_launch ~ '^[0-9]{4}$' THEN
     lo := NEW.planned_launch::integer * 4; hi := lo+3;
   ELSE
     parts := regexp_match(NEW.planned_launch, '^Q([1-4]) ([0-9]{4})( / Q([1-4]) ([0-9]{4}))?$');
     IF parts IS NULL THEN RAISE EXCEPTION 'Invalid LPS launch' USING ERRCODE='23514'; END IF;
     lo := parts[2]::integer * 4+parts[1]::integer-1;
     hi := CASE WHEN parts[4] IS NULL THEN lo ELSE parts[5]::integer * 4+parts[4]::integer-1 END;
   END IF;
   IF lo < 4 OR hi < 4 OR hi < lo THEN RAISE EXCEPTION 'Invalid LPS launch range' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lps_entry_guard BEFORE INSERT OR UPDATE ON lps_entry FOR EACH ROW EXECUTE FUNCTION lps_entry_guard();
CREATE FUNCTION lps_company_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.created_by IS DISTINCT FROM OLD.created_by
 THEN RAISE EXCEPTION 'Immutable deleted LPS company or creation provenance' USING ERRCODE='23514'; END IF;
 IF NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM lps_entry WHERE lps_company_id=NEW.id AND deleted_at IS NULL)
 THEN RAISE EXCEPTION 'LPS company has active entries' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lps_company_guard BEFORE UPDATE ON lps_company FOR EACH ROW EXECUTE FUNCTION lps_company_guard();
CREATE FUNCTION lps_child_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent uuid; company uuid; deleted timestamptz; data jsonb;
BEGIN
 data := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME='lps_company_country' THEN
   IF TG_OP='UPDATE' AND OLD.lps_company_id IS DISTINCT FROM NEW.lps_company_id THEN
     RAISE EXCEPTION 'Immutable LPS child parent' USING ERRCODE='23514';
   END IF;
   SELECT deleted_at INTO deleted FROM lps_company WHERE id=(data->>'lps_company_id')::uuid FOR UPDATE;
   IF NOT FOUND OR deleted IS NOT NULL THEN RAISE EXCEPTION 'LPS company unavailable' USING ERRCODE='23514'; END IF;
   IF TG_OP <> 'DELETE' THEN PERFORM lps_assert_reference(NEW.country_id,'country'); END IF;
 ELSE
   IF TG_TABLE_NAME IN ('lps_contact_email','lps_contact_phone') THEN
     IF TG_OP='UPDATE' AND OLD.lps_contact_id IS DISTINCT FROM NEW.lps_contact_id THEN
       RAISE EXCEPTION 'Immutable LPS child parent' USING ERRCODE='23514';
     END IF;
     SELECT lps_entry_id INTO parent FROM lps_contact WHERE id=(data->>'lps_contact_id')::uuid;
   ELSE
     parent := (data->>'lps_entry_id')::uuid;
     IF TG_OP='UPDATE' AND OLD.lps_entry_id IS DISTINCT FROM NEW.lps_entry_id THEN
       RAISE EXCEPTION 'Immutable LPS child parent' USING ERRCODE='23514';
     END IF;
   END IF;
   SELECT lps_company_id INTO company FROM lps_entry WHERE id=parent;
   PERFORM id FROM lps_company WHERE id=company FOR UPDATE;
   SELECT deleted_at INTO deleted FROM lps_entry WHERE id=parent FOR UPDATE;
   IF NOT FOUND OR deleted IS NOT NULL THEN RAISE EXCEPTION 'LPS entry unavailable' USING ERRCODE='23514'; END IF;
   IF TG_TABLE_NAME='lps_entry_commodity' AND TG_OP <> 'DELETE' THEN PERFORM lps_assert_reference(NEW.commodity_type_id,'commodity_type'); END IF;
   IF TG_TABLE_NAME='lps_location' AND TG_OP <> 'DELETE' THEN
     IF NEW.region_id IS NOT NULL THEN PERFORM lps_assert_reference(NEW.region_id,'region'); END IF;
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER lps_country_guard BEFORE INSERT OR UPDATE OR DELETE ON lps_company_country FOR EACH ROW EXECUTE FUNCTION lps_child_guard();
CREATE TRIGGER lps_commodity_guard BEFORE INSERT OR UPDATE OR DELETE ON lps_entry_commodity FOR EACH ROW EXECUTE FUNCTION lps_child_guard();
CREATE TRIGGER lps_location_guard BEFORE INSERT OR UPDATE OR DELETE ON lps_location FOR EACH ROW EXECUTE FUNCTION lps_child_guard();
CREATE TRIGGER lps_contact_guard BEFORE INSERT OR UPDATE OR DELETE ON lps_contact FOR EACH ROW EXECUTE FUNCTION lps_child_guard();
CREATE TRIGGER lps_email_guard BEFORE INSERT OR UPDATE OR DELETE ON lps_contact_email FOR EACH ROW EXECUTE FUNCTION lps_child_guard();
CREATE TRIGGER lps_phone_guard BEFORE INSERT OR UPDATE OR DELETE ON lps_contact_phone FOR EACH ROW EXECUTE FUNCTION lps_child_guard();
CREATE FUNCTION lps_contact_presence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; name text;
BEGIN
 IF TG_TABLE_NAME='lps_contact' THEN target := NEW.id;
 ELSE target := CASE WHEN TG_OP='DELETE' THEN OLD.lps_contact_id ELSE NEW.lps_contact_id END; END IF;
 SELECT full_name INTO name FROM lps_contact WHERE id=target;
 IF FOUND AND name IS NULL AND NOT EXISTS(SELECT 1 FROM lps_contact_email WHERE lps_contact_id=target)
   AND NOT EXISTS(SELECT 1 FROM lps_contact_phone WHERE lps_contact_id=target)
 THEN RAISE EXCEPTION 'LPS contact requires name or method' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lps_contact_presence AFTER INSERT OR UPDATE ON lps_contact DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION lps_contact_presence_guard();
CREATE CONSTRAINT TRIGGER lps_contact_email_presence AFTER INSERT OR UPDATE OR DELETE ON lps_contact_email DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION lps_contact_presence_guard();
CREATE CONSTRAINT TRIGGER lps_contact_phone_presence AFTER INSERT OR UPDATE OR DELETE ON lps_contact_phone DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION lps_contact_presence_guard();

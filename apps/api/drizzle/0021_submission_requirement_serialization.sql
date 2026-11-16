-- Serialize Send's required-type set with all dictionary-entry changes, including newly inserted types.
-- Advisory locks avoid UPDATE privileges on the release-seeded, application-read-only dictionary table.
-- Owner maintenance must take pg_advisory_xact_lock(2146711107,3) BEFORE TRUNCATE: its table lock
-- precedes a BEFORE trigger. Application roles have no TRUNCATE privilege or maintenance endpoint.
CREATE OR REPLACE FUNCTION public.stage3_requirement_dictionary_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(2146711107, 3);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER stage3_requirement_dictionary_lock
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.dictionary_entry
FOR EACH STATEMENT EXECUTE FUNCTION public.stage3_requirement_dictionary_lock();

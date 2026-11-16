CREATE TABLE "document_identity" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"profile_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_file_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"section_revision_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"edit_version" integer NOT NULL,
	"file_object_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	CONSTRAINT "profile_file_history_edit_version_ck" CHECK ("profile_file_history"."edit_version" >= 0)
);
--> statement-breakpoint
-- Expand/backfill technical identity without changing existing content or file references.
ALTER TABLE "document" ADD COLUMN "identity_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "position_in_list" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_identity" ADD CONSTRAINT "document_identity_profile_org_fk" FOREIGN KEY ("profile_id","organization_id") REFERENCES "public"."manufacturer_profile"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_file_history" ADD CONSTRAINT "profile_file_history_actor_id_user_accounts_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_file_history" ADD CONSTRAINT "profile_file_history_revision_org_fk" FOREIGN KEY ("section_revision_id","organization_id") REFERENCES "public"."section_revision"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_file_history" ADD CONSTRAINT "profile_file_history_file_org_fk" FOREIGN KEY ("file_object_id","organization_id") REFERENCES "public"."file_object"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_file_history" ADD CONSTRAINT "profile_file_history_version_object_fk" FOREIGN KEY ("file_version_id","file_object_id") REFERENCES "public"."file_version"("id","file_object_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_identity_id_org_uq" ON "document_identity" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_file_history_binding_uq" ON "profile_file_history" USING btree ("section_revision_id","edit_version","file_object_id","file_version_id");--> statement-breakpoint
CREATE INDEX "profile_file_history_revision_time_idx" ON "profile_file_history" USING btree ("section_revision_id","recorded_at","id");--> statement-breakpoint
--> statement-breakpoint
CREATE UNIQUE INDEX "document_revision_identity_uq" ON "document" USING btree ("section_revision_id","identity_id");
--> statement-breakpoint
ALTER TABLE document DISABLE TRIGGER document_revision_guard;
--> statement-breakpoint
INSERT INTO document_identity(id, profile_id, organization_id)
SELECT d.id, s.profile_id, d.organization_id FROM document d
JOIN section_revision r ON r.id=d.section_revision_id AND r.organization_id=d.organization_id
JOIN profile_section s ON s.id=r.profile_section_id AND s.organization_id=r.organization_id;
--> statement-breakpoint
UPDATE document SET identity_id=id;
--> statement-breakpoint
ALTER TABLE document ALTER COLUMN identity_id SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_identity_org_fk" FOREIGN KEY ("identity_id","organization_id") REFERENCES "public"."document_identity"("id","organization_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE document ENABLE TRIGGER document_revision_guard;
--> statement-breakpoint
CREATE TRIGGER document_identity_immutable BEFORE UPDATE ON document_identity
FOR EACH ROW EXECUTE FUNCTION stage3_identity_immutable();
--> statement-breakpoint
CREATE FUNCTION profile_file_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'profile file history is append-only' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER profile_file_history_immutable BEFORE UPDATE OR DELETE ON profile_file_history
FOR EACH ROW EXECUTE FUNCTION profile_file_history_immutable();
--> statement-breakpoint
-- MAN-38: old licence values remain for historical references, but cannot be required/selected anew.
UPDATE dictionary_entry e SET retired_at=coalesce(e.retired_at, now()), mandatory=false
FROM dictionary d WHERE d.id=e.dictionary_id AND d.code='document_type' AND lower(e.code)='licence';

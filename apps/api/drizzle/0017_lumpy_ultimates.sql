ALTER TABLE "certificate" ADD COLUMN "position_in_list" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- MAN-34: historical references remain; excluded types are not available for new selection or requirements.
UPDATE dictionary_entry e SET retired_at=coalesce(e.retired_at, now()), mandatory=false
FROM dictionary d WHERE d.id=e.dictionary_id AND d.code='certificate_type'
AND lower(e.code) IN ('extract from e-ondiris', 'ct-kz', 'industrial certificate for internal circulation');

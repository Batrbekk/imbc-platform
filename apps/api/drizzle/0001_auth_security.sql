CREATE TABLE "auth_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_security_events" (
	"event_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sync_state" (
	"name" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "idp_session_id" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "idp_auth_time" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "credentials_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "last_otp_issued_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "otp_codes_session_created_idx" ON "otp_codes" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_idp_session_idx" ON "sessions" USING btree ("idp_session_id");
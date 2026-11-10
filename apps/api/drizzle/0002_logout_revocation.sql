CREATE TABLE "revoked_idp_sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_accounts" ADD COLUMN "idp_logged_out_at" timestamp with time zone;
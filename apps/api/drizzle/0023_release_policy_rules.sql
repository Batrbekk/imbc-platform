ALTER TYPE "public"."data_class" ADD VALUE 'g_lps';--> statement-breakpoint
CREATE TABLE "policy_rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"role" "role" NOT NULL,
	"data_class" "data_class" NOT NULL,
	"action" text NOT NULL,
	"condition" text NOT NULL,
	"effect" text NOT NULL,
	CONSTRAINT "policy_rule_action_ck" CHECK (nullif(btrim("policy_rule"."action"), '') is not null),
	CONSTRAINT "policy_rule_effect_ck" CHECK ("policy_rule"."effect" in ('allow', 'deny')),
	CONSTRAINT "policy_rule_condition_ck" CHECK ("policy_rule"."condition" in
      ('own_organisation', 'visible_profile', 'owner', 'nda_accepted', 'account_events', 'none'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "policy_rule_role_class_action_condition_uq" ON "policy_rule" USING btree ("role","data_class","action","condition");
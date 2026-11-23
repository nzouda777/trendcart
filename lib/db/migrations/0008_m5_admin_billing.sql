CREATE TABLE "workspace_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_id" text,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"interval" text,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"unit_amount_cents" integer,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"trial_used_at" timestamp with time zone,
	"subscribed_by" text,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_monthly_cents" integer,
	"yearly_multiplier" numeric(6, 2),
	"limits" jsonb NOT NULL,
	"features" jsonb NOT NULL,
	"highlighted" boolean DEFAULT false NOT NULL,
	"badge" text,
	"cta_label" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"trial_requires_card" boolean DEFAULT true NOT NULL,
	"stripe_product_id" text,
	"stripe_monthly_price_id" text,
	"stripe_yearly_price_id" text,
	"stripe_monthly_cents" integer,
	"stripe_yearly_cents" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_kind_check" CHECK ("plan"."kind" in ('paid', 'trial')),
	CONSTRAINT "plan_status_check" CHECK ("plan"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "platform_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"workspace_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "workspace_subscription" ADD CONSTRAINT "workspace_subscription_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_admin_user_id_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscription_workspace_uidx" ON "workspace_subscription" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_subscription_stripe_sub_uidx" ON "workspace_subscription" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "workspace_subscription_customer_idx" ON "workspace_subscription" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_slug_uidx" ON "plan" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "platform_audit_created_idx" ON "platform_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_audit_workspace_idx" ON "platform_audit_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "stripe_event_received_idx" ON "stripe_event" USING btree ("received_at");
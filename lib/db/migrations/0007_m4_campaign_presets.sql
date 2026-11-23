CREATE TABLE "campaign_preset" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_preset_workspace_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "campaign_preset_kind_check" CHECK ("campaign_preset"."kind" in ('new_test', 'duplicate'))
);
--> statement-breakpoint
DROP INDEX "campaign_product_ad_connection_uidx";--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "source_campaign_id" text;--> statement-breakpoint
ALTER TABLE "campaign" ADD COLUMN "preset_id" text;--> statement-breakpoint
ALTER TABLE "campaign_preset" ADD CONSTRAINT "campaign_preset_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_preset" ADD CONSTRAINT "campaign_preset_brand_fk" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "public"."brand"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_preset_workspace_idx" ON "campaign_preset" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_preset_brand_kind_name_uidx" ON "campaign_preset" USING btree ("workspace_id","brand_id","kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_preset_default_uidx" ON "campaign_preset" USING btree ("workspace_id","brand_id","kind") WHERE "campaign_preset"."is_default";--> statement-breakpoint
CREATE INDEX "campaign_source_idx" ON "campaign" USING btree ("workspace_id","source_campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_product_ad_connection_uidx" ON "campaign" USING btree ("workspace_id","product_id","ad_connection_id") WHERE "campaign"."source_campaign_id" is null;
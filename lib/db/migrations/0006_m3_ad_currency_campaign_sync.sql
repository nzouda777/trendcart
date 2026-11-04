ALTER TABLE "campaign" ADD COLUMN "stats_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tiktok_ad_connection" ADD COLUMN "currency" text;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_product_ad_connection_uidx" ON "campaign" USING btree ("workspace_id","product_id","ad_connection_id");--> statement-breakpoint
ALTER TABLE "tiktok_ad_connection" ADD CONSTRAINT "tiktok_ad_connection_currency_chk" CHECK ("tiktok_ad_connection"."currency" ~ '^[A-Z]{3}$');
ALTER TABLE "product" ADD COLUMN "page_copy" jsonb;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "page_copy_generated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopify_connection" ADD COLUMN "refresh_token_enc" text;--> statement-breakpoint
ALTER TABLE "shopify_connection" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shopify_connection" ADD COLUMN "refresh_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tiktok_profile_connection" ADD COLUMN "refresh_expires_at" timestamp with time zone;
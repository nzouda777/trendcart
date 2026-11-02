CREATE TYPE "public"."approval_decision" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'creating', 'paused', 'active', 'failed');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'active', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."approval_gate" AS ENUM('product_confirmation', 'supplier_choice', 'content_approval', 'launch');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."product_source_type" AS ENUM('tiktok_video', 'product_link');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('imported', 'analyzing', 'awaiting_product_confirmation', 'sourcing', 'awaiting_supplier_choice', 'building_page_and_videos', 'awaiting_content_approval', 'preparing_campaign', 'ready_to_launch', 'launched', 'failed');--> statement-breakpoint
CREATE TYPE "public"."shopify_app_mode" AS ENUM('public', 'custom');--> statement-breakpoint
CREATE TYPE "public"."shopify_product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tiktok_post_status" AS ENUM('pending', 'processing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tiktok_posting_mode" AS ENUM('direct', 'inbox');--> statement-breakpoint
CREATE TYPE "public"."video_approval" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."video_origin" AS ENUM('imported', 'related_search', 'user_supplied');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"inviter_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_organization_id" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"two_factor_enabled" boolean DEFAULT false,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"gate" "approval_gate" NOT NULL,
	"user_id" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"note" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"default_test_budget" numeric(12, 2),
	"min_margin" numeric(5, 4),
	"pricing_rule" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"ad_connection_id" text NOT NULL,
	"tiktok_ids" jsonb,
	"config" jsonb NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"launched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "campaign_stats_hourly" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"spend" numeric(12, 2) DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"revenue" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"step" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"ai_cost_usd" numeric(10, 4) DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"source_type" "product_source_type" NOT NULL,
	"source_url" text NOT NULL,
	"status" "product_status" DEFAULT 'imported' NOT NULL,
	"name" text,
	"analysis" jsonb,
	"selling_price" numeric(12, 2),
	"compare_at_price" numeric(12, 2),
	"margin" jsonb,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "proxy" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"url_enc" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"shop_domain" text NOT NULL,
	"access_token_enc" text,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"app_mode" "shopify_app_mode" DEFAULT 'public' NOT NULL,
	"client_id" text,
	"client_secret_enc" text,
	"template_suffix" text,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_connection_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "shopify_product" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"shopify_product_id" text NOT NULL,
	"handle" text NOT NULL,
	"status" "shopify_product_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_match" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"source" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"currency" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"shipping" numeric(12, 2),
	"lead_time" jsonb,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"details" jsonb,
	"selected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiktok_ad_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"advertiser_id" text NOT NULL,
	"name" text NOT NULL,
	"access_token_enc" text,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiktok_ad_connection_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "tiktok_post" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"video_id" text NOT NULL,
	"profile_connection_id" text NOT NULL,
	"publish_id" text,
	"status" "tiktok_post_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tiktok_profile_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"open_id" text NOT NULL,
	"display_name" text NOT NULL,
	"access_token_enc" text,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone,
	"posting_mode" "tiktok_posting_mode" DEFAULT 'direct' NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tiktok_profile_connection_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "usage_monthly" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"month" text NOT NULL,
	"ai_cost_usd" numeric(12, 4) DEFAULT 0 NOT NULL,
	"api_calls" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"tiktok_url" text NOT NULL,
	"author" text,
	"thumbnail_url" text,
	"metadata" jsonb,
	"origin" "video_origin" NOT NULL,
	"compliance" jsonb,
	"approval" "video_approval" DEFAULT 'pending' NOT NULL,
	"shopify_media_id" text,
	"shopify_file_url" text,
	"tiktok_video_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spark_code_enc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_workspace_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."product"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand" ADD CONSTRAINT "brand_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."product"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_ad_connection_fk" FOREIGN KEY ("workspace_id","ad_connection_id") REFERENCES "public"."tiktok_ad_connection"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stats_hourly" ADD CONSTRAINT "campaign_stats_hourly_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_stats_hourly" ADD CONSTRAINT "campaign_stats_hourly_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaign"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."product"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_fk" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "public"."brand"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy" ADD CONSTRAINT "proxy_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy" ADD CONSTRAINT "proxy_brand_fk" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "public"."brand"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_connection" ADD CONSTRAINT "shopify_connection_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_connection" ADD CONSTRAINT "shopify_connection_brand_fk" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "public"."brand"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_product" ADD CONSTRAINT "shopify_product_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_product" ADD CONSTRAINT "shopify_product_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."product"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_product" ADD CONSTRAINT "shopify_product_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."shopify_connection"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_match" ADD CONSTRAINT "supplier_match_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_match" ADD CONSTRAINT "supplier_match_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."product"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_ad_connection" ADD CONSTRAINT "tiktok_ad_connection_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_ad_connection" ADD CONSTRAINT "tiktok_ad_connection_brand_fk" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "public"."brand"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_post" ADD CONSTRAINT "tiktok_post_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_post" ADD CONSTRAINT "tiktok_post_video_fk" FOREIGN KEY ("workspace_id","video_id") REFERENCES "public"."video"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_post" ADD CONSTRAINT "tiktok_post_profile_fk" FOREIGN KEY ("workspace_id","profile_connection_id") REFERENCES "public"."tiktok_profile_connection"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_profile_connection" ADD CONSTRAINT "tiktok_profile_connection_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiktok_profile_connection" ADD CONSTRAINT "tiktok_profile_connection_brand_fk" FOREIGN KEY ("workspace_id","brand_id") REFERENCES "public"."brand"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_monthly" ADD CONSTRAINT "usage_monthly_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."product"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organizationId_idx" ON "invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_org_user_uidx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "approval_workspace_idx" ON "approval" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "approval_product_idx" ON "approval" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_idx" ON "audit_log" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "audit_log_workspace_created_idx" ON "audit_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("workspace_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "brand_workspace_idx" ON "brand" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaign_workspace_idx" ON "campaign" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "campaign_product_idx" ON "campaign" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "campaign_stats_hourly_workspace_idx" ON "campaign_stats_hourly" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_stats_hourly_campaign_hour_uidx" ON "campaign_stats_hourly" USING btree ("workspace_id","campaign_id","hour");--> statement-breakpoint
CREATE INDEX "job_workspace_idx" ON "job" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "job_product_idx" ON "job" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "product_workspace_idx" ON "product" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "product_workspace_status_idx" ON "product" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "product_brand_idx" ON "product" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE INDEX "proxy_workspace_idx" ON "proxy" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proxy_brand_uidx" ON "proxy" USING btree ("workspace_id","brand_id");--> statement-breakpoint
CREATE INDEX "shopify_connection_workspace_idx" ON "shopify_connection" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_connection_shop_uidx" ON "shopify_connection" USING btree ("workspace_id","shop_domain");--> statement-breakpoint
CREATE INDEX "shopify_product_workspace_idx" ON "shopify_product" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_product_product_connection_uidx" ON "shopify_product" USING btree ("workspace_id","product_id","connection_id");--> statement-breakpoint
CREATE INDEX "supplier_match_workspace_idx" ON "supplier_match" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "supplier_match_product_idx" ON "supplier_match" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_match_product_url_uidx" ON "supplier_match" USING btree ("workspace_id","product_id","url");--> statement-breakpoint
CREATE INDEX "tiktok_ad_connection_workspace_idx" ON "tiktok_ad_connection" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_ad_connection_advertiser_uidx" ON "tiktok_ad_connection" USING btree ("workspace_id","advertiser_id");--> statement-breakpoint
CREATE INDEX "tiktok_post_workspace_idx" ON "tiktok_post" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_post_video_profile_uidx" ON "tiktok_post" USING btree ("workspace_id","video_id","profile_connection_id");--> statement-breakpoint
CREATE INDEX "tiktok_profile_connection_workspace_idx" ON "tiktok_profile_connection" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tiktok_profile_connection_open_id_uidx" ON "tiktok_profile_connection" USING btree ("workspace_id","open_id");--> statement-breakpoint
CREATE INDEX "usage_monthly_workspace_idx" ON "usage_monthly" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_monthly_workspace_month_uidx" ON "usage_monthly" USING btree ("workspace_id","month");--> statement-breakpoint
CREATE INDEX "video_workspace_idx" ON "video" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "video_product_idx" ON "video" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_product_url_uidx" ON "video" USING btree ("workspace_id","product_id","tiktok_url");
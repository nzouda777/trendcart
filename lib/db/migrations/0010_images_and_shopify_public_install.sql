CREATE TYPE "public"."pending_image_purpose" AS ENUM('search', 'gallery');--> statement-breakpoint
ALTER TYPE "public"."product_source_type" ADD VALUE 'image';--> statement-breakpoint
CREATE TABLE "pending_image" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"product_id" text NOT NULL,
	"purpose" "pending_image_purpose" NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"sha256" text NOT NULL,
	"data_base64" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_image_size_check" CHECK ("pending_image"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "shopify_pending_install" (
	"id" text PRIMARY KEY NOT NULL,
	"shop_domain" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scopes" jsonb NOT NULL,
	"claim_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_image" ADD CONSTRAINT "pending_image_workspace_id_organization_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_image" ADD CONSTRAINT "pending_image_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_image" ADD CONSTRAINT "pending_image_product_fk" FOREIGN KEY ("workspace_id","product_id") REFERENCES "public"."product"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_image_workspace_idx" ON "pending_image" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "pending_image_product_idx" ON "pending_image" USING btree ("workspace_id","product_id");--> statement-breakpoint
CREATE INDEX "pending_image_created_idx" ON "pending_image" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_image_product_sha_uidx" ON "pending_image" USING btree ("workspace_id","product_id","purpose","sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "shopify_pending_install_shop_uidx" ON "shopify_pending_install" USING btree ("shop_domain");--> statement-breakpoint
CREATE INDEX "shopify_pending_install_expires_idx" ON "shopify_pending_install" USING btree ("expires_at");
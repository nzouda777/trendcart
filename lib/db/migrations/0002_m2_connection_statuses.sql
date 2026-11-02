ALTER TYPE "public"."connection_status" ADD VALUE 'expiring' BEFORE 'needs_reauth';--> statement-breakpoint
ALTER TYPE "public"."connection_status" ADD VALUE 'revoked' BEFORE 'disconnected';
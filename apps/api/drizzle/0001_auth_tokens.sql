CREATE TYPE "public"."auth_token_kind" AS ENUM('invite', 'password_reset');--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "auth_token_kind" NOT NULL,
	"token_hash" text NOT NULL,
	"email" text,
	"role" "user_role",
	"target_user_id" uuid,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_sha256_check" CHECK ("auth_tokens"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "auth_tokens_invite_check" CHECK ("auth_tokens"."kind" <> 'invite' OR ("auth_tokens"."role" IS NOT NULL AND "auth_tokens"."target_user_id" IS NULL)),
	CONSTRAINT "auth_tokens_password_reset_check" CHECK ("auth_tokens"."kind" <> 'password_reset' OR ("auth_tokens"."target_user_id" IS NOT NULL AND "auth_tokens"."role" IS NULL AND "auth_tokens"."email" IS NULL)),
	CONSTRAINT "auth_tokens_email_normalized_check" CHECK ("auth_tokens"."email" = lower(btrim("auth_tokens"."email")) AND char_length("auth_tokens"."email") BETWEEN 3 AND 254),
	CONSTRAINT "auth_tokens_used_by_check" CHECK ("auth_tokens"."used_by_user_id" IS NULL OR "auth_tokens"."used_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_used_by_user_id_users_id_fk" FOREIGN KEY ("used_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_token_hash_unique" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_target_user_id_idx" ON "auth_tokens" USING btree ("target_user_id") WHERE "auth_tokens"."target_user_id" IS NOT NULL;
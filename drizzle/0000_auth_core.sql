CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "auth_throttle_key_format_check" CHECK ("auth_throttle"."key" ~ '^(email|ip):.+$'),
	CONSTRAINT "auth_throttle_failures_check" CHECK ("auth_throttle"."failures" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_id_sha256_check" CHECK ("sessions"."id" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"password_hash" text,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"anonymized_at" timestamp with time zone,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_name_length_check" CHECK (char_length("users"."name") BETWEEN 1 AND 80),
	CONSTRAINT "users_email_normalized_check" CHECK ("users"."email" = lower(btrim("users"."email")) AND char_length("users"."email") BETWEEN 3 AND 254),
	CONSTRAINT "users_credentials_present_check" CHECK ("users"."anonymized_at" IS NOT NULL OR ("users"."email" IS NOT NULL AND "users"."password_hash" IS NOT NULL)),
	CONSTRAINT "users_anonymized_check" CHECK ("users"."anonymized_at" IS NULL OR ("users"."email" IS NULL AND "users"."password_hash" IS NULL AND "users"."status" = 'deactivated'))
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_singleton_check" CHECK ("workspace"."id" = 1),
	CONSTRAINT "workspace_name_length_check" CHECK (char_length("workspace"."name") BETWEEN 1 AND 100),
	CONSTRAINT "workspace_timezone_not_empty_check" CHECK ("workspace"."timezone" <> '')
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");
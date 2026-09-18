CREATE TABLE "user_avatars" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_avatars_content_type_check" CHECK ("user_avatars"."content_type" IN ('image/webp', 'image/jpeg', 'image/png')),
	CONSTRAINT "user_avatars_bytes_length_check" CHECK (octet_length("user_avatars"."bytes") BETWEEN 1 AND 131072)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_avatars" ADD CONSTRAINT "user_avatars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
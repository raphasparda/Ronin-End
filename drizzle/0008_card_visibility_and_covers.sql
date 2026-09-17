CREATE TYPE "public"."card_visibility" AS ENUM('team', 'restricted');--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'card_visibility_changed';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'card_viewer_added';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'card_viewer_removed';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'card_cover_changed';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'card_cover_removed';--> statement-breakpoint
CREATE TABLE "card_covers" (
	"card_id" uuid PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_covers_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "card_covers_object_key_check" CHECK ("card_covers"."object_key" ~ ('^covers/' || "card_covers"."card_id" || '/[A-Za-z0-9_-]{32}$')),
	CONSTRAINT "card_covers_content_type_check" CHECK ("card_covers"."content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
	CONSTRAINT "card_covers_size_check" CHECK ("card_covers"."size_bytes" BETWEEN 1 AND 5242880),
	CONSTRAINT "card_covers_dimensions_check" CHECK (("card_covers"."width" IS NULL OR "card_covers"."width" BETWEEN 1 AND 20000) AND ("card_covers"."height" IS NULL OR "card_covers"."height" BETWEEN 1 AND 20000))
);
--> statement-breakpoint
CREATE TABLE "card_viewers" (
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_viewers_pkey" PRIMARY KEY("card_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "visibility" "card_visibility" DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_covers" ADD CONSTRAINT "card_covers_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_covers" ADD CONSTRAINT "card_covers_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_viewers" ADD CONSTRAINT "card_viewers_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_viewers" ADD CONSTRAINT "card_viewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_viewers" ADD CONSTRAINT "card_viewers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_viewers_user_id_idx" ON "card_viewers" USING btree ("user_id");
CREATE TYPE "public"."activity_type" AS ENUM('card_created', 'card_title_changed', 'card_moved', 'card_assignee_added', 'card_assignee_removed', 'card_due_changed', 'card_priority_changed', 'card_completed', 'card_reopened', 'card_archived', 'card_restored');--> statement-breakpoint
CREATE TYPE "public"."card_status" AS ENUM('open', 'completed');--> statement-breakpoint
CREATE TABLE "card_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"type" "activity_type" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_activities_data_object_check" CHECK (jsonb_typeof("card_activities"."data") = 'object')
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"status" "card_status" DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"due_at" timestamp with time zone,
	"due_has_time" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_title_check" CHECK (char_length("cards"."title") BETWEEN 1 AND 500 AND "cards"."title" !~ '[\r\n]'),
	CONSTRAINT "cards_description_length_check" CHECK (char_length("cards"."description") <= 20000),
	CONSTRAINT "cards_position_not_empty_check" CHECK ("cards"."position" <> ''),
	CONSTRAINT "cards_completion_check" CHECK (("cards"."status" = 'completed' AND "cards"."completed_at" IS NOT NULL AND "cards"."completed_by" IS NOT NULL) OR ("cards"."status" = 'open' AND "cards"."completed_at" IS NULL AND "cards"."completed_by" IS NULL)),
	CONSTRAINT "cards_due_has_time_check" CHECK ("cards"."due_at" IS NOT NULL OR NOT "cards"."due_has_time")
);
--> statement-breakpoint
ALTER TABLE "card_activities" ADD CONSTRAINT "card_activities_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_activities" ADD CONSTRAINT "card_activities_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_activities" ADD CONSTRAINT "card_activities_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_list_board_fk" FOREIGN KEY ("list_id","board_id") REFERENCES "public"."lists"("id","board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_activities_card_id_created_at_idx" ON "card_activities" USING btree ("card_id","created_at");--> statement-breakpoint
CREATE INDEX "card_activities_board_id_idx" ON "card_activities" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_list_position_active_unique" ON "cards" USING btree ("list_id","position") WHERE "cards"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "cards_board_id_idx" ON "cards" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "cards_list_id_idx" ON "cards" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "cards_due_at_open_idx" ON "cards" USING btree ("due_at") WHERE "cards"."status" = 'open' AND "cards"."archived_at" IS NULL;
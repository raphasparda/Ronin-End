CREATE TYPE "public"."palette_color" AS ENUM('gray', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta');--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_name_length_check" CHECK (char_length("boards"."name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text COLLATE "C" NOT NULL,
	"is_done_list" boolean DEFAULT false NOT NULL,
	"color" "palette_color" NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lists_id_board_id_unique" UNIQUE("id","board_id"),
	CONSTRAINT "lists_name_length_check" CHECK (char_length("lists"."name") BETWEEN 1 AND 100),
	CONSTRAINT "lists_position_not_empty_check" CHECK ("lists"."position" <> ''),
	CONSTRAINT "lists_done_list_not_archived_check" CHECK (NOT ("lists"."is_done_list" AND "lists"."archived_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lists_board_position_active_unique" ON "lists" USING btree ("board_id","position") WHERE "lists"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "lists_board_done_list_unique" ON "lists" USING btree ("board_id") WHERE "lists"."is_done_list";--> statement-breakpoint
CREATE INDEX "lists_board_id_idx" ON "lists" USING btree ("board_id");
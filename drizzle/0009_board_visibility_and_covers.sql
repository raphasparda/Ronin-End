-- Fatia 11 (refeita): visibilidade e capa passam do card para o QUADRO (ADR 0015 e ADR 0016).
-- Cria as estruturas do quadro e derruba as do card, inclusive os tipos de atividade que só
-- existiam por causa delas. Perda de dado assumida e registrada no CHANGELOG: restrições de card,
-- listas de acesso de card, capas de card e as atividades correspondentes.
CREATE TYPE "public"."board_visibility" AS ENUM('team', 'restricted');--> statement-breakpoint
CREATE TABLE "board_covers" (
	"board_id" uuid PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_covers_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "board_covers_object_key_check" CHECK ("board_covers"."object_key" ~ ('^covers/' || "board_covers"."board_id" || '/[A-Za-z0-9_-]{32}$')),
	CONSTRAINT "board_covers_content_type_check" CHECK ("board_covers"."content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
	CONSTRAINT "board_covers_size_check" CHECK ("board_covers"."size_bytes" BETWEEN 1 AND 5242880),
	CONSTRAINT "board_covers_dimensions_check" CHECK (("board_covers"."width" IS NULL OR "board_covers"."width" BETWEEN 1 AND 20000) AND ("board_covers"."height" IS NULL OR "board_covers"."height" BETWEEN 1 AND 20000))
);
--> statement-breakpoint
CREATE TABLE "board_viewers" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_viewers_pkey" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "visibility" "board_visibility" DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "board_covers" ADD CONSTRAINT "board_covers_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_covers" ADD CONSTRAINT "board_covers_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_viewers" ADD CONSTRAINT "board_viewers_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_viewers" ADD CONSTRAINT "board_viewers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_viewers" ADD CONSTRAINT "board_viewers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_viewers_user_id_idx" ON "board_viewers" USING btree ("user_id");--> statement-breakpoint
DROP TABLE "card_covers" CASCADE;--> statement-breakpoint
DROP TABLE "card_viewers" CASCADE;--> statement-breakpoint
-- Os cinco tipos saem do enum; as linhas que os usam são apagadas antes do `USING` (o cast falharia).
-- São atividades de funções que deixaram de existir no card.
DELETE FROM "card_activities" WHERE "type"::text IN ('card_visibility_changed', 'card_viewer_added', 'card_viewer_removed', 'card_cover_changed', 'card_cover_removed');--> statement-breakpoint
ALTER TABLE "card_activities" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."activity_type";--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('card_created', 'card_title_changed', 'card_moved', 'card_assignee_added', 'card_assignee_removed', 'card_due_changed', 'card_priority_changed', 'card_completed', 'card_reopened', 'card_archived', 'card_restored');--> statement-breakpoint
ALTER TABLE "card_activities" ALTER COLUMN "type" SET DATA TYPE "public"."activity_type" USING "type"::"public"."activity_type";--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "visibility";--> statement-breakpoint
DROP TYPE "public"."card_visibility";

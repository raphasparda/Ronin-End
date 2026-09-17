-- I12: atividade é append-only. Recusa UPDATE em card_activities (DELETE continua possível para as
-- cascatas de card/quadro; TRUNCATE dos testes não dispara triggers de linha).
-- Rollback: DROP TRIGGER "card_activities_append_only" ON "card_activities";
--           DROP FUNCTION "card_activities_reject_update"();
CREATE FUNCTION "card_activities_reject_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'card_activities é append-only'
    USING ERRCODE = 'restrict_violation', CONSTRAINT = 'card_activities_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "card_activities_append_only"
  BEFORE UPDATE ON "card_activities"
  FOR EACH ROW EXECUTE FUNCTION "card_activities_reject_update"();

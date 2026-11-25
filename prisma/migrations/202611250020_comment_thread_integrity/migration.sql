BEGIN;

LOCK TABLE "comments", "pulse_comments" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "comments" child
    JOIN "comments" parent ON parent."id" = child."parent_id"
    WHERE parent."article_id" <> child."article_id" OR parent."parent_id" IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM "pulse_comments" child
    JOIN "pulse_comments" parent ON parent."id" = child."parent_id"
    WHERE parent."pulse_id" <> child."pulse_id" OR parent."parent_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Existing comment threads violate same-content two-level structure';
  END IF;
END;
$$;

CREATE FUNCTION enforce_comment_thread() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  content_column text := TG_ARGV[0];
  content_id uuid := (to_jsonb(NEW) ->> content_column)::uuid;
  parent_found boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
      OR content_id IS DISTINCT FROM (to_jsonb(OLD) ->> content_column)::uuid THEN
      RAISE check_violation USING MESSAGE = 'Comment identity, content and parent cannot change';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE check_violation USING MESSAGE = 'A comment cannot reply to itself';
    END IF;
    EXECUTE format(
      'SELECT true FROM %I.%I WHERE id = $1 AND %I = $2 AND parent_id IS NULL FOR KEY SHARE',
      TG_TABLE_SCHEMA, TG_TABLE_NAME, content_column
    ) INTO parent_found USING NEW.parent_id, content_id;
    IF parent_found IS DISTINCT FROM true THEN
      RAISE check_violation USING MESSAGE = 'Replies require a root comment on the same content';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER comments_thread_guard
  BEFORE INSERT OR UPDATE OF id, article_id, parent_id ON "comments"
  FOR EACH ROW EXECUTE FUNCTION enforce_comment_thread('article_id');

CREATE TRIGGER pulse_comments_thread_guard
  BEFORE INSERT OR UPDATE OF id, pulse_id, parent_id ON "pulse_comments"
  FOR EACH ROW EXECUTE FUNCTION enforce_comment_thread('pulse_id');

COMMIT;

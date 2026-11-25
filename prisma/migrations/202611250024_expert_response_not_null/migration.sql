BEGIN;
ALTER TABLE "expert_annotations" DROP CONSTRAINT "expert_annotations_submission_state";
ALTER TABLE "expert_annotations" ADD CONSTRAINT "expert_annotations_submission_state" CHECK (
  ("status" = 'CLAIMED' AND "response" IS NULL AND "submitted_at" IS NULL)
  OR ("status" = 'SUBMITTED' AND "response" IS NOT NULL AND "response" ~ '[^[:space:]]' AND char_length("response") <= 10000 AND "submitted_at" IS NOT NULL)
);
COMMIT;

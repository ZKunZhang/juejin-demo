ALTER TABLE "pulse_comments" ADD COLUMN "parent_id" UUID;
ALTER TABLE "pulse_comments" ADD CONSTRAINT "pulse_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "pulse_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "pulse_comments_parent_id_status_created_at_id_idx" ON "pulse_comments"("parent_id", "status", "created_at", "id");
CREATE TABLE "pulse_comment_likes" (
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "comment_id" UUID NOT NULL REFERENCES "pulse_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("user_id", "comment_id")
);
CREATE INDEX "pulse_comment_likes_comment_id_user_id_idx" ON "pulse_comment_likes"("comment_id", "user_id");

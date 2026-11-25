ALTER TABLE "comments" ADD COLUMN "parent_id" UUID;
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "comments_parent_id_status_created_at_id_idx"
  ON "comments"("parent_id", "status", "created_at", "id");

ALTER TABLE "articles" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0 CHECK ("view_count" >= 0);
CREATE TABLE "article_view_windows" (
  "article_id" UUID NOT NULL REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "viewer_key" TEXT NOT NULL,
  "last_counted_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("article_id", "viewer_key")
);
CREATE INDEX "article_view_windows_last_counted_at_idx" ON "article_view_windows"("last_counted_at");

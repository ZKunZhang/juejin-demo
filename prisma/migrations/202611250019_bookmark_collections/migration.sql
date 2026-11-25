CREATE TABLE "bookmark_collections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bookmark_collections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bookmark_collections_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "bookmark_collections_user_id_id_key" ON "bookmark_collections"("user_id", "id");
CREATE UNIQUE INDEX "bookmark_collections_user_id_name_key" ON "bookmark_collections"("user_id", "name");

ALTER TABLE "article_bookmarks" ADD COLUMN "collection_id" UUID;
CREATE INDEX "article_bookmarks_user_id_collection_id_created_at_article_id_idx"
    ON "article_bookmarks"("user_id", "collection_id", "created_at", "article_id");
ALTER TABLE "article_bookmarks" ADD CONSTRAINT "article_bookmarks_user_id_collection_id_fkey"
    FOREIGN KEY ("user_id", "collection_id") REFERENCES "bookmark_collections"("user_id", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

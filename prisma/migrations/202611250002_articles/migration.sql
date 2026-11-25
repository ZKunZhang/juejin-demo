-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNLISTED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "articles" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "summary" TEXT,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'NOT_SUBMITTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tags" (
    "article_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_tags_pkey" PRIMARY KEY ("article_id","tag_id")
);

-- CreateIndex
CREATE INDEX "articles_status_published_at_id_idx" ON "articles"("status", "published_at", "id");

-- CreateIndex
CREATE INDEX "articles_author_id_status_updated_at_idx" ON "articles"("author_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "articles_review_status_updated_at_id_idx" ON "articles"("review_status", "updated_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "article_tags_tag_id_article_id_idx" ON "article_tags"("tag_id", "article_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "articles" ADD CONSTRAINT "articles_version_positive" CHECK ("version" > 0);
ALTER TABLE "articles" ADD CONSTRAINT "articles_published_time" CHECK ("status" <> 'PUBLISHED' OR ("published_at" IS NOT NULL AND "review_status" = 'APPROVED'));
INSERT INTO "tags" ("id","slug","name") VALUES
  ('21edcf4f-aad5-48e1-a347-c22089728d01','frontend','前端'),
  ('21edcf4f-aad5-48e1-a347-c22089728d02','backend','后端'),
  ('21edcf4f-aad5-48e1-a347-c22089728d03','ai','人工智能'),
  ('21edcf4f-aad5-48e1-a347-c22089728d04','mobile','移动开发'),
  ('21edcf4f-aad5-48e1-a347-c22089728d05','tools','开发工具');

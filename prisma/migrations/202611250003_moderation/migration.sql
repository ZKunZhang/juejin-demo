-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('SUBMIT', 'APPROVE', 'REJECT', 'UNLIST', 'RETURN_TO_DRAFT');

-- CreateEnum
CREATE TYPE "CommentStatus" AS ENUM ('VISIBLE', 'HIDDEN');

-- CreateTable
CREATE TABLE "article_review_logs" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "article_version" INTEGER NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "from_status" "ArticleStatus" NOT NULL,
    "to_status" "ArticleStatus" NOT NULL,
    "from_review_status" "ReviewStatus" NOT NULL,
    "to_review_status" "ReviewStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_moderation_logs" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "from_status" "CommentStatus" NOT NULL,
    "to_status" "CommentStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_moderation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_review_logs_article_id_created_at_idx" ON "article_review_logs"("article_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "article_review_logs_article_id_article_version_key" ON "article_review_logs"("article_id", "article_version");

-- CreateIndex
CREATE INDEX "comments_article_id_status_created_at_id_idx" ON "comments"("article_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "comments_status_created_at_id_idx" ON "comments"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "comment_moderation_logs_comment_id_created_at_idx" ON "comment_moderation_logs"("comment_id", "created_at");

-- AddForeignKey
ALTER TABLE "article_review_logs" ADD CONSTRAINT "article_review_logs_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_review_logs" ADD CONSTRAINT "article_review_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_moderation_logs" ADD CONSTRAINT "comment_moderation_logs_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_moderation_logs" ADD CONSTRAINT "comment_moderation_logs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


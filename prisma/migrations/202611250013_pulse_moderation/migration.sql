BEGIN;

-- CreateEnum
CREATE TYPE "PulseStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED', 'UNLISTED');

-- AlterTable
ALTER TABLE "pulses" ADD COLUMN     "review_reason" TEXT,
ADD COLUMN     "status" "PulseStatus" NOT NULL DEFAULT 'PUBLISHED';
ALTER TABLE "pulses" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "pulse_comments" (
    "id" UUID NOT NULL,
    "pulse_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pulse_reviews" (
    "id" UUID NOT NULL,
    "pulse_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "from_status" "PulseStatus" NOT NULL,
    "to_status" "PulseStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pulse_comment_reviews" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "from_status" "CommentStatus" NOT NULL,
    "to_status" "CommentStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_comment_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pulse_comments_pulse_id_status_created_at_id_idx" ON "pulse_comments"("pulse_id", "status", "created_at", "id");

-- CreateIndex
CREATE INDEX "pulse_comments_status_created_at_id_idx" ON "pulse_comments"("status", "created_at", "id");

-- CreateIndex
CREATE INDEX "pulse_reviews_pulse_id_created_at_idx" ON "pulse_reviews"("pulse_id", "created_at");

-- CreateIndex
CREATE INDEX "pulse_comment_reviews_comment_id_created_at_idx" ON "pulse_comment_reviews"("comment_id", "created_at");

-- CreateIndex
CREATE INDEX "pulses_status_created_at_id_idx" ON "pulses"("status", "created_at", "id");

-- AddForeignKey
ALTER TABLE "pulse_comments" ADD CONSTRAINT "pulse_comments_pulse_id_fkey" FOREIGN KEY ("pulse_id") REFERENCES "pulses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_comments" ADD CONSTRAINT "pulse_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_reviews" ADD CONSTRAINT "pulse_reviews_pulse_id_fkey" FOREIGN KEY ("pulse_id") REFERENCES "pulses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_reviews" ADD CONSTRAINT "pulse_reviews_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_comment_reviews" ADD CONSTRAINT "pulse_comment_reviews_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "pulse_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_comment_reviews" ADD CONSTRAINT "pulse_comment_reviews_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

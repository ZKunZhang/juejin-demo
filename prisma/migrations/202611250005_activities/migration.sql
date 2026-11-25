-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'UNLISTED');

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "editor_id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "summary" VARCHAR(300) NOT NULL,
    "url" TEXT,
    "status" "ActivityStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "visible_from" TIMESTAMPTZ(3),
    "visible_to" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activities_status_sort_order_id_idx" ON "activities"("status", "sort_order", "id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_editor_id_fkey" FOREIGN KEY ("editor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activities" ADD CONSTRAINT "activities_valid_window" CHECK ("visible_from" IS NULL OR "visible_to" IS NULL OR "visible_to" > "visible_from");
ALTER TABLE "activities" ADD CONSTRAINT "activities_valid_version_order" CHECK ("version" > 0 AND "sort_order" BETWEEN 0 AND 9999);
ALTER TABLE "activities" ADD CONSTRAINT "activities_required_content" CHECK (length(btrim("title")) > 0 AND length(btrim("summary")) > 0);

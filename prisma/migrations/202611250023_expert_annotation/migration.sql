BEGIN;
CREATE TYPE "ExpertTaskStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "ExpertAnnotationStatus" AS ENUM ('CLAIMED', 'SUBMITTED');
CREATE TABLE "expert_tasks" (
  "id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(500) NOT NULL,
  "instructions" TEXT NOT NULL,
  "status" "ExpertTaskStatus" NOT NULL DEFAULT 'OPEN',
  "is_demo" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "expert_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expert_tasks_title_not_blank" CHECK ("title" ~ '[^[:space:]]'),
  CONSTRAINT "expert_tasks_summary_not_blank" CHECK ("summary" ~ '[^[:space:]]'),
  CONSTRAINT "expert_tasks_instructions_not_blank" CHECK ("instructions" ~ '[^[:space:]]')
);
CREATE INDEX "expert_tasks_status_created_at_id_idx" ON "expert_tasks"("status", "created_at", "id");
CREATE TABLE "expert_annotations" (
  "task_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" "ExpertAnnotationStatus" NOT NULL DEFAULT 'CLAIMED',
  "response" TEXT,
  "claimed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMPTZ(3),
  CONSTRAINT "expert_annotations_pkey" PRIMARY KEY ("task_id", "user_id"),
  CONSTRAINT "expert_annotations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "expert_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "expert_annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "expert_annotations_submission_state" CHECK (
    ("status" = 'CLAIMED' AND "response" IS NULL AND "submitted_at" IS NULL)
    OR ("status" = 'SUBMITTED' AND "response" IS NOT NULL AND "response" ~ '[^[:space:]]' AND char_length("response") <= 10000 AND "submitted_at" IS NOT NULL)
  )
);
CREATE INDEX "expert_annotations_user_id_claimed_at_idx" ON "expert_annotations"("user_id", "claimed_at");
COMMENT ON TABLE "expert_tasks" IS '专家标注任务及公开任务说明。';
COMMENT ON COLUMN "expert_tasks"."id" IS '任务唯一标识。';
COMMENT ON COLUMN "expert_tasks"."title" IS '任务名称。';
COMMENT ON COLUMN "expert_tasks"."summary" IS '任务简介。';
COMMENT ON COLUMN "expert_tasks"."instructions" IS '标注材料、要求和交付说明。';
COMMENT ON COLUMN "expert_tasks"."status" IS '任务开放状态：OPEN 可领取与提交，CLOSED 已关闭。';
COMMENT ON COLUMN "expert_tasks"."is_demo" IS '演示任务标识，页面据此说明数据性质。';
COMMENT ON COLUMN "expert_tasks"."created_at" IS '任务创建时间。';
COMMENT ON COLUMN "expert_tasks"."updated_at" IS '任务最近更新时间。';
COMMENT ON TABLE "expert_annotations" IS '用户领取的标注任务与仅本人可读取的提交结果。';
COMMENT ON COLUMN "expert_annotations"."task_id" IS '关联标注任务。';
COMMENT ON COLUMN "expert_annotations"."user_id" IS '领取和提交标注的用户。';
COMMENT ON COLUMN "expert_annotations"."status" IS '领取记录状态：CLAIMED 处理中，SUBMITTED 已提交。';
COMMENT ON COLUMN "expert_annotations"."response" IS '用户提交的标注说明，最多一万字，领取后为空。';
COMMENT ON COLUMN "expert_annotations"."claimed_at" IS '首次领取任务的时间。';
COMMENT ON COLUMN "expert_annotations"."submitted_at" IS '完成提交时间，领取后为空。';
COMMIT;

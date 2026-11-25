BEGIN;

CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'UNLISTED');

CREATE TABLE "projects" (
  "id" UUID NOT NULL,
  "author_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(500) NOT NULL,
  "body_markdown" TEXT NOT NULL,
  "cover_url" VARCHAR(2000),
  "project_url" VARCHAR(2000) NOT NULL,
  "repository_url" VARCHAR(2000),
  "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "submitted_at" TIMESTAMPTZ(3),
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "projects_version_positive" CHECK ("version" > 0),
  CONSTRAINT "projects_title_not_blank" CHECK ("title" ~ '[^[:space:]]'),
  CONSTRAINT "projects_summary_not_blank" CHECK ("summary" ~ '[^[:space:]]'),
  CONSTRAINT "projects_published_at_required" CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL),
  CONSTRAINT "projects_submitted_at_required" CHECK ("status" NOT IN ('PENDING', 'PUBLISHED', 'REJECTED', 'UNLISTED') OR "submitted_at" IS NOT NULL)
);
CREATE INDEX "projects_status_published_at_id_idx" ON "projects"("status", "published_at", "id");
CREATE INDEX "projects_author_id_updated_at_idx" ON "projects"("author_id", "updated_at");
CREATE INDEX "projects_status_submitted_at_id_idx" ON "projects"("status", "submitted_at", "id");

CREATE TABLE "project_categories" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(64) NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "project_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_categories_name_not_blank" CHECK ("name" ~ '[^[:space:]]')
);
CREATE UNIQUE INDEX "project_categories_slug_key" ON "project_categories"("slug");

CREATE TABLE "project_platforms" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(64) NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "project_platforms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_platforms_name_not_blank" CHECK ("name" ~ '[^[:space:]]')
);
CREATE UNIQUE INDEX "project_platforms_slug_key" ON "project_platforms"("slug");

CREATE TABLE "project_category_links" (
  "project_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  CONSTRAINT "project_category_links_pkey" PRIMARY KEY ("project_id", "category_id"),
  CONSTRAINT "project_category_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_category_links_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "project_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "project_category_links_category_id_project_id_idx" ON "project_category_links"("category_id", "project_id");

CREATE TABLE "project_platform_links" (
  "project_id" UUID NOT NULL,
  "platform_id" UUID NOT NULL,
  CONSTRAINT "project_platform_links_pkey" PRIMARY KEY ("project_id", "platform_id"),
  CONSTRAINT "project_platform_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_platform_links_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "project_platforms"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "project_platform_links_platform_id_project_id_idx" ON "project_platform_links"("platform_id", "project_id");

CREATE TABLE "project_likes" (
  "project_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_likes_pkey" PRIMARY KEY ("project_id", "user_id"),
  CONSTRAINT "project_likes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "project_likes_user_id_created_at_project_id_idx" ON "project_likes"("user_id", "created_at", "project_id");

CREATE TABLE "project_view_windows" (
  "project_id" UUID NOT NULL,
  "viewer_key" VARCHAR(64) NOT NULL,
  "window_start" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "project_view_windows_pkey" PRIMARY KEY ("project_id", "viewer_key", "window_start"),
  CONSTRAINT "project_view_windows_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "project_view_windows_window_start_idx" ON "project_view_windows"("window_start");

CREATE TABLE "project_reviews" (
  "id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "previous_status" "ProjectStatus" NOT NULL,
  "next_status" "ProjectStatus" NOT NULL,
  "reason" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "project_reviews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_reviews_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_reviews_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "project_reviews_project_id_version_key" ON "project_reviews"("project_id", "version");
CREATE INDEX "project_reviews_actor_id_created_at_idx" ON "project_reviews"("actor_id", "created_at");

COMMENT ON TABLE "projects" IS '作品广场的作品内容、发布状态及版本。';
COMMENT ON TABLE "project_categories" IS '作品分类目录及展示顺序。';
COMMENT ON TABLE "project_platforms" IS '作品运行平台目录及展示顺序。';
COMMENT ON TABLE "project_category_links" IS '作品与分类的多对多关系。';
COMMENT ON TABLE "project_platform_links" IS '作品与运行平台的多对多关系。';
COMMENT ON TABLE "project_likes" IS '用户对作品的点赞关系，每个用户对同一作品最多一条。';
COMMENT ON TABLE "project_view_windows" IS '作品浏览去重记录，同一访问者在同一统计窗口只计一次。';
COMMENT ON TABLE "project_reviews" IS '作品审核操作及状态变更日志。';

COMMENT ON COLUMN "projects"."id" IS '作品唯一标识。';
COMMENT ON COLUMN "projects"."author_id" IS '作品作者，对应用户表。';
COMMENT ON COLUMN "projects"."title" IS '作品标题。';
COMMENT ON COLUMN "projects"."summary" IS '作品简介。';
COMMENT ON COLUMN "projects"."body_markdown" IS '作品详情，使用 Markdown 保存。';
COMMENT ON COLUMN "projects"."cover_url" IS '可空的 HTTPS 封面地址。';
COMMENT ON COLUMN "projects"."project_url" IS '作品的 HTTP 或 HTTPS 访问地址。';
COMMENT ON COLUMN "projects"."repository_url" IS '可空的 HTTP 或 HTTPS 源代码仓库地址。';
COMMENT ON COLUMN "projects"."status" IS '作品流程状态：草稿、待审核、已发布、已驳回或已下架。';
COMMENT ON COLUMN "projects"."version" IS '作品乐观锁版本，每次修改或状态变更递增。';
COMMENT ON COLUMN "projects"."created_at" IS '作品创建时间。';
COMMENT ON COLUMN "projects"."updated_at" IS '最近一次内容或状态更新时间。';
COMMENT ON COLUMN "projects"."submitted_at" IS '最近一次提交审核的时间，保存草稿时保持原值。';
COMMENT ON COLUMN "projects"."published_at" IS '作品公开发布时间。';

COMMENT ON COLUMN "project_categories"."id" IS '分类唯一标识。';
COMMENT ON COLUMN "project_categories"."slug" IS '分类唯一英文标识。';
COMMENT ON COLUMN "project_categories"."name" IS '分类显示名称。';
COMMENT ON COLUMN "project_categories"."sort_order" IS '分类展示顺序，数值小的在前。';
COMMENT ON COLUMN "project_categories"."active" IS '是否允许作品选择此分类。';
COMMENT ON COLUMN "project_platforms"."id" IS '平台唯一标识。';
COMMENT ON COLUMN "project_platforms"."slug" IS '平台唯一英文标识。';
COMMENT ON COLUMN "project_platforms"."name" IS '平台显示名称。';
COMMENT ON COLUMN "project_platforms"."sort_order" IS '平台展示顺序，数值小的在前。';
COMMENT ON COLUMN "project_platforms"."active" IS '是否允许作品选择此平台。';
COMMENT ON COLUMN "project_category_links"."project_id" IS '关联的作品标识。';
COMMENT ON COLUMN "project_category_links"."category_id" IS '关联的作品分类标识。';
COMMENT ON COLUMN "project_platform_links"."project_id" IS '关联的作品标识。';
COMMENT ON COLUMN "project_platform_links"."platform_id" IS '关联的作品运行平台标识。';
COMMENT ON COLUMN "project_likes"."project_id" IS '被点赞的作品标识。';
COMMENT ON COLUMN "project_likes"."user_id" IS '点赞用户标识。';
COMMENT ON COLUMN "project_likes"."created_at" IS '首次点赞时间。';
COMMENT ON COLUMN "project_view_windows"."project_id" IS '被浏览的作品标识。';
COMMENT ON COLUMN "project_view_windows"."viewer_key" IS '经服务端生成的访问者标识摘要。';
COMMENT ON COLUMN "project_view_windows"."window_start" IS '本次浏览所属去重统计窗口的开始时间。';
COMMENT ON COLUMN "project_reviews"."id" IS '审核日志唯一标识。';
COMMENT ON COLUMN "project_reviews"."project_id" IS '被审核的作品标识。';
COMMENT ON COLUMN "project_reviews"."actor_id" IS '执行审核操作的管理员标识。';
COMMENT ON COLUMN "project_reviews"."version" IS '状态变更后的作品版本，同一作品同一版本最多一条日志。';
COMMENT ON COLUMN "project_reviews"."action" IS '审核操作类型。';
COMMENT ON COLUMN "project_reviews"."previous_status" IS '操作前的作品状态。';
COMMENT ON COLUMN "project_reviews"."next_status" IS '操作后的作品状态。';
COMMENT ON COLUMN "project_reviews"."reason" IS '驳回或下架原因，审核通过时可以为空。';
COMMENT ON COLUMN "project_reviews"."created_at" IS '审核操作时间。';

INSERT INTO "project_categories" ("id", "slug", "name", "sort_order") VALUES
  ('c1300000-0000-4000-8000-000000000001', 'developer-tools', '开发工具', 10),
  ('c1300000-0000-4000-8000-000000000002', 'ai-applications', 'AI 应用', 20),
  ('c1300000-0000-4000-8000-000000000003', 'creative-projects', '创意作品', 30);
INSERT INTO "project_platforms" ("id", "slug", "name", "sort_order") VALUES
  ('f1300000-0000-4000-8000-000000000001', 'web', 'Web', 10),
  ('f1300000-0000-4000-8000-000000000002', 'desktop', '桌面应用', 20),
  ('f1300000-0000-4000-8000-000000000003', 'mobile', '移动应用', 30);

COMMIT;

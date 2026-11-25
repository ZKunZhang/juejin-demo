ALTER TYPE "ProjectStatus" ADD VALUE 'DELETED';

COMMENT ON COLUMN "projects"."status" IS '作品流程状态：草稿、待审核、已发布、已驳回、已下架或已删除；已删除作品只保留作后台审计。';
COMMENT ON COLUMN "project_reviews"."action" IS '状态变更动作：提交、通过、驳回、下架、重新上架或删除。';

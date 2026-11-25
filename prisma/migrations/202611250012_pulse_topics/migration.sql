CREATE TYPE "TagScope" AS ENUM ('BOTH', 'ARTICLE', 'PULSE');
ALTER TABLE "tags" ADD COLUMN "scope" "TagScope" NOT NULL DEFAULT 'BOTH';
INSERT INTO "tags" ("id", "slug", "name", "scope") VALUES
  ('21edcf4f-aad5-48e1-a347-c22089728d06', 'work-break', '上班摸鱼', 'PULSE'),
  ('21edcf4f-aad5-48e1-a347-c22089728d07', 'developer-life', '程序员生活', 'PULSE'),
  ('21edcf4f-aad5-48e1-a347-c22089728d08', 'project-notes', '项目经验', 'PULSE');

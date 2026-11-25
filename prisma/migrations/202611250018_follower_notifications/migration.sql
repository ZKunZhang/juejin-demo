CREATE TYPE "NotificationKind" AS ENUM ('ARTICLE_PUBLISHED', 'PULSE_PUBLISHED');
CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "recipient_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "actor_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" "NotificationKind" NOT NULL,
  "target_id" UUID NOT NULL,
  "preview" VARCHAR(180) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "read_at" TIMESTAMPTZ(3),
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notifications_recipient_id_kind_target_id_key" ON "notifications"("recipient_id", "kind", "target_id");
CREATE INDEX "notifications_recipient_id_created_at_id_idx" ON "notifications"("recipient_id", "created_at", "id");
CREATE INDEX "notifications_recipient_id_read_at_idx" ON "notifications"("recipient_id", "read_at");
CREATE INDEX "notifications_actor_id_idx" ON "notifications"("actor_id");

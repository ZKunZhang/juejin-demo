ALTER TABLE "pulses" ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0 CHECK ("view_count" >= 0);

CREATE TABLE "pulse_view_windows" (
  "pulse_id" UUID NOT NULL REFERENCES "pulses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "viewer_key" TEXT NOT NULL,
  "last_counted_at" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("pulse_id", "viewer_key")
);

CREATE INDEX "pulse_view_windows_last_counted_at_idx" ON "pulse_view_windows"("last_counted_at");

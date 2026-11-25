-- CreateTable
CREATE TABLE "pulses" (
    "id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pulse_tags" (
    "pulse_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "pulse_tags_pkey" PRIMARY KEY ("pulse_id","tag_id")
);

-- CreateTable
CREATE TABLE "pulse_likes" (
    "user_id" UUID NOT NULL,
    "pulse_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pulse_likes_pkey" PRIMARY KEY ("user_id","pulse_id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "user_id" UUID NOT NULL,
    "local_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("user_id","local_date")
);

-- CreateIndex
CREATE INDEX "pulses_created_at_id_idx" ON "pulses"("created_at", "id");

-- CreateIndex
CREATE INDEX "pulses_author_id_created_at_idx" ON "pulses"("author_id", "created_at");

-- CreateIndex
CREATE INDEX "pulse_tags_tag_id_pulse_id_idx" ON "pulse_tags"("tag_id", "pulse_id");

-- CreateIndex
CREATE INDEX "pulse_likes_pulse_id_user_id_idx" ON "pulse_likes"("pulse_id", "user_id");

-- AddForeignKey
ALTER TABLE "pulses" ADD CONSTRAINT "pulses_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_tags" ADD CONSTRAINT "pulse_tags_pulse_id_fkey" FOREIGN KEY ("pulse_id") REFERENCES "pulses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_tags" ADD CONSTRAINT "pulse_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_likes" ADD CONSTRAINT "pulse_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pulse_likes" ADD CONSTRAINT "pulse_likes_pulse_id_fkey" FOREIGN KEY ("pulse_id") REFERENCES "pulses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pulses" ADD CONSTRAINT "pulses_content" CHECK (cardinality("images") <= 4 AND (length(btrim("body")) > 0 OR cardinality("images") > 0));

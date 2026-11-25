CREATE TABLE "course_lesson_comments" (
    "id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "course_lesson_comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "course_lesson_comments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "course_lesson_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "course_lesson_comments_lesson_id_created_at_id_idx"
    ON "course_lesson_comments"("lesson_id", "created_at", "id");

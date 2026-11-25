import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';
import { digest, sessionName } from '../apps/api/shared/security';

const origin = 'http://127.0.0.1:5186';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');

test('chapter comments validate publication, course ownership and authenticated authors, then persist', async () => {
  const db = connectDatabase(url);
  const app = await buildApp(db, { origins: [origin] });
  const key = randomBytes(6).toString('hex');
  const userIds: string[] = [];
  let categoryId: string | undefined;
  async function actor(name: string) {
    const token = randomBytes(32).toString('hex');
    const user = await db.user.create({ data: {
      username: 'lesson_' + key + name, displayName: name, passwordHash: 'fixture',
      sessions: { create: { tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } },
    } });
    userIds.push(user.id);
    const csrf = await app.inject('/api/auth/csrf');
    const cookie = [sessionName + '=' + token, ...[csrf.headers['set-cookie'] || []].flat().map(value => value.split(';')[0])].join('; ');
    return { user, headers: { cookie, origin, 'x-csrf-token': csrf.json().csrfToken } };
  }
  try {
    const author = await actor('author');
    const reader = await actor('reader');
    categoryId = (await db.courseCategory.create({ data: { name: key, slug: key } })).id;
    const data = { authorId: author.user.id, categoryId, title: key, summary: '说明', description: '介绍', publishedAt: new Date(), level: 'BEGINNER' as const, status: 'PUBLISHED' as const };
    const course = await db.course.create({ data: { ...data, lessons: { create: [
      { position: 1, title: '第一章', body: '正文', status: 'PUBLISHED' },
      { position: 2, title: '第二章', body: '正文', status: 'PUBLISHED' },
      { position: 3, title: '未发布', body: '草稿', status: 'DRAFT' },
    ] } }, include: { lessons: { orderBy: { position: 'asc' } } } });
    const other = await db.course.create({ data });
    const path = '/api/courses/' + course.id + '/lessons/' + course.lessons[0].id + '/comments';
    const post = (body: Record<string, unknown>, headers = reader.headers) => app.inject({ method: 'POST', url: path, headers, payload: body });
    expect((await app.inject(path)).json()).toEqual([]);
    expect((await post({ body: '游客' }, { ...reader.headers, cookie: reader.headers.cookie.split('; ').slice(1).join('; ') })).statusCode).toBe(401);
    for (const body of [{ body: '   ' }, { body: 'x'.repeat(2001) }, { body: '冒用作者', authorId: author.user.id }]) {
      expect((await post(body)).statusCode).toBe(400);
    }
    expect((await post({ body: '  读者的评论  ' })).statusCode).toBe(201);
    expect((await post({ body: '作者的评论' }, author.headers)).statusCode).toBe(201);
    const rows = (await app.inject(path)).json();
    expect(rows.map((row: { body: string; author: { id: string } }) => [row.body, row.author.id])).toEqual([
      ['读者的评论', reader.user.id], ['作者的评论', author.user.id],
    ]);
    expect(await db.courseLessonComment.count({ where: { lessonId: course.lessons[0].id } })).toBe(2);
    const secondPath = path.replace(course.lessons[0].id, course.lessons[1].id);
    expect((await app.inject(secondPath)).json()).toEqual([]);
    for (const hiddenPath of [path.replace(course.id, other.id), path.replace(course.lessons[0].id, course.lessons[2].id)]) {
      expect((await app.inject(hiddenPath)).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: hiddenPath, headers: reader.headers, payload: { body: '禁止写入' } })).statusCode).toBe(404);
    }
    await db.course.update({ where: { id: course.id }, data: { status: 'UNLISTED' } });
    expect((await app.inject(path)).statusCode).toBe(404);
    expect((await post({ body: '下架后' })).statusCode).toBe(404);
  } finally {
    await db.courseLessonComment.deleteMany({ where: { authorId: { in: userIds } } });
    await db.course.deleteMany({ where: { authorId: { in: userIds } } });
    if (categoryId) await db.courseCategory.delete({ where: { id: categoryId } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
    await db.$disconnect();
  }
});

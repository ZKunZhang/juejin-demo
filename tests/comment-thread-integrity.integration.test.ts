import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { connectDatabase } from '../apps/api/shared/db';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');
}

test('PostgreSQL keeps article and pulse replies within the same two-level thread', async () => {
  const db = connectDatabase(url);
  try {
    await db.$transaction(async tx => {
      const user = await tx.user.create({ data: {
        username: 'thread_' + randomUUID().slice(0, 8), displayName: '评论测试', passwordHash: 'fixture',
      } });
      const fixture = { authorId: user.id, title: '评论测试', bodyMarkdown: '测试正文' };
      const pulseFixture = { authorId: user.id, body: '测试沸点' };
      const articles = await tx.article.createManyAndReturn({ data: [fixture, fixture] });
      const pulses = await tx.pulse.createManyAndReturn({ data: [pulseFixture, pulseFixture] });

      for (const [table, column, first, second] of [
        ['comments', 'article_id', articles[0].id, articles[1].id],
        ['pulse_comments', 'pulse_id', pulses[0].id, pulses[1].id],
      ]) {
        // Only fixed table and column identifiers are interpolated. All values are bound.
        const insert = (id: string, contentId: string, parentId: string | null) => tx.$executeRawUnsafe(
          `INSERT INTO ${table} (id, ${column}, author_id, parent_id, body${table === 'comments' ? ', updated_at' : ''})
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, '测试'${table === 'comments' ? ', now()' : ''})`,
          id, contentId, user.id, parentId,
        );
        const root = randomUUID();
        const reply = randomUUID();
        const sibling = randomUUID();
        await insert(root, first, null);
        await insert(sibling, first, null);
        await insert(reply, first, root);
        const self = randomUUID();
        const invalidWrites = [
          () => insert(randomUUID(), second, root),
          () => insert(randomUUID(), first, reply),
          () => insert(self, first, self),
          () => tx.$executeRawUnsafe(`UPDATE ${table} SET parent_id = $1::uuid WHERE id = $2::uuid`, sibling, root),
          () => tx.$executeRawUnsafe(`UPDATE ${table} SET ${column} = $1::uuid WHERE id = $2::uuid`, second, root),
        ];
        for (const write of invalidWrites) {
          await tx.$executeRawUnsafe('SAVEPOINT invalid_thread');
          await expect(write()).rejects.toMatchObject({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23514' } } } });
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_thread');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_thread');
        }
        expect(await tx.$executeRawUnsafe(`UPDATE ${table} SET status = 'HIDDEN' WHERE id = $1::uuid`, root)).toBe(1);
        if (table === 'comments') {
          await tx.$executeRawUnsafe('SAVEPOINT restrict_delete');
          await expect(tx.$executeRawUnsafe('DELETE FROM comments WHERE id = $1::uuid', root))
            .rejects.toMatchObject({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23001' } } } });
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT restrict_delete');
        } else {
          expect(await tx.$executeRawUnsafe('DELETE FROM pulse_comments WHERE id = $1::uuid', root)).toBe(1);
          expect(await tx.pulseComment.findUnique({ where: { id: reply } })).toBeNull();
        }
      }
      throw new Error('ROLLBACK_THREAD_FIXTURE');
    }).catch(error => {
      if (!(error instanceof Error) || error.message !== 'ROLLBACK_THREAD_FIXTURE') throw error;
    });
  } finally {
    await db.$disconnect();
  }
});

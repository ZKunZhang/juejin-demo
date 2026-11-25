import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { ApiError, type security } from './security';
import { missing, object, uuid } from './articles';

type Publication = { actorId: string; targetId: string; kind: 'ARTICLE_PUBLISHED' | 'PULSE_PUBLISHED'; content: string };
const pageSize = 20;
const kindSchema = { enum: ['ARTICLE_PUBLISHED', 'PULSE_PUBLISHED'] };
type Kind=Publication['kind'];

export async function notifyFollowers(tx: Prisma.TransactionClient, { actorId, targetId, kind, content }: Publication) {
  const preview = Array.from(content.trim()).slice(0, 180).join('');
  await tx.$executeRaw`
    INSERT INTO notifications (recipient_id, actor_id, kind, target_id, preview)
    SELECT follows.follower_id, ${actorId}::uuid, ${kind}::"NotificationKind", ${targetId}::uuid, ${preview}
    FROM user_follows follows
    JOIN users recipient ON recipient.id = follows.follower_id AND recipient.status = 'ACTIVE'
    WHERE follows.followee_id = ${actorId}::uuid
    ON CONFLICT (recipient_id, kind, target_id) DO NOTHING
  `;
}

function decodeCursor(raw: string) {
  try {
    const [time, id] = JSON.parse(Buffer.from(raw, 'base64url').toString());
    const createdAt = new Date(time);
    if (typeof time !== 'string' || !Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== time
      || typeof id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new Error();
    return { createdAt, id };
  } catch {
    throw new ApiError(400, 'INVALID_CURSOR', '分页参数无效');
  }
}

export function registerNotifications(app: FastifyInstance, db: PrismaClient, auth: ReturnType<typeof security>, write: preHandlerHookHandler[]) {
  const prefix = '/api/me/notifications';
  app.get(prefix + '/unread', { preHandler: auth.requireUser }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const counts = await db.notification.groupBy({by:['kind'],where:{recipientId:request.actor!.id,readAt:null},_count:{_all:true}});
    const byKind={ARTICLE_PUBLISHED:0,PULSE_PUBLISHED:0};
    for(const row of counts)byKind[row.kind]=row._count._all;
    return {count:byKind.ARTICLE_PUBLISHED+byKind.PULSE_PUBLISHED,byKind};
  });
  app.get<{ Querystring: { cursor?: string; kind?: Kind } }>(prefix, {
    preHandler: auth.requireUser,
    schema: { querystring: object({ cursor: { type: 'string', maxLength: 256 }, kind:kindSchema }, []) },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const after = request.query.cursor ? decodeCursor(request.query.cursor) : null;
    const rows = await db.notification.findMany({
      where: {
        recipientId: request.actor!.id,kind:request.query.kind,
        ...(after ? { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] } : {}),
      },
      select: { id: true, kind: true, targetId: true, preview: true, createdAt: true, readAt: true, actor: { select: { displayName: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pageSize + 1,
    });
    const more = rows.length > pageSize;
    if (more) rows.pop();
    const last = rows.at(-1);
    return { items: rows, nextCursor: more && last ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url') : null };
  });
  app.put<{ Params: { id: string } }>(prefix + '/:id/read', {
    preHandler: [...write, auth.requireUser],
    schema: { params: object({ id: uuid }) },
  }, async (request, reply) => {
    const where = { id: request.params.id, recipientId: request.actor!.id };
    const updated = await db.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } });
    if (!updated.count && !await db.notification.findFirst({ where, select: { id: true } })) throw missing();
    return reply.code(204).send();
  });
  app.post<{Querystring:{kind?:Kind}}>(prefix + '/read-all', {
    preHandler: [...write, auth.requireUser],schema:{querystring:object({kind:kindSchema},[])},
  }, async (request, reply) => {
    await db.notification.updateMany({ where: { recipientId: request.actor!.id, readAt: null, kind:request.query.kind }, data: { readAt: new Date() } });
    return reply.code(204).send();
  });
}

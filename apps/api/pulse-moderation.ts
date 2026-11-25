import { adminCreatedAt, adminDateSchema, type AdminDateQuery } from './admin-date-range';
import { notifyFollowers } from './notifications';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { PrismaClient, PulseStatus, CommentStatus } from '../../generated/prisma/client';
import { ApiError, security } from './security';
import { authorSelect, conflict, missing, object, uuid } from './articles';
import { commentSearch, commentSearchSchema } from './comment-search';

const params = object({ id: uuid });
const pulseStatus = { enum: ['PENDING', 'PUBLISHED', 'REJECTED', 'UNLISTED'] };
const commentStatus = { enum: ['VISIBLE', 'HIDDEN'] };
const page = { type: 'string', pattern: '^[1-9][0-9]{0,3}$' };
const reasonField = { type: 'string', maxLength: 1000 };
const pageSize = 30;
const newest = [{ createdAt: 'desc' }, { id: 'desc' }] as const;
type Review<T> = { expectedStatus: T; status: T; reason?: string };

function reviewReason(value: string | undefined, required: boolean) {
  const reason = value?.trim() || null;
  if (required && !reason) throw new ApiError(400, 'REASON_REQUIRED', '请填写操作原因');
  return reason;
}

export function registerPulseModeration(app: FastifyInstance, db: PrismaClient,
  auth: ReturnType<typeof security>, protectedWrite: preHandlerHookHandler[]) {
  const write = [...protectedWrite, auth.requireAdmin];
  app.get<{ Querystring: { status?: PulseStatus; page?: string; featured?: 'true' | 'false' } & AdminDateQuery }>('/api/admin/pulses', {
    preHandler: auth.requireAdmin, schema: { querystring: object({ status: pulseStatus, page, featured: { enum: ['true', 'false'] }, ...adminDateSchema }, []) },
  }, async request => {
    const { status, featured } = request.query;
    const rows = await db.pulse.findMany({
      where: { status, featured: featured === undefined ? undefined : featured === 'true', createdAt: adminCreatedAt(request.query) },
      select: { id: true, body: true, images: true, createdAt: true, status: true, featured: true, reviewReason: true,
        viewCount: true, author: { select: authorSelect }, _count: { select: { comments: true } } },
      orderBy: [...newest], skip: (Number(request.query.page || 1) - 1) * pageSize, take: pageSize + 1,
    });
    return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
  });

  app.patch<{ Params: { id: string }; Body: { expectedFeatured: boolean; featured: boolean } }>('/api/admin/pulses/:id/featured', {
    preHandler: write, schema: { params, body: object({ expectedFeatured: { type: 'boolean' }, featured: { type: 'boolean' } }) },
  }, async request => {
    const { id } = request.params;
    const { expectedFeatured, featured } = request.body;
    if (expectedFeatured === featured) throw new ApiError(400, 'INVALID_TRANSITION', '请选择不同的精选状态');
    const updated = await db.pulse.updateMany({
      where: { id, status: 'PUBLISHED', featured: expectedFeatured },
      data: { featured },
    });
    if (!updated.count) {
      if (!await db.pulse.findUnique({ where: { id }, select: { id: true } })) throw missing();
      throw conflict();
    }
    return { id, featured };
  });

  app.patch<{ Params: { id: string }; Body: Review<PulseStatus> }>('/api/admin/pulses/:id/status', {
    preHandler: write, schema: { params, body: object({ expectedStatus: pulseStatus, status: pulseStatus, reason: reasonField }, ['expectedStatus', 'status']) },
  }, async request => {
    const { id } = request.params;
    const { expectedStatus, status } = request.body;
    const canReview = expectedStatus === 'PENDING' && (status === 'PUBLISHED' || status === 'REJECTED');
    const canUnlist = expectedStatus === 'PUBLISHED' && status === 'UNLISTED';
    if (!canReview && !canUnlist) throw new ApiError(400, 'INVALID_TRANSITION', '不支持此审核操作');
    const reason = reviewReason(request.body.reason, status !== 'PUBLISHED');
    return db.$transaction(async tx => {
      const updated = await tx.pulse.updateMany({ where: { id, status: expectedStatus }, data: { status, reviewReason: reason } });
      if (!updated.count) {
        if (!await tx.pulse.findUnique({ where: { id }, select: { id: true } })) throw missing();
        throw conflict();
      }
      await tx.pulseReview.create({ data: { pulseId: id, adminId: request.actor!.id, fromStatus: expectedStatus, toStatus: status, reason } });
      if (status === 'PUBLISHED') {
        const pulse = await tx.pulse.findUniqueOrThrow({where:{id},select:{authorId:true,body:true}});
        await notifyFollowers(tx,{actorId:pulse.authorId,targetId:id,kind:'PULSE_PUBLISHED',content:pulse.body||'图片沸点'});
      }
      return { id, status };
    });
  });

  app.get<{ Querystring: { q?: string } }>('/api/admin/pulse-comments/sources', {
    preHandler: auth.requireAdmin, schema: { querystring: object({ q: commentSearchSchema }, []) },
  }, async request => {
    const search = commentSearch(request.query.q);
    const rows = await db.pulse.findMany({
      where: { comments: { some: {} }, OR: search ? [{ body: search.text }, ...(search.id ? [{ id: search.id }] : [])] : undefined },
      select: { id: true, body: true }, orderBy: [...newest], take: 20,
    });
    return rows.map(row => {
      const body = row.body.trim();
      return { id: row.id, label: body ? body.slice(0, 80) + (body.length > 80 ? '…' : '') : '图片沸点 · ' + row.id.slice(0, 8) };
    });
  });
  app.get<{ Querystring: { status?: CommentStatus; page?: string; pulseId?: string; q?: string } & AdminDateQuery }>('/api/admin/pulse-comments', {
    preHandler: auth.requireAdmin, schema: { querystring: object({ status: commentStatus, page, pulseId: uuid, q: commentSearchSchema, ...adminDateSchema }, []) },
  }, async request => {
    const search = commentSearch(request.query.q);
    const rows = await db.pulseComment.findMany({
      where: { status: request.query.status, pulseId: request.query.pulseId, createdAt: adminCreatedAt(request.query),
        OR: search ? [{ body: search.text }, { pulse: { body: search.text } }, ...(search.id ? [{ pulseId: search.id }] : [])] : undefined },
      select: { id: true, body: true, status: true, createdAt: true, author: { select: authorSelect }, pulse: { select: { id: true, body: true } } },
      orderBy: [...newest], skip: (Number(request.query.page || 1) - 1) * pageSize, take: pageSize + 1,
    });
    return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
  });

  app.patch<{ Params: { id: string }; Body: Review<CommentStatus> }>('/api/admin/pulse-comments/:id/status', {
    preHandler: write, schema: { params, body: object({ expectedStatus: commentStatus, status: commentStatus, reason: reasonField }, ['expectedStatus', 'status']) },
  }, async request => {
    const { id } = request.params;
    const { expectedStatus, status } = request.body;
    if (expectedStatus === status) throw new ApiError(400, 'INVALID_TRANSITION', '请选择不同的目标状态');
    const reason = reviewReason(request.body.reason, status === 'HIDDEN');
    return db.$transaction(async tx => {
      const updated = await tx.pulseComment.updateMany({ where: { id, status: expectedStatus }, data: { status } });
      if (!updated.count) {
        if (!await tx.pulseComment.findUnique({ where: { id }, select: { id: true } })) throw missing();
        throw conflict();
      }
      await tx.pulseCommentReview.create({ data: { commentId: id, adminId: request.actor!.id, fromStatus: expectedStatus, toStatus: status, reason } });
      return { id, status };
    });
  });
}

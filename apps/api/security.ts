import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';
import type { PrismaClient } from '../../generated/prisma/client';

export const hashPassword = (password: string) => hash(password, { type: argon2id });
export const verifyPassword = verify;
export const digest = (token: string) => createHash('sha256').update(token).digest('hex');
export const sessionName = 'mazhan_session';
export const sessionAge = 7 * 86400;
export const userFields = { id: true, username: true, displayName: true, role: true } as const;
export type SafeUser = { id: string; username: string; displayName: string; role: 'ADMIN' | 'USER' };

declare module 'fastify' {
  interface FastifyRequest {
    actor: SafeUser | null;
  }
}

export class ApiError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

export function security(db: PrismaClient, origins: string[], secure: boolean) {
  const cookieOptions = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  async function findActor(request: FastifyRequest) {
    const token = request.cookies[sessionName];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await db.session.findFirst({
      where: { tokenHash: digest(token), revokedAt: null, expiresAt: { gt: new Date() }, user: { status: 'ACTIVE' } },
      select: { user: { select: userFields } },
    });
    return session?.user ?? null;
  }

  async function requireUser(request: FastifyRequest) {
    request.actor = await findActor(request);
    if (!request.actor) throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
  }

  async function requireAdmin(request: FastifyRequest) {
    await requireUser(request);
    if (request.actor?.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', '需要管理员权限');
  }

  async function requireOrigin(request: FastifyRequest) {
    const origin = request.headers.origin;
    if (!origin || !origins.includes(origin) || request.headers['sec-fetch-site'] === 'cross-site') {
      throw new ApiError(403, 'ORIGIN_FORBIDDEN', '请求来源无效');
    }
  }

  function clearSession(reply: FastifyReply) {
    reply.clearCookie(sessionName, cookieOptions);
  }

  return { findActor, requireUser, requireAdmin, requireOrigin, cookieOptions, clearSession };
}

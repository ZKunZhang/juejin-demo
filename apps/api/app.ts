import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import csrf from '@fastify/csrf-protection';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client';
import { registerArticleViews } from './article-views';
import { registerCreator } from './creator';
import { registerCourses } from './courses';
import { registerPulses } from './pulses';
import { registerActivities } from './activities';
import { registerInteractions } from './interactions';
import { registerModeration } from './moderation';
import { registerArticles } from './articles';
import { ApiError, digest, hashPassword, verifyPassword, sessionAge, sessionName, security, userFields } from './security';

const username = { type: 'string', pattern: '^[a-zA-Z0-9_]{3,32}$' };
const password = { type: 'string', minLength: 8, maxLength: 128 };
const displayName = { type: 'string', minLength: 1, maxLength: 80, pattern: '\\S' };
const userSchema = {
  type: 'object', required: ['id', 'username', 'displayName', 'role'],
  properties: {
    id: { type: 'string' }, username: { type: 'string' }, displayName: { type: 'string' }, role: { enum: ['USER', 'ADMIN'] },
  },
};
const bodySchema = (properties: Record<string, unknown>) => ({
  type: 'object', additionalProperties: false, required: Object.keys(properties), properties,
});
const isDuplicate = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';

export async function buildApp(db: PrismaClient, options: { origins: string[]; secure?: boolean; logger?: boolean }) {
  const app = Fastify({
    logger: options.logger ? { redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token', 'res.headers.set-cookie'] } : false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
    bodyLimit: 256 * 1024,
  });
  const auth = security(db, options.origins, options.secure ?? false);
  app.decorateRequest('actor', null);
  await app.register(cookie);
  await app.register(csrf, {
    cookieOpts: { ...auth.cookieOptions, signed: false },
    getToken: request => {
      const value = request.headers['x-csrf-token'];
      return typeof value === 'string' ? value : undefined;
    },
  });
  await app.register(rateLimit, { global: false });
  await app.register(swagger, { openapi: { info: { title: '码栈 API', version: '0.3.0' } } });

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ code: error.code }, 'Request failed');
    const code = error instanceof ApiError ? error.code : error.validation ? 'VALIDATION_ERROR' : error.code || 'REQUEST_FAILED';
    const message = error instanceof ApiError ? error.message : status === 400 ? '请检查输入内容' : status === 403 ? '请求校验失败，请刷新后重试' : status === 429 ? '操作过于频繁，请稍后再试' : '请求未能完成';
    reply.code(status).send({ error: { code, message } });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在' } }));

  const protectedWrite = [auth.requireOrigin, app.csrfProtection];
  const limits = { rateLimit: { max: 12, timeWindow: '1 minute' } };
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const rotateSession = async (request: FastifyRequest, userId: string) => {
    const token = randomBytes(32).toString('hex');
    const old = request.cookies[sessionName];
    await db.$transaction(async tx => {
      if (old && /^[a-f0-9]{64}$/.test(old)) {
        await tx.session.updateMany({ where: { tokenHash: digest(old), revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.session.create({ data: { userId, tokenHash: digest(token), expiresAt: new Date(Date.now() + sessionAge * 1000) } });
    });
    return token;
  };

  app.get('/api/auth/csrf', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { csrfToken: await reply.generateCsrf() };
  });
  app.post<{ Body: { username: string; password: string; displayName: string } }>('/api/auth/register', {
    preHandler: protectedWrite, config: limits,
    schema: { body: bodySchema({ username, password, displayName }), response: { 201: userSchema } },
  }, async (request, reply) => {
    const { username, password, displayName } = request.body;
    const passwordHash = await hashPassword(password);
    const token = randomBytes(32).toString('hex');
    try {
      const old = request.cookies[sessionName];
      const user = await db.$transaction(async tx => {
        if (old && /^[a-f0-9]{64}$/.test(old)) {
          await tx.session.updateMany({ where: { tokenHash: digest(old), revokedAt: null }, data: { revokedAt: new Date() } });
        }
        return tx.user.create({
          data: { username: username.toLowerCase(), passwordHash, displayName: displayName.trim(),
            sessions: { create: { tokenHash: digest(token), expiresAt: new Date(Date.now() + sessionAge * 1000) } } },
          select: userFields,
        });
      });
      return reply.code(201).setCookie(sessionName, token, { ...auth.cookieOptions, maxAge: sessionAge }).send(user);
    } catch (error) {
      if (isDuplicate(error)) throw new ApiError(409, 'USERNAME_TAKEN', '该用户名已被注册');
      throw error;
    }
  });
  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', {
    preHandler: protectedWrite, config: limits,
    schema: { body: bodySchema({ username, password }), response: { 200: userSchema } },
  }, async (request, reply) => {
    const account = await db.user.findUnique({ where: { username: request.body.username.toLowerCase() } });
    const valid = await verifyPassword(account?.passwordHash ?? dummyHash, request.body.password);
    if (!valid || account?.status !== 'ACTIVE') throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
    const token = await rotateSession(request, account.id);
    return reply.setCookie(sessionName, token, { ...auth.cookieOptions, maxAge: sessionAge }).send(account);
  });
  app.get('/api/auth/me', { preHandler: auth.requireUser, schema: { response: { 200: userSchema } } }, async (request, reply) => {
    return reply.header('Cache-Control', 'no-store').send(request.actor);
  });
  app.post('/api/auth/logout', { preHandler: [...protectedWrite, auth.requireUser] }, async (request, reply) => {
    const token = request.cookies[sessionName]!;
    await db.session.updateMany({ where: { tokenHash: digest(token), revokedAt: null }, data: { revokedAt: new Date() } });
    auth.clearSession(reply);
    return reply.code(204).send();
  });
  registerArticles(app, db, auth, protectedWrite, options.secure ?? false);
  registerArticleViews(app, db, protectedWrite);
  registerModeration(app, db, auth, protectedWrite);
  registerInteractions(app, db, auth, protectedWrite);
  registerActivities(app, db, auth, protectedWrite);
  registerPulses(app, db, auth, protectedWrite);
  registerCourses(app, db);
  registerCreator(app, db, auth);
  app.get('/api/openapi.json', async () => app.swagger());
  return app;
}

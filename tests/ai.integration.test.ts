import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { buildApp } from '../apps/api/app/app';
import { connectDatabase } from '../apps/api/shared/db';
import { digest, sessionName } from '../apps/api/shared/security';

const origin = 'http://127.0.0.1:5173';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('Use a dedicated TEST_DATABASE_URL ending in _test');

test('AI import uses exact historical costs, source ownership, opt-in privacy and idempotency', async () => {
  const db = connectDatabase(testUrl);
  const app = await buildApp(db, { origins: [origin] });
  const key = randomBytes(6).toString('hex');
  const users: string[] = [];
  let modelId: string | undefined;
  let providerId: string | undefined;
  let toolId: string | undefined;
  async function identity(suffix: string, role: 'ADMIN' | 'USER') {
    const token = randomBytes(32).toString('hex');
    const user = await db.user.create({ data: {
      username: 'ai_' + key + suffix, displayName: suffix, passwordHash: 'test-fixture', role,
      sessions: { create: { tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } },
    } });
    users.push(user.id);
    const cookie = sessionName + '=' + token;
    const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf', headers: { cookie } });
    const cookies = [csrf.headers['set-cookie'] || []].flat().map(value => value.split(';')[0]);
    return { headers: { cookie: [cookie, ...cookies].join('; '), origin, 'x-csrf-token': csrf.json().csrfToken }, id: user.id };
  }
  try {
    const [admin, owner, other] = await Promise.all([identity('admin', 'ADMIN'), identity('owner', 'USER'), identity('other', 'USER')]);
    const catalog = (payload: object, headers = admin.headers) => app.inject({ method: 'POST', url: '/api/admin/ai/catalog', payload, headers });
    expect((await catalog({ kind: 'provider', name: 'Provider', slug: 'ai-' + key }, owner.headers)).statusCode).toBe(403);
    const provider = await catalog({ kind: 'provider', name: 'Provider ' + key, slug: 'ai-' + key });
    expect(provider.statusCode).toBe(201);
    providerId = provider.json().id;
    const model = await catalog({ kind: 'model', name: 'Model ' + key, modelKey: key, providerId });
    expect(model.statusCode).toBe(201);
    modelId = model.json().id;
    const tool = await catalog({ kind: 'tool', name: 'Tool ' + key, slug: 'tool-' + key });
    expect(tool.statusCode).toBe(201);
    toolId = tool.json().id;
    expect((await catalog({ kind: 'tool', name: 'Duplicate', slug: 'tool-' + key })).statusCode).toBe(409);
    const now = new Date();
    const local = new Date(now.getTime() + 8 * 3600000);
    const boundary = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000);
    const price = {
      modelId, currency: 'USD', effectiveFrom: '1970-01-01T00:00:00Z', effectiveTo: boundary.toISOString(),
      inputPrice: '1', outputPrice: '4', cacheReadPrice: '1', cacheWritePrice: null, sourceUrl: 'https://example.com/prices',
    };
    const savePrice = (payload: object) => app.inject({ method: 'POST', url: '/api/admin/ai/prices', payload, headers: admin.headers });
    expect((await savePrice(price)).statusCode).toBe(201);
    expect((await savePrice({ ...price, effectiveFrom: boundary.toISOString(), effectiveTo: null, inputPrice: '2' })).statusCode).toBe(201);
    expect((await savePrice({ ...price, effectiveTo: null })).statusCode).toBe(409);
    const current = await app.inject({ method: 'GET', url: '/api/ai/prices?provider=' + providerId });
    expect(current.statusCode).toBe(200);
    expect(current.json().items).toHaveLength(1);
    expect(current.json().items[0].inputPrice).toBe('2');
    const createSource = await app.inject({ method: 'POST', url: '/api/me/ai/sources', headers: owner.headers, payload: { toolId, label: 'Local import' } });
    expect(createSource.statusCode).toBe(201);
    const sourceId = createSource.json().id;
    const prior = {
      sourceEventKey: 'before', modelId, occurredAt: new Date(boundary.getTime() - 1).toISOString(),
      inputTokens: '1000000', unclassifiedInputTokens: '0', outputTokens: '0', cacheReadTokens: '0', cacheWriteTokens: '0',
    };
    const recent = { ...prior, sourceEventKey: 'after', occurredAt: new Date(boundary.getTime() + 1).toISOString(), outputTokens: '500000', cacheReadTokens: '250000' };
    const send = (events: object[], headers = owner.headers) => app.inject({ method: 'POST', url: '/api/me/ai/events', headers, payload: { sourceId, events } });
    expect((await send([recent], other.headers)).statusCode).toBe(404);
    const replay = await Promise.all([send([prior, recent]), send([prior, recent])]);
    expect(replay.map(response => response.statusCode)).toEqual([200, 200]);
    expect(replay.reduce((count, response) => count + response.json().inserted, 0)).toBe(2);
    expect(replay.reduce((count, response) => count + response.json().duplicates, 0)).toBe(2);
    expect((await send([{ ...recent, inputTokens: '2' }])).statusCode).toBe(409);
    expect(await db.aiUsageEvent.count({ where: { sourceId } })).toBe(2);
    const usage = await app.inject({ method: 'GET', url: '/api/me/ai/usage', headers: owner.headers });
    expect(usage.statusCode).toBe(200);
    expect(usage.json().totalTokens).toBe('1750000');
    expect(Number(usage.json().estimatedCostUsd)).toBe(4.25);
    expect(usage.json().daily[0].date).toBe(new Date(boundary.getTime() + 8 * 3600000).toISOString().slice(0, 10));
    expect(usage.json().publicLeaderboard).toBe(false);
    const all = await app.inject({ method: 'GET', url: '/api/me/ai/usage?period=7d', headers: owner.headers });
    expect(all.json().totalTokens).toBe('2750000');
    expect(Number(all.json().estimatedCostUsd)).toBe(5.25);
    const privateBoard = await app.inject({ method: 'GET', url: '/api/ai/leaderboard?period=all' });
    expect(privateBoard.json().items.some((row: { userId: string }) => row.userId === owner.id)).toBe(false);
    const preference = (publicLeaderboard: boolean) => app.inject({ method: 'PUT', url: '/api/me/ai/preferences', headers: owner.headers, payload: { publicLeaderboard } });
    expect((await preference(true)).statusCode).toBe(200);
    const publicBoard = await app.inject({ method: 'GET', url: '/api/ai/leaderboard?period=all&modelId=' + modelId });
    expect(publicBoard.statusCode).toBe(200);
    expect(publicBoard.json().items[0].totalTokens).toBe('2750000');
    const hidden = await app.inject({ method: 'GET', url: '/api/ai/leaderboard?period=all&hideSelf=true&modelId=' + modelId, headers: owner.headers });
    expect(hidden.json().items).toEqual([]);
    const unknown = { ...recent, sourceEventKey: 'unknown', inputTokens: '0', unclassifiedInputTokens: '1', outputTokens: '0', cacheReadTokens: '0' };
    expect((await send([unknown])).statusCode).toBe(200);
    const unknownTotal = await app.inject({ method: 'GET', url: '/api/me/ai/usage', headers: owner.headers });
    expect(unknownTotal.json().estimatedCostUsd).toBeNull();
    const expenseBoard = await app.inject({ method: 'GET', url: '/api/ai/leaderboard?period=all&sort=cost&modelId=' + modelId });
    expect(expenseBoard.json().items).toEqual([]);
    expect((await preference(false)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/ai/leaderboard?period=all&modelId=' + modelId })).json().items).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: '/api/me/ai/sources/' + sourceId, headers: other.headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/me/ai/sources/' + sourceId, headers: owner.headers })).statusCode).toBe(204);
    expect((await send([recent])).statusCode).toBe(404);
  } finally {
    await db.user.deleteMany({ where: { id: { in: users } } });
    if (modelId) {
      await db.aiModelPrice.deleteMany({ where: { modelId } });
      await db.aiModel.deleteMany({ where: { id: modelId } });
    }
    if (providerId) await db.aiProvider.deleteMany({ where: { id: providerId } });
    if (toolId) await db.aiTool.deleteMany({ where: { id: toolId } });
    await app.close();
    await db.$disconnect();
  }
});

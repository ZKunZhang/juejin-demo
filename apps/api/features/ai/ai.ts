import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { Prisma, type PrismaClient } from '../../../../generated/prisma/client';
import { missing, object, uuid } from '../../shared/http';
import { ApiError, security } from '../../shared/security';

const Money = Prisma.Decimal.clone({ precision: 60 });
const name = (length: number) => ({ type: 'string', minLength: 1, maxLength: length, pattern: '\\S' });
const tokenSchema = { type: 'string', pattern: '^(0|[1-9][0-9]{0,12})$' };
const priceSchema = { type: 'string', pattern: '^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,8})?$' };
const nullablePrice = { anyOf: [priceSchema, { type: 'null' }] };
const idSchema = object({ id: uuid });
const tokenFields = ['inputTokens', 'unclassifiedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const;
type Tokens = Record<typeof tokenFields[number], string>;
type EventInput = Tokens & { sourceEventKey: string; modelId: string; occurredAt: string };
type PriceInput = {
  modelId: string; currency: string; effectiveFrom: string; effectiveTo: string | null;
  inputPrice: string; outputPrice: string; cacheReadPrice: string | null; cacheWritePrice: string | null; sourceUrl: string;
};
type Aggregate = { id: string; key: string; totalTokens: string; inputTokens: string; outputTokens: string; estimatedCostUsd: string | null };
const totalSql = Prisma.sql`e.input_tokens + e.unclassified_input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens`;
const inputSql = Prisma.sql`e.input_tokens + e.unclassified_input_tokens + e.cache_read_tokens + e.cache_write_tokens`;
const costSql = Prisma.sql`CASE WHEN count(*) FILTER (WHERE e.estimated_cost_usd IS NULL)>0 THEN NULL ELSE COALESCE(sum(e.estimated_cost_usd),0)::text END`;

function periodStart(period: string, now = new Date()) {
  const local = new Date(now.getTime() + 8 * 3600000);
  const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 8 * 3600000);
  if (period === 'all') return new Date('1970-01-01T00:00:00Z');
  if (period === 'week') return new Date(day.getTime() - ((local.getUTCDay() + 6) % 7) * 86400000);
  if (period === 'month') return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - 8 * 3600000);
  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 1;
  return new Date(day.getTime() - (days - 1) * 86400000);
}

function sourceUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new ApiError(400, 'INVALID_PRICE_SOURCE', '请输入有效的价格来源地址'); }
}

function duplicate(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export function registerAi(app: FastifyInstance, db: PrismaClient, auth: ReturnType<typeof security>, protectedWrite: preHandlerHookHandler[]) {
  const write = [...protectedWrite, auth.requireUser];
  const adminWrite = [...protectedWrite, auth.requireAdmin];

  app.get('/api/ai/options', async () => {
    const [providers, tools, models] = await Promise.all([
      db.aiProvider.findMany({ select: { id: true, name: true, slug: true }, orderBy: { name: 'asc' } }),
      db.aiTool.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      db.aiModel.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { providers, tools, models };
  });

  app.get<{ Querystring: { q?: string; provider?: string } }>('/api/ai/prices', {
    schema: { querystring: object({ q: { type: 'string', maxLength: 100 }, provider: uuid }, []) },
  }, async request => {
    const now = new Date();
    const word = request.query.q?.trim();
    const prices = await db.aiModelPrice.findMany({
      where: {
        effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        model: { active: true, providerId: request.query.provider,
          OR: word ? [{ name: { contains: word, mode: 'insensitive' } }, { modelKey: { contains: word, mode: 'insensitive' } }] : undefined },
      },
      include: { model: { include: { provider: true } } },
      orderBy: [{ model: { name: 'asc' } }, { currency: 'asc' }],
    });
    return { items: prices.map(price => ({
      model: { id: price.model.id, name: price.model.name, modelKey: price.model.modelKey },
      provider: price.model.provider,
      inputPrice: price.inputPrice.toString(), outputPrice: price.outputPrice.toString(),
      cacheReadPrice: price.cacheReadPrice?.toString() ?? null, cacheWritePrice: price.cacheWritePrice?.toString() ?? null,
      currency: price.currency, effectiveFrom: price.effectiveFrom, sourceUrl: price.sourceUrl,
    })) };
  });

  app.get<{ Querystring: { period?: string } }>('/api/me/ai/usage', {
    preHandler: auth.requireUser,
    schema: { querystring: object({ period: { enum: ['today', '7d', '30d', '90d'] } }, []) },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const userId = request.actor!.id;
    const start = periodStart(request.query.period ?? 'today');
    const end = new Date();
    const where = Prisma.sql`s.user_id=${userId}::uuid AND e.occurred_at>=${start} AND e.occurred_at<=${end}`;
    const aggregate = (key: Prisma.Sql, id: Prisma.Sql = key, range = where) => db.$queryRaw<Aggregate[]>(Prisma.sql`
      SELECT ${key} AS key, ${id}::text AS id, COALESCE(sum(${totalSql}),0)::text AS "totalTokens",
        COALESCE(sum(${inputSql}),0)::text AS "inputTokens", COALESCE(sum(e.output_tokens),0)::text AS "outputTokens",
        ${costSql} AS "estimatedCostUsd"
      FROM ai_usage_events e JOIN ai_usage_sources s ON s.id=e.source_id
      JOIN ai_models m ON m.id=e.model_id JOIN ai_providers ap ON ap.id=m.provider_id
      JOIN ai_tools t ON t.id=s.tool_id WHERE ${range}
      GROUP BY 1,2 ORDER BY 1,2`);
    const [totals, daily, hourly, tools, models, heatmap, preference] = await Promise.all([
      db.$queryRaw<Omit<Aggregate, 'key' | 'id'>[]>(Prisma.sql`
        SELECT COALESCE(sum(${totalSql}),0)::text AS "totalTokens", COALESCE(sum(${inputSql}),0)::text AS "inputTokens",
          COALESCE(sum(e.output_tokens),0)::text AS "outputTokens", ${costSql} AS "estimatedCostUsd"
        FROM ai_usage_events e JOIN ai_usage_sources s ON s.id=e.source_id WHERE ${where}`),
      aggregate(Prisma.sql`to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`),
      aggregate(Prisma.sql`to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD HH24:00')`),
      aggregate(Prisma.sql`t.name`, Prisma.sql`t.id`),
      aggregate(Prisma.sql`m.name || ' · ' || ap.name`, Prisma.sql`m.id`),
      aggregate(Prisma.sql`to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`,
        Prisma.sql`to_char(e.occurred_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')`,
        Prisma.sql`s.user_id=${userId}::uuid AND e.occurred_at>=${new Date(periodStart('today', end).getTime()-364*86400000)} AND e.occurred_at<=${end}`),
      db.aiUsagePreference.findUnique({ where: { userId }, select: { publicLeaderboard: true } }),
    ]);
    return {
      ...totals[0], publicLeaderboard: preference?.publicLeaderboard ?? false,
      daily: daily.map(({ key, id: _id, ...row }) => ({ date: key, ...row })),
      hourly: hourly.map(({ key, id: _id, ...row }) => ({ hour: key, ...row })),
      heatmap: heatmap.map(({ key, id: _id, ...row }) => ({ date: key, ...row })),
      tools: tools.map(({ key, ...row }) => ({ name: key, ...row })),
      models: models.map(({ key, ...row }) => ({ name: key, ...row })),
    };
  });

  app.get<{ Querystring: { period?: string; sort?: string; hideSelf?: string; toolId?: string; modelId?: string } }>('/api/ai/leaderboard', {
    schema: { querystring: object({
      period: { enum: ['today', 'week', 'month', 'all'] }, sort: { enum: ['tokens', 'cost'] },
      hideSelf: { enum: ['true', 'false'] }, toolId: uuid, modelId: uuid,
    }, []) },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const { period = 'today', sort = 'tokens', hideSelf, toolId, modelId } = request.query;
    const actor = hideSelf === 'true' ? await auth.findActor(request) : null;
    const start = periodStart(period);
    const end = new Date();
    const rows = await db.$queryRaw<{ userId: string; displayName: string; avatarUrl: string | null; totalTokens: string; estimatedCostUsd: string | null }[]>(Prisma.sql`
      SELECT u.id AS "userId",u.display_name AS "displayName",u.avatar_url AS "avatarUrl",
        sum(${totalSql})::text AS "totalTokens", ${costSql} AS "estimatedCostUsd"
      FROM ai_usage_events e JOIN ai_usage_sources s ON s.id=e.source_id
      JOIN users u ON u.id=s.user_id JOIN ai_usage_preferences p ON p.user_id=u.id
      WHERE u.status='ACTIVE' AND p.public_leaderboard=true
        AND e.occurred_at>=${start} AND e.occurred_at<=${end}
        ${actor ? Prisma.sql`AND u.id<>${actor.id}::uuid` : Prisma.empty}
        ${toolId ? Prisma.sql`AND s.tool_id=${toolId}::uuid` : Prisma.empty}
        ${modelId ? Prisma.sql`AND e.model_id=${modelId}::uuid` : Prisma.empty}
      GROUP BY u.id
      ${sort === 'cost' ? Prisma.sql`HAVING count(*) FILTER (WHERE e.estimated_cost_usd IS NULL)=0` : Prisma.empty}
      ORDER BY ${sort === 'cost' ? Prisma.sql`sum(e.estimated_cost_usd)` : Prisma.sql`sum(${totalSql})`} DESC,u.id ASC LIMIT 100`);
    return { items: rows };
  });

  app.put<{ Body: { publicLeaderboard: boolean } }>('/api/me/ai/preferences', {
    preHandler: write, schema: { body: object({ publicLeaderboard: { type: 'boolean' } }) },
  }, request => db.aiUsagePreference.upsert({
    where: { userId: request.actor!.id }, create: { userId: request.actor!.id, ...request.body }, update: request.body,
    select: { publicLeaderboard: true },
  }));

  app.get('/api/me/ai/sources', { preHandler: auth.requireUser }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    return { items: await db.aiUsageSource.findMany({
      where: { userId: request.actor!.id }, select: { id: true, label: true, tool: { select: { id: true, name: true } }, revokedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }) };
  });

  app.post<{ Body: { label: string; toolId: string } }>('/api/me/ai/sources', {
    preHandler: write, schema: { body: object({ label: name(120), toolId: uuid }) },
  }, async (request, reply) => {
    if (!await db.aiTool.findUnique({ where: { id: request.body.toolId }, select: { id: true } })) throw missing();
    const source = await db.aiUsageSource.create({
      data: { userId: request.actor!.id, toolId: request.body.toolId, label: request.body.label.trim() },
      select: { id: true, label: true, tool: { select: { id: true, name: true } }, revokedAt: true },
    });
    return reply.code(201).send(source);
  });

  app.delete<{ Params: { id: string } }>('/api/me/ai/sources/:id', {
    preHandler: write, schema: { params: idSchema },
  }, async (request, reply) => {
    const changed = await db.aiUsageSource.updateMany({
      where: { id: request.params.id, userId: request.actor!.id }, data: { revokedAt: new Date() },
    });
    if (!changed.count) throw missing();
    return reply.code(204).send();
  });

  app.post<{ Body: { sourceId: string; events: EventInput[] } }>('/api/me/ai/events', {
    preHandler: write, schema: { body: object({
      sourceId: uuid, events: { type: 'array', minItems: 1, maxItems: 100, items: object({
        sourceEventKey: name(160), modelId: uuid, occurredAt: { type: 'string', format: 'date-time' },
        ...Object.fromEntries(tokenFields.map(field => [field, tokenSchema])),
      }) },
    }) },
  }, async request => db.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM ai_usage_sources WHERE id=${request.body.sourceId}::uuid AND user_id=${request.actor!.id}::uuid AND revoked_at IS NULL FOR UPDATE`;
    if (!rows.length) throw missing();
    let inserted = 0;
    let duplicates = 0;
    for (const event of request.body.events) {
      const occurredAt = new Date(event.occurredAt);
      if (occurredAt.getTime() > Date.now() + 300000 || occurredAt.getTime() < 0) throw new ApiError(400, 'INVALID_USAGE_TIME', '用量发生时间无效');
      const counts = Object.fromEntries(tokenFields.map(field => [field, BigInt(event[field])])) as Record<typeof tokenFields[number], bigint>;
      const existing = await tx.aiUsageEvent.findUnique({
        where: { sourceId_sourceEventKey: { sourceId: request.body.sourceId, sourceEventKey: event.sourceEventKey } },
      });
      if (existing) {
        if (existing.modelId !== event.modelId || existing.occurredAt.getTime() !== occurredAt.getTime() ||
            tokenFields.some(field => existing[field] !== counts[field])) {
          throw new ApiError(409, 'USAGE_EVENT_CONFLICT', '相同事件标识对应了不同用量');
        }
        duplicates++;
        continue;
      }
      if (!await tx.aiModel.findFirst({ where: { id: event.modelId, active: true }, select: { id: true } })) throw new ApiError(400, 'INVALID_MODEL', '模型无效');
      const price = await tx.aiModelPrice.findFirst({
        where: { modelId: event.modelId, currency: 'USD', effectiveFrom: { lte: occurredAt }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: occurredAt } }] },
      });
      let cost: string | null = null;
      const canPrice = price && counts.unclassifiedInputTokens === 0n &&
        (counts.cacheReadTokens === 0n || price.cacheReadPrice !== null) && (counts.cacheWriteTokens === 0n || price.cacheWritePrice !== null);
      if (canPrice) {
        const amount = new Money(counts.inputTokens.toString()).mul(price.inputPrice.toString())
          .add(new Money(counts.outputTokens.toString()).mul(price.outputPrice.toString()))
          .add(new Money(counts.cacheReadTokens.toString()).mul(price.cacheReadPrice?.toString() ?? '0'))
          .add(new Money(counts.cacheWriteTokens.toString()).mul(price.cacheWritePrice?.toString() ?? '0')).div(1000000);
        if (amount.gte('100000000000000')) throw new ApiError(400, 'USAGE_COST_TOO_LARGE', '单条用量费用超出存储范围');
        cost = amount.toFixed(10);
      }
      await tx.aiUsageEvent.create({ data: {
        sourceId: request.body.sourceId, sourceEventKey: event.sourceEventKey, modelId: event.modelId, occurredAt, ...counts,
        priceId: price?.id ?? null, estimatedCostUsd: cost,
      } });
      inserted++;
    }
    return { inserted, duplicates };
  }, { timeout: 15000 }));

  app.post<{ Body: { kind: 'provider' | 'model' | 'tool'; name: string; slug?: string; providerId?: string; modelKey?: string } }>('/api/admin/ai/catalog', {
    preHandler: adminWrite, schema: { body: object({
      kind: { enum: ['provider', 'model', 'tool'] }, name: name(160), slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' },
      providerId: uuid, modelKey: name(160),
    }, ['kind', 'name']) },
  }, async (request, reply) => {
    const { kind, name: rawName, slug, providerId, modelKey } = request.body;
    try {
      if (kind === 'model') {
        if (!providerId || !modelKey || slug !== undefined) throw new ApiError(400, 'INVALID_CATALOG', '模型需要供应商和模型标识');
        if (!await db.aiProvider.findUnique({ where: { id: providerId }, select: { id: true } })) throw missing();
        return reply.code(201).send(await db.aiModel.create({ data: { providerId, modelKey: modelKey.trim(), name: rawName.trim() } }));
      }
      if (!slug || providerId !== undefined || modelKey !== undefined || rawName.length > 120) throw new ApiError(400, 'INVALID_CATALOG', '供应商和工具需要名称及唯一标识');
      const data = { name: rawName.trim(), slug };
      const result = kind === 'provider' ? await db.aiProvider.create({ data }) : await db.aiTool.create({ data });
      return reply.code(201).send(result);
    } catch (error) {
      if (duplicate(error)) throw new ApiError(409, 'CATALOG_EXISTS', '目录标识已存在');
      throw error;
    }
  });

  app.post<{ Body: PriceInput }>('/api/admin/ai/prices', {
    preHandler: adminWrite, schema: { body: object({
      modelId: uuid, currency: { type: 'string', pattern: '^[A-Z]{3}$' },
      effectiveFrom: { type: 'string', format: 'date-time' }, effectiveTo: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
      inputPrice: priceSchema, outputPrice: priceSchema, cacheReadPrice: nullablePrice, cacheWritePrice: nullablePrice, sourceUrl: name(2000),
    }) },
  }, async (request, reply) => {
    const { effectiveFrom, effectiveTo, sourceUrl: rawUrl, ...data } = request.body;
    const from = new Date(effectiveFrom);
    const to = effectiveTo ? new Date(effectiveTo) : null;
    if (to && to <= from) throw new ApiError(400, 'INVALID_PRICE_PERIOD', '价格结束时间必须晚于开始时间');
    const url = sourceUrl(rawUrl);
    const price = await db.$transaction(async tx => {
      const model = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ai_models WHERE id=${data.modelId}::uuid FOR UPDATE`;
      if (!model.length) throw missing();
      const overlapping = await tx.aiModelPrice.findMany({
        where: { modelId: data.modelId, currency: data.currency, effectiveFrom: to ? { lt: to } : undefined,
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: from } }] },
        select: { id: true, effectiveFrom: true, effectiveTo: true },
      });
      const previous = overlapping[0];
      const replacesOpenPrice = overlapping.length === 1 && previous.effectiveTo === null && previous.effectiveFrom < from;
      if (overlapping.length && !replacesOpenPrice) throw new ApiError(409, 'PRICE_PERIOD_CONFLICT', '该模型在此时段已有价格');
      if (replacesOpenPrice) {
        await tx.aiModelPrice.update({ where: { id: previous.id }, data: { effectiveTo: from } });
      }
      return tx.aiModelPrice.create({ data: { ...data, effectiveFrom: from, effectiveTo: to, sourceUrl: url, observedAt: new Date() } });
    });
    return reply.code(201).send(price);
  });
}

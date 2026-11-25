import { ApiError } from './security';

export type AdminDateQuery = { from?: string; to?: string };
const daySchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const adminDateSchema = { from: daySchema, to: daySchema };

function beijingMidnight(day: string) {
  const calendarDay = new Date(day + 'T00:00:00Z');
  if (!Number.isFinite(calendarDay.getTime()) || calendarDay.toISOString().slice(0, 10) !== day || day.startsWith('0000')) {
    throw new ApiError(400, 'INVALID_DATE_RANGE', '请选择有效日期');
  }
  return new Date(calendarDay.getTime() - 8 * 60 * 60 * 1000);
}

export function adminCreatedAt({ from, to }: AdminDateQuery) {
  if (!from && !to) return undefined;
  const start = from ? beijingMidnight(from) : undefined;
  const end = to ? beijingMidnight(to) : undefined;
  if (start && end && start > end) throw new ApiError(400, 'INVALID_DATE_RANGE', '结束日期不能早于开始日期');
  return { gte: start, lt: end ? new Date(end.getTime() + 86400000) : undefined };
}

export type User = { id: string; username: string; displayName: string; role: 'USER' | 'ADMIN' };

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
async function decode<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new HttpError(response.status, data?.error?.code || 'REQUEST_FAILED', data?.error?.message || '请求未能完成');
  return data as T;
}
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const { csrfToken } = await decode<{ csrfToken: string }>(await fetch('/api/auth/csrf', { credentials: 'same-origin' }));
    headers['X-CSRF-Token'] = csrfToken;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
  }
  return decode(await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body), signal }));
}

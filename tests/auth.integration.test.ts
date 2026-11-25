import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { buildApp } from '../apps/api/app';
import { connectDatabase } from '../apps/api/db';
import { digest, sessionName } from '../apps/api/security';

const origin = 'http://127.0.0.1:5173';
const username = 'test_' + randomBytes(6).toString('hex');
const password = randomBytes(14).toString('base64url');
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('A dedicated TEST_DATABASE_URL ending in _test is required');
const db = connectDatabase(testUrl);
let app: Awaited<ReturnType<typeof buildApp>>;
const client = () => new Map<string,string>();
type Jar = ReturnType<typeof client>;
const jar = client();

beforeAll(async () => { app = await buildApp(db, { origins: [origin] }); });
afterAll(async () => {
  await app.close();
  await db.user.deleteMany({ where: { username: { in: [username, username + '_bad'] } } });
  await db.$disconnect();
});
function readCookies(state: Jar, headers: string | string[] | undefined) {
  for (const item of [headers ?? []].flat()) {
    const value = item.split(';')[0];
    const separator = value.indexOf('=');
    state.set(value.slice(0, separator), value.slice(separator + 1));
  }
}
const cookieHeader = (state: Jar) => [...state].map(([key,value]) => key+'='+value).join('; ');
async function write(path: string, body?: Record<string, unknown>, state = jar, requestOrigin = origin) {
  const csrf = await app.inject({ method: 'GET', url: '/api/auth/csrf', headers: { cookie: cookieHeader(state) } });
  readCookies(state, csrf.headers['set-cookie']);
  const reply = await app.inject({ method:'POST', url: '/api/auth/'+path, payload: body,
    headers: { cookie: cookieHeader(state), origin: requestOrigin, 'x-csrf-token': csrf.json().csrfToken } });
  readCookies(state, reply.headers['set-cookie']);
  return reply;
}
const me = (state: Jar) => app.inject({ method:'GET', url:'/api/auth/me', headers:{ cookie:cookieHeader(state) } });

describe('authentication with PostgreSQL', () => {
  test('rejects invalid fields, role injection and missing CSRF without creating accounts', async () => {
    const invalid = { username: username+'_bad', displayName:'演示', password };
    for (const payload of [{ ...invalid, password:'short' }, { ...invalid, role:'ADMIN' }, { ...invalid, username:'?bad' }]) {
      expect((await write('register', payload)).statusCode).toBe(400);
    }
    expect((await write('register', invalid, jar, 'http://example.invalid')).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:'/api/auth/register',headers:{origin},payload:invalid})).statusCode).toBe(403);
    expect(await db.user.count({where:{username:invalid.username}})).toBe(0);
  });

  test('registers once under case-insensitive concurrency, persists hashes and reads sessions after restart', async () => {
    const alternate = client();
    const inputs = {username, displayName:'测试发布者',password};
    const responses = await Promise.all([write('register', inputs), write('register', {...inputs,username:username.toUpperCase()},alternate)]);
    expect(responses.map(value=>value.statusCode).sort()).toEqual([201,409]);
    if (!jar.get(sessionName)) for (const [key, value] of alternate) jar.set(key,value);
    const good = responses.find(value=>value.statusCode===201)!;
    expect(good.json()).toEqual({id:expect.any(String),username,displayName:'测试发布者',role:'USER'});
    expect(String(good.headers['set-cookie'])).toContain('HttpOnly');
    const row = await db.user.findUniqueOrThrow({where:{username},include:{sessions:true}});
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.sessions).toHaveLength(1);
    expect(row.sessions[0].tokenHash).toBe(digest(jar.get(sessionName)!));
    await app.close();
    app = await buildApp(db,{origins:[origin]});
    expect((await me(jar)).json().username).toBe(username);
  });

  test('rejects wrong or unknown credentials, rotates login and revokes the current session only', async () => {
    const wrong = await write('login',{username,password:'wrong-password'});
    const missing = await write('login',{username:'nonexistent_user',password});
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(missing.json());
    const second = client();
    expect((await write('login',{username,password}, second)).statusCode).toBe(200);
    const old = new Map(jar);
    expect((await write('logout')).statusCode).toBe(204);
    expect((await me(old)).statusCode).toBe(401);
    expect((await me(second)).statusCode).toBe(200);
    const tokenHash = digest(second.get(sessionName)!);
    await db.session.update({where:{tokenHash},data:{expiresAt:new Date(0)}});
    expect((await me(second)).statusCode).toBe(401);
    await db.session.update({where:{tokenHash},data:{expiresAt:new Date(Date.now()+60_000)}});
    await db.user.update({where:{username},data:{status:'DISABLED'}});
    expect((await me(second)).statusCode).toBe(401);
    expect((await write('login',{username,password})).statusCode).toBe(401);
  });

  test('limits repeated login attempts', async () => {
    const limited = await buildApp(db,{origins:[origin]});
    try {
      const statuses = [];
      for (let attempt=0;attempt<13;attempt++) {
        statuses.push((await limited.inject({method:'POST',url:'/api/auth/login',headers:{origin},payload:{username,password}})).statusCode);
      }
      expect(statuses.slice(0,12)).toEqual(Array(12).fill(403));
      expect(statuses[12]).toBe(429);
    } finally { await limited.close(); }
  });
});

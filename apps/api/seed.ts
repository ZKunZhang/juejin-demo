import { connectDatabase } from './db';
import { hashPassword } from './security';

const accounts = [
  { username: 'admin_demo', displayName: '演示管理员', role: 'ADMIN', variable: 'DEMO_ADMIN_PASSWORD' },
  { username: 'author_alpha', displayName: '林夕', role: 'USER', variable: 'DEMO_ALPHA_PASSWORD' },
  { username: 'reader_beta', displayName: '陈默', role: 'USER', variable: 'DEMO_BETA_PASSWORD' },
  { username: 'reader_gamma', displayName: '周野', role: 'USER', variable: 'DEMO_GAMMA_PASSWORD' },
] as const;
if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEMO_SEED !== 'true') throw new Error('Demo seed requires explicit opt-in outside production');
const url = new URL(process.env.DATABASE_URL || '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/_(dev|test)$/.test(url.pathname)) {
  throw new Error('Demo seed requires a local database with a _dev or _test suffix');
}
const db = connectDatabase();
try {
  const credentials = accounts.map(account => {
    const password = process.env[account.variable];
    if (!password || password.length < 8 || password.length > 128) throw new Error(`Set ${account.variable} to an 8–128 character password`);
    return password;
  });
  if (new Set(credentials).size !== credentials.length) throw new Error('Demo accounts require distinct passwords');
  const hashes = await Promise.all(credentials.map(hashPassword));
  await db.$transaction(async tx => {
    for (const [index, account] of accounts.entries()) {
      const row = await tx.user.upsert({
        where: { username: account.username }, update: {},
        create: { username: account.username, displayName: account.displayName, role: account.role, passwordHash: hashes[index] },
      });
      if (row.role !== account.role) throw new Error(`Role conflict for ${account.username}`);
    }
  });
  console.log('演示账号已初始化：', accounts.map(account => account.username).join('、'));
} finally {
  await db.$disconnect();
}

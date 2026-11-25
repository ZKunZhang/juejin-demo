import { buildApp } from './app';
import { connectDatabase } from './db';

const db = connectDatabase();
const secure = process.env.NODE_ENV === 'production';
if (secure && !process.env.APP_ORIGINS) throw new Error('APP_ORIGINS is required in production');
const origins = (process.env.APP_ORIGINS || 'http://127.0.0.1:5173,http://127.0.0.1:5174').split(',').map(origin => origin.trim());
const app = await buildApp(db, { origins, secure, logger: true });
app.addHook('onClose', async () => db.$disconnect());
await app.listen({ port: Number(process.env.PORT || 3000), host: process.env.HOST || '127.0.0.1' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });

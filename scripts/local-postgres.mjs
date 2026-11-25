import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const data = process.env.LOCAL_PG_DATA || './data/postgres';
const port = Number(process.env.LOCAL_PG_PORT || 55432);
const pg = new EmbeddedPostgres({
  databaseDir: data,
  user: 'mazhan',
  password: 'mazhan_local',
  port,
  persistent: true,
  initdbFlags: ['--locale=C', '--encoding=UTF8'],
  postgresFlags: ['-h', '127.0.0.1'],
});
if (!existsSync(data + '/PG_VERSION')) await pg.initialise();
await pg.start();
const client = pg.getPgClient();
await client.connect();
const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname='mazhan_dev'");
await client.end();
if (!rowCount) await pg.createDatabase('mazhan_dev');
console.log('PostgreSQL ready on 127.0.0.1:' + port);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void pg.stop());

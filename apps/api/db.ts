import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

export function connectDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  connectionString: string;
  poolMax?: number;
}

/**
 * Construct a PrismaClient backed by the `pg` driver adapter (required by
 * Prisma 7). One instance per process; share it through dependency injection
 * rather than importing a global.
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.poolMax ?? 10,
  });
  return new PrismaClient({ adapter });
}

/** Cheap connectivity probe used by the readiness endpoint. */
export async function pingDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRaw`SELECT 1`;
}

export type { PrismaClient };

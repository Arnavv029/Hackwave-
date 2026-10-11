import { createPrismaClient, type PrismaClient } from '../../src/db/client.js';

export const DB_TESTS_ENABLED = process.env['RUN_DB_TESTS'] === '1';

export function createTestPrisma(): PrismaClient {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  return createPrismaClient({ connectionString: url, poolMax: 2 });
}

/** Remove all rows. Cascades handle the dependent tables. */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "dependency_nodes", "audit_events" RESTART IDENTITY CASCADE',
  );
}

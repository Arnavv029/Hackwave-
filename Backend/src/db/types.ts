import type { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * Either the root client or an interactive-transaction client. Repositories
 * accept this so a service can run several repository calls in one
 * transaction: `prisma.$transaction(tx => new FindingRepository(tx)...)`.
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/** JSON that can be written to a `Json` column. */
export type JsonInput = Prisma.InputJsonValue;

/** Common pagination shape for list queries. */
export interface PageOptions {
  limit?: number;
  offset?: number;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 500;

export function clampPage(page: PageOptions | undefined): { take: number; skip: number } {
  const take = Math.min(Math.max(page?.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
  const skip = Math.max(page?.offset ?? 0, 0);
  return { take, skip };
}

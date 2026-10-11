import { Prisma } from '../generated/prisma/client.js';

/** Known request error (e.g. P2002 unique violation, P2025 not found). */
export function isPrismaKnownRequestError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError;
}

/** Query shape was invalid (wrong field, bad type, ...). */
export function isPrismaValidationError(err: unknown): err is Prisma.PrismaClientValidationError {
  return err instanceof Prisma.PrismaClientValidationError;
}

export interface UniqueViolationInfo {
  /** Column names when Prisma reports them; otherwise empty. */
  fields: string[];
  /** Database constraint/index name when available (driver-adapter path). */
  constraint?: string;
  table?: string;
}

interface DriverAdapterMeta {
  target?: unknown;
  driverAdapterError?: {
    cause?: {
      constraint?: { index?: unknown; fields?: unknown };
      table?: unknown;
    };
  };
}

/**
 * Extract what a P2002 error tells us about the violated constraint. Prisma 7
 * driver adapters put the constraint name under `meta.driverAdapterError`;
 * older engines put column names under `meta.target`. Both are handled.
 */
export function uniqueViolationInfo(err: unknown): UniqueViolationInfo | null {
  if (!isPrismaKnownRequestError(err) || err.code !== 'P2002') return null;
  const meta = (err.meta ?? {}) as DriverAdapterMeta;
  const fields: string[] = [];
  if (Array.isArray(meta.target)) fields.push(...meta.target.filter((t): t is string => typeof t === 'string'));
  else if (typeof meta.target === 'string') fields.push(meta.target);

  const cause = meta.driverAdapterError?.cause;
  const causeFields = cause?.constraint?.fields;
  if (Array.isArray(causeFields)) fields.push(...causeFields.filter((t): t is string => typeof t === 'string'));
  const constraint = typeof cause?.constraint?.index === 'string' ? cause.constraint.index : undefined;
  const table = typeof cause?.table === 'string' ? cause.table : undefined;

  return {
    fields,
    ...(constraint !== undefined ? { constraint } : {}),
    ...(table !== undefined ? { table } : {}),
  };
}

/**
 * True when `err` is a unique-constraint violation. With `column`, also
 * requires that column to be part of the violated constraint (matched by
 * reported field name or by the `<table>_<column>_key` naming convention).
 */
export function isUniqueViolation(err: unknown, column?: string): boolean {
  const info = uniqueViolationInfo(err);
  if (!info) return false;
  if (!column) return true;
  if (info.fields.includes(column)) return true;
  return info.constraint !== undefined && info.constraint.split('_').includes(column);
}

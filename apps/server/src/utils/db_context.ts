import type { PrismaClient } from '@prisma/client';

/**
 * Minimal context interface for repository delegate functions.
 * Only carries the Prisma database handle — no dependency on AppContext.
 *
 * Use this instead of AppContext / AppInfrastructure in repository and
 * delegate function signatures to avoid circular module dependencies.
 */
export interface DbContext {
  readonly prisma: PrismaClient;
}

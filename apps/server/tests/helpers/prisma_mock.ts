import type { PrismaClient } from '@prisma/client';
import { type DeepMockProxy, mockDeep, mockReset } from 'vitest-mock-extended';

/**
 * Creates a deep mock of PrismaClient where every model method
 * (e.g. prisma.agent.findMany, prisma.inferenceTrace.create) is
 * automatically a vi.fn().
 *
 * Use with wrapPrismaAsRepositories() or createMockAppContext()
 * to get a fully mocked context for service/route unit tests.
 *
 * @example
 * const prisma = createMockPrisma();
 * prisma.agent.count.mockResolvedValue(5);
 * prisma.inferenceTrace.create.mockResolvedValue({ id: 'trace-1' });
 */
export const createMockPrisma = (): DeepMockProxy<PrismaClient> => {
  return mockDeep<PrismaClient>();
};

/**
 * Configures the mock's $transaction to execute the callback argument
 * (interactive transaction pattern), passing the mock itself as the tx
 * client. Useful for tests that exercise code paths using $transaction.
 *
 * @example
 * const prisma = createMockPrisma();
 * mockTransactionPassthrough(prisma);
 * // Now prisma.$transaction(async (tx) => { ... }) will execute the callback
 */
export const mockTransactionPassthrough = (mockPrisma: DeepMockProxy<PrismaClient>): void => {
  mockPrisma.$transaction.mockImplementation(
    async (arg: unknown): Promise<unknown> => {
      if (typeof arg === 'function') {
        return (arg as (tx: PrismaClient) => unknown)(mockPrisma as unknown as PrismaClient);
      }
      return [];
    }
  );
};

export { mockDeep, mockReset };
export type { DeepMockProxy };

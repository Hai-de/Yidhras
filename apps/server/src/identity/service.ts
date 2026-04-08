import { PrismaClient } from '@prisma/client';

import type { IdentityContext } from './types.js';

export class IdentityService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  public async fetchIdentity(identityId: string): Promise<IdentityContext | null> {
    const identity = await this.prisma.identity.findUnique({
      where: { id: identityId }
    });
    if (!identity) {
      return null;
    }
    return {
      id: identity.id,
      type: identity.type as IdentityContext['type'],
      name: identity.name,
      provider: identity.provider,
      status: identity.status,
      claims: identity.claims as Record<string, unknown> | null
    };
  }
}

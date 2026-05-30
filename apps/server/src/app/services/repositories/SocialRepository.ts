import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../context.js';

export interface SocialRepository {
  listFeed(input?: {
    limit?: number | string;
    author_id?: string;
    agent_id?: string;
    source_action_intent_id?: string;
    from_tick?: bigint | number | string;
    to_tick?: bigint | number | string;
    keyword?: string;
    signal_min?: number | string;
    signal_max?: number | string;
    circle_id?: string;
    cursor?: string;
    sort?: string;
  }): Promise<{
    items: Array<Record<string, unknown>>;
    page_info: { has_next_page: boolean; next_cursor: string | null };
  }>;

  createPost(content?: string, options?: {
    source_action_intent_id?: string | null;
  }): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryPosts(input: { where?: Record<string, unknown>; orderBy?: any; take?: number; include?: Record<string, unknown>; skip?: number }): Promise<any[]>;
  findPostById(id: string): Promise<{ id: string; created_at: bigint; source_action_intent_id: string | null; author_id: string; content: string; noise_level: number; is_encrypted: boolean } | null>;
  createPostRecord(data: Record<string, unknown>): Promise<unknown>;
}

export class PrismaSocialRepository implements SocialRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listFeed(input?: {
    limit?: number | string;
    author_id?: string;
    agent_id?: string;
    source_action_intent_id?: string;
    from_tick?: bigint | number | string;
    to_tick?: bigint | number | string;
    keyword?: string;
    signal_min?: number | string;
    signal_max?: number | string;
    circle_id?: string;
    cursor?: string;
    sort?: string;
  }): Promise<{
    items: Array<Record<string, unknown>>;
    page_info: { has_next_page: boolean; next_cursor: string | null };
  }> {
    const { listSocialFeed } = await import('../social/social.js');
    return listSocialFeed(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      { prisma: this.prisma } as AppContext,
      undefined,
      input ?? {}
    );
  }

  async createPost(
    content?: string,
    options?: { source_action_intent_id?: string | null }
  ): Promise<unknown> {
    const { createSocialPost } = await import('../social/social.js');
    return createSocialPost(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      { prisma: this.prisma } as AppContext,
      undefined,
      content,
      options
    );
  }

   
  async queryPosts(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> | Array<Record<string, unknown>>; take?: number; include?: Record<string, unknown>; skip?: number }): Promise<Array<Record<string, unknown>>> {
// @ts-expect-error -- EOPT strict mode
    return this.prisma.post.findMany({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      where: input.where as never,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      orderBy: input.orderBy as never,
      take: input.take,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      include: input.include as never,
      skip: input.skip
    });
  }

  async findPostById(id: string): Promise<{ id: string; created_at: bigint; source_action_intent_id: string | null; author_id: string; content: string; noise_level: number; is_encrypted: boolean } | null> {
    return this.prisma.post.findUnique({ where: { id } });
  }

  async createPostRecord(data: Record<string, unknown>): Promise<unknown> {
    return this.prisma.post.create({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prisma query param type coercion
      data: data as never
    });
  }
}

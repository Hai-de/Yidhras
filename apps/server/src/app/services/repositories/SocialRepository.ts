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
    const { listSocialFeed } = await import('../social.js');
    return listSocialFeed(
      { prisma: this.prisma } as AppContext,
      undefined,
      input ?? {}
    );
  }

  async createPost(
    content?: string,
    options?: { source_action_intent_id?: string | null }
  ): Promise<unknown> {
    const { createSocialPost } = await import('../social.js');
    return createSocialPost(
      { prisma: this.prisma } as AppContext,
      undefined,
      content,
      options
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async queryPosts(input: { where?: Record<string, unknown>; orderBy?: any; take?: number; include?: Record<string, unknown>; skip?: number }): Promise<any[]> {
    return this.prisma.post.findMany({
      where: input.where as never,
      orderBy: input.orderBy,
      take: input.take,
      include: input.include as never,
      skip: input.skip
    });
  }

  async findPostById(id: string): Promise<{ id: string; created_at: bigint; source_action_intent_id: string | null; author_id: string; content: string; noise_level: number; is_encrypted: boolean } | null> {
    return this.prisma.post.findUnique({ where: { id } }) as Promise<{ id: string; created_at: bigint; source_action_intent_id: string | null; author_id: string; content: string; noise_level: number; is_encrypted: boolean } | null>;
  }

  async createPostRecord(data: Record<string, unknown>): Promise<unknown> {
    return this.prisma.post.create({ data: data as never });
  }
}

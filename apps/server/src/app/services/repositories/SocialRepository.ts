import type { PrismaClient } from '@prisma/client';

import { prismaInput } from '../../../utils/type_guards.js';
import type { SocialServiceContext } from '../social/social.js';
import { createSocialPost, listSocialFeed } from '../social/social.js';
import type { IdentityOperatorRepository } from './IdentityOperatorRepository.js';

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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly identityOperator: IdentityOperatorRepository
  ) {}

  /** Build the narrow context needed by social-feed delegate functions. */
  private ctx(): SocialServiceContext {
    return {
      repos: {
        social: this,
        identityOperator: this.identityOperator
      }
    };
  }

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
    return listSocialFeed(this.ctx(), undefined, input ?? {});
  }

  async createPost(
    content?: string,
    options?: { source_action_intent_id?: string | null }
  ): Promise<unknown> {
    return createSocialPost(this.ctx(), undefined, content, options);
  }


  async queryPosts(input: { where?: Record<string, unknown>; orderBy?: Record<string, unknown> | Array<Record<string, unknown>>; take?: number; include?: Record<string, unknown>; skip?: number }): Promise<Array<Record<string, unknown>>> {
    // @ts-expect-error -- EOPT strict mode: optional take conflicts with required Prisma arg
    return this.prisma.post.findMany({
      where: prismaInput(input.where),
      orderBy: prismaInput(input.orderBy),
      take: input.take,
      include: prismaInput(input.include),
      skip: input.skip
    });
  }

  async findPostById(id: string): Promise<{ id: string; created_at: bigint; source_action_intent_id: string | null; author_id: string; content: string; noise_level: number; is_encrypted: boolean } | null> {
    return this.prisma.post.findUnique({ where: { id } });
  }

  async createPostRecord(data: Record<string, unknown>): Promise<unknown> {
    return this.prisma.post.create({
      data: prismaInput(data)
    });
  }
}

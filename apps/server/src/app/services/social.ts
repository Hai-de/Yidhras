import type { IdentityContext } from '../../identity/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import {
  assertWriteAllowedForIdentity,
  filterReadableFieldsForIdentity,
  requirePolicyIdentity
} from './policy.js';

export const listSocialFeed = async (
  context: AppContext,
  identity: IdentityContext | undefined,
  limit: number
) => {
  const resolvedIdentity = requirePolicyIdentity(identity);
  const posts = await context.sim.prisma.post.findMany({
    take: limit,
    orderBy: { created_at: 'desc' },
    include: { author: true }
  });

  return Promise.all(
    posts.map(async post => {
      return filterReadableFieldsForIdentity(
        context,
        resolvedIdentity,
        {
          resource: 'social_post',
          action: 'read'
        },
        post as unknown as Record<string, unknown>
      );
    })
  );
};

export const createSocialPost = async (
  context: AppContext,
  identity: IdentityContext | undefined,
  content?: string,
  options?: {
    source_action_intent_id?: string | null;
  }
) => {
  const resolvedIdentity = requirePolicyIdentity(identity);
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new ApiError(400, 'SOCIAL_POST_INVALID', 'content is required');
  }

  await assertWriteAllowedForIdentity(
    context,
    resolvedIdentity,
    {
      resource: 'social_post',
      action: 'write'
    },
    { content }
  );

  return context.sim.prisma.post.create({
    data: {
      author_id: resolvedIdentity.id,
      source_action_intent_id: options?.source_action_intent_id ?? null,
      content,
      created_at: context.sim.clock.getTicks()
    }
  });
};

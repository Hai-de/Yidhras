import type { Prisma } from '@prisma/client';

import type { IdentityContext } from '../../identity/types.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import {
  assertWriteAllowedForIdentity,
  filterReadableFieldsForIdentity,
  requirePolicyIdentity
} from './policy.js';

export interface ListSocialFeedInput {
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
}

const DEFAULT_SOCIAL_FEED_LIMIT = 20;
const MAX_SOCIAL_FEED_LIMIT = 100;

type SocialFeedSort = 'latest' | 'signal';

interface SocialFeedLatestCursor {
  sort: 'latest';
  created_at: string;
  id: string;
}

interface SocialFeedSignalCursor {
  sort: 'signal';
  noise_level: number;
  created_at: string;
  id: string;
}

type SocialFeedCursor = SocialFeedLatestCursor | SocialFeedSignalCursor;

const normalizeOptionalString = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseSocialFeedLimit = (value: number | string | undefined): number => {
  if (typeof value === 'undefined') {
    return DEFAULT_SOCIAL_FEED_LIMIT;
  }

  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'limit must be a positive integer', {
      field: 'limit',
      value
    });
  }

  const normalized = Math.trunc(parsed);
  if (normalized < 1) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'limit must be a positive integer', {
      field: 'limit',
      value
    });
  }

  return Math.min(MAX_SOCIAL_FEED_LIMIT, normalized);
};

const parseTickFilter = (
  field: 'from_tick' | 'to_tick',
  value: bigint | number | string | undefined
): bigint | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', `${field} must be an integer tick`, {
        field,
        value
      });
    }
    return BigInt(value);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (!/^-?\d+$/.test(trimmed)) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', `${field} must be an integer tick`, {
      field,
      value
    });
  }

  return BigInt(trimmed);
};

const parseSignalFilter = (
  field: 'signal_min' | 'signal_max',
  value: number | string | undefined
): number | undefined => {
  if (typeof value === 'undefined') {
    return undefined;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', `${field} must be a number between 0 and 1`, {
        field,
        value
      });
    }

    if (value < 0 || value > 1) {
      throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', `${field} must be a number between 0 and 1`, {
        field,
        value
      });
    }

    return value;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', `${field} must be a number between 0 and 1`, {
      field,
      value
    });
  }

  return parsed;
};

const encodeSocialFeedCursor = (value: SocialFeedCursor): string => {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
};

const parseSocialFeedCursor = (value: string | undefined): SocialFeedCursor | null => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'cursor is invalid');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'cursor payload is invalid');
  }

  const payload = parsed as Record<string, unknown>;
  if (payload.sort === 'latest') {
    if (typeof payload.created_at !== 'string' || typeof payload.id !== 'string' || !/^\d+$/.test(payload.created_at)) {
      throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'cursor payload is invalid');
    }

    return {
      sort: 'latest',
      created_at: payload.created_at,
      id: payload.id
    };
  }

  if (payload.sort === 'signal') {
    if (
      typeof payload.created_at !== 'string' ||
      typeof payload.id !== 'string' ||
      !/^\d+$/.test(payload.created_at) ||
      typeof payload.noise_level !== 'number' ||
      !Number.isFinite(payload.noise_level)
    ) {
      throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'cursor payload is invalid');
    }

    return {
      sort: 'signal',
      noise_level: payload.noise_level,
      created_at: payload.created_at,
      id: payload.id
    };
  }

  throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'cursor payload is invalid');
};

const compareSocialFeedCursorPosition = (left: SocialFeedCursor, right: SocialFeedCursor): number => {
  if (left.sort === 'signal' && right.sort === 'signal' && left.noise_level !== right.noise_level) {
    return left.noise_level < right.noise_level ? -1 : 1;
  }

  const leftTick = BigInt(left.created_at);
  const rightTick = BigInt(right.created_at);
  if (leftTick === rightTick) {
    return right.id.localeCompare(left.id);
  }

  return leftTick > rightTick ? -1 : 1;
};

const parseSocialFeedSort = (value: string | undefined): SocialFeedSort => {
  if (typeof value === 'undefined' || value.trim().length === 0) {
    return 'latest';
  }

  const normalized = value.trim();
  if (normalized === 'latest' || normalized === 'signal') {
    return normalized;
  }

  throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'sort must be latest or signal', {
    field: 'sort',
    value
  });
};

const resolveEffectiveAuthorId = (authorId: string | null, agentId: string | null): string | null => {
  if (authorId && agentId && authorId !== agentId) {
    throw new ApiError(
      400,
      'SOCIAL_FEED_QUERY_INVALID',
      'author_id and agent_id must match for the current social post projection',
      {
        author_id: authorId,
        agent_id: agentId
      }
    );
  }

  return authorId ?? agentId;
};

const buildSocialFeedCursor = (
  post: {
    id: string;
    created_at: bigint;
    noise_level: number;
  },
  sort: SocialFeedSort
): SocialFeedCursor => {
  if (sort === 'signal') {
    return {
      sort: 'signal',
      noise_level: post.noise_level,
      created_at: post.created_at.toString(),
      id: post.id
    };
  }

  return {
    sort: 'latest',
    created_at: post.created_at.toString(),
    id: post.id
  };
};

export const listSocialFeed = async (
  context: AppContext,
  identity: IdentityContext | undefined,
  input: ListSocialFeedInput = {}
) => {
  const resolvedIdentity = requirePolicyIdentity(identity);
  const limit = parseSocialFeedLimit(input.limit);
  const authorId = normalizeOptionalString(input.author_id);
  const agentId = normalizeOptionalString(input.agent_id);
  const effectiveAuthorId = resolveEffectiveAuthorId(authorId, agentId);
  const sourceActionIntentId = normalizeOptionalString(input.source_action_intent_id);
  const fromTick = parseTickFilter('from_tick', input.from_tick);
  const toTick = parseTickFilter('to_tick', input.to_tick);
  const keyword = normalizeOptionalString(input.keyword);
  const signalMin = parseSignalFilter('signal_min', input.signal_min);
  const signalMax = parseSignalFilter('signal_max', input.signal_max);
  const circleId = normalizeOptionalString(input.circle_id);
  const sort = parseSocialFeedSort(input.sort);
  const cursor = parseSocialFeedCursor(input.cursor);

  if (typeof fromTick !== 'undefined' && typeof toTick !== 'undefined' && fromTick > toTick) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'from_tick must be less than or equal to to_tick', {
      from_tick: fromTick.toString(),
      to_tick: toTick.toString()
    });
  }

  if (typeof signalMin !== 'undefined' && typeof signalMax !== 'undefined' && signalMin > signalMax) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'signal_min must be less than or equal to signal_max', {
      signal_min: signalMin,
      signal_max: signalMax
    });
  }

  if (cursor && cursor.sort !== sort) {
    throw new ApiError(400, 'SOCIAL_FEED_QUERY_INVALID', 'cursor sort does not match requested sort', {
      cursor_sort: cursor.sort,
      requested_sort: sort
    });
  }

  const whereClauses: Prisma.PostWhereInput[] = [];

  if (effectiveAuthorId) {
    whereClauses.push({ author_id: effectiveAuthorId });
  }

  if (sourceActionIntentId) {
    whereClauses.push({ source_action_intent_id: sourceActionIntentId });
  }

  if (typeof fromTick !== 'undefined' || typeof toTick !== 'undefined') {
    whereClauses.push({
      created_at: {
        ...(typeof fromTick === 'undefined' ? {} : { gte: fromTick }),
        ...(typeof toTick === 'undefined' ? {} : { lte: toTick })
      }
    });
  }

  if (keyword) {
    whereClauses.push({
      content: {
        contains: keyword
      }
    });
  }

  if (circleId) {
    whereClauses.push({
      author: {
        circle_memberships: {
          some: { circle_id: circleId }
        }
      }
    });
  }

  const where: Prisma.PostWhereInput = {
    ...(whereClauses.length > 0 ? { AND: whereClauses } : {}),
    ...((typeof signalMin !== 'undefined' || typeof signalMax !== 'undefined')
      ? {
          noise_level: {
            ...(typeof signalMax === 'undefined' ? {} : { gte: 1 - signalMax }),
            ...(typeof signalMin === 'undefined' ? {} : { lte: 1 - signalMin })
          }
        }
      : {})
  };

  const orderBy: Prisma.PostOrderByWithRelationInput[] = sort === 'signal'
    ? [{ noise_level: 'asc' }, { created_at: 'desc' }, { id: 'desc' }]
    : [{ created_at: 'desc' }, { id: 'desc' }];

  const posts = await context.sim.prisma.post.findMany({
    where,
    orderBy,
    include: { author: true }
  });

  const cursorFilteredPosts = posts.filter(post => {
    if (!cursor) {
      return true;
    }

    return compareSocialFeedCursorPosition(buildSocialFeedCursor(post, sort), cursor) > 0;
  });

  const hasNextPage = cursorFilteredPosts.length > limit;
  const pagePosts = hasNextPage ? cursorFilteredPosts.slice(0, limit) : cursorFilteredPosts;

  const items = await Promise.all(
    pagePosts.map(async post => {
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

  return {
    items,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: hasNextPage ? encodeSocialFeedCursor(buildSocialFeedCursor(pagePosts[pagePosts.length - 1], sort)) : null
    }
  };
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

import type { Express, NextFunction, Request, Response } from 'express';

import type { IdentityRequest } from '../../identity/middleware.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { createSocialPost, listSocialFeed } from '../services/social.js';

export interface SocialRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const getSingleQueryValue = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    const first = value.find(item => typeof item === 'string');
    return typeof first === 'string' ? first : undefined;
  }

  return undefined;
};

export const registerSocialRoutes = (
  app: Express,
  context: AppContext,
  deps: SocialRouteDependencies
): void => {
  app.get(
    '/api/social/feed',
    deps.asyncHandler(async (req, res) => {
      const identityRequest = req as IdentityRequest;
      context.assertRuntimeReady('social feed');

      const feed = await listSocialFeed(context, identityRequest.identity, {
        limit: getSingleQueryValue(req.query.limit),
        author_id: getSingleQueryValue(req.query.author_id),
        agent_id: getSingleQueryValue(req.query.agent_id),
        source_action_intent_id: getSingleQueryValue(req.query.source_action_intent_id),
        from_tick: getSingleQueryValue(req.query.from_tick),
        to_tick: getSingleQueryValue(req.query.to_tick),
        keyword: getSingleQueryValue(req.query.keyword),
        circle_id: getSingleQueryValue(req.query.circle_id),
        cursor: getSingleQueryValue(req.query.cursor),
        signal_min: getSingleQueryValue(req.query.signal_min),
        signal_max: getSingleQueryValue(req.query.signal_max),
        sort: getSingleQueryValue(req.query.sort)
      });

      jsonOk(res, toJsonSafe(feed.items), {
        pagination: feed.page_info
      });
    })
  );

  app.post(
    '/api/social/post',
    deps.asyncHandler(async (req, res) => {
      const identityRequest = req as IdentityRequest;
      context.assertRuntimeReady('social post');
      const { content } = req.body as { content?: string };

      const post = await createSocialPost(context, identityRequest.identity, content);

      jsonOk(res, toJsonSafe(post));
    })
  );
};

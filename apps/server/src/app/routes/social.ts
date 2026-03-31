import {
  socialFeedQuerySchema,
  socialPostRequestSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { IdentityRequest } from '../../identity/middleware.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody, parseQuery } from '../http/zod.js';
import { createSocialPost, listSocialFeed } from '../services/social.js';

export interface SocialRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

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
      const query = parseQuery(socialFeedQuerySchema, req.query, 'SOCIAL_FEED_QUERY_INVALID');

      const feed = await listSocialFeed(context, identityRequest.identity, query);

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
      const body = parseBody(socialPostRequestSchema, req.body, 'SOCIAL_POST_INVALID');

      const post = await createSocialPost(context, identityRequest.identity, body.content);

      jsonOk(res, toJsonSafe(post));
    })
  );
};

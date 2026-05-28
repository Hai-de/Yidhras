import {
  socialFeedQuerySchema,
  socialPostRequestSchema
} from '@yidhras/contracts';

import type { IdentityRequest } from '../../identity/middleware.js';
import { asyncHandler } from '../http/async_handler.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody, parseQuery } from '../http/zod.js';
import { requireAuth } from '../middleware/require_auth.js';
import { createSocialPost, listSocialFeed } from '../services/social/social.js';
import type { RouteModule } from './types.js';

export const socialRoutes: RouteModule = {
  register(app, context) {
  app.get(
    '/api/social/feed',
    asyncHandler(async (req, res) => {
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
    requireAuth(),
    asyncHandler(async (req, res) => {
      const identityRequest = req as IdentityRequest;
      context.assertRuntimeReady('social post');
      const body = parseBody(socialPostRequestSchema, req.body, 'SOCIAL_POST_INVALID');

      const post = await createSocialPost(context, identityRequest.identity, body.content);

      jsonOk(res, toJsonSafe(post));
    })
  );
  }
};

import type { Express, NextFunction, Request, Response } from 'express';

import type { IdentityRequest } from '../../identity/middleware.js';
import type { AppContext } from '../context.js';
import { toJsonSafe } from '../http/json.js';
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

      const limit = Number.parseInt(typeof req.query.limit === 'string' ? req.query.limit : '', 10) || 20;
      const feed = await listSocialFeed(context, identityRequest.identity, limit);

      res.json(toJsonSafe(feed));
    })
  );

  app.post(
    '/api/social/post',
    deps.asyncHandler(async (req, res) => {
      const identityRequest = req as IdentityRequest;
      context.assertRuntimeReady('social post');
      const { content } = req.body as { content?: string };

      const post = await createSocialPost(context, identityRequest.identity, content);

      res.json(toJsonSafe(post));
    })
  );
};

import {
  createPolicyRequestSchema,
  evaluatePolicyRequestSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import {
  createAccessPolicy,
  evaluateAccessPolicy
} from '../../access_policy/service.js';
import type { IdentityRequest } from '../../identity/middleware.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody } from '../http/zod.js';
import { requireAuth } from '../middleware/require_auth.js';

export interface AccessPolicyRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

export const registerAccessPolicyRoutes = (
  app: Express,
  context: AppContext,
  deps: AccessPolicyRouteDependencies
): void => {
  app.post(
    '/api/access-policy',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(createPolicyRequestSchema, req.body, 'POLICY_INVALID');

      const policy = await createAccessPolicy(context, body);

      jsonOk(res, toJsonSafe(policy));
    })
  );

  app.post(
    '/api/access-policy/evaluate',
    requireAuth(),
    deps.asyncHandler(async (req, res) => {
      const identityRequest = req as IdentityRequest;
      const body = parseBody(evaluatePolicyRequestSchema, req.body, 'POLICY_EVAL_INVALID');

      const result = await evaluateAccessPolicy(context, identityRequest.identity, body);

      jsonOk(res, toJsonSafe(result));
    })
  );
};

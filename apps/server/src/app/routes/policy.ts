import {
  createPolicyRequestSchema,
  evaluatePolicyRequestSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { IdentityRequest } from '../../identity/middleware.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody } from '../http/zod.js';
import { createPolicy, evaluatePolicy } from '../services/policy.js';

export interface PolicyRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
  validatePolicyConditions(conditions: unknown): Record<string, unknown>;
}

export const registerPolicyRoutes = (
  app: Express,
  context: AppContext,
  deps: PolicyRouteDependencies
): void => {
  app.post(
    '/api/policy',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(createPolicyRequestSchema, req.body, 'POLICY_INVALID');

      const policy = await createPolicy(
        context,
        body,
        {
          validatePolicyConditions: deps.validatePolicyConditions
        }
      );

      jsonOk(res, toJsonSafe(policy));
    })
  );

  app.post(
    '/api/policy/evaluate',
    deps.asyncHandler(async (req, res) => {
      const identityRequest = req as IdentityRequest;
      const body = parseBody(evaluatePolicyRequestSchema, req.body, 'POLICY_EVAL_INVALID');

      const result = await evaluatePolicy(context, identityRequest.identity, body);

      jsonOk(res, toJsonSafe(result));
    })
  );
};

import {
  createPolicyRequestSchema,
  evaluatePolicyRequestSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { IdentityRequest } from '../../identity/middleware.js';
import type { AppContext } from '../context.js';
import type { ApiSuccessMeta } from '../http/json.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody } from '../http/zod.js';
import { createPolicy, evaluatePolicy } from '../services/policy.js';

export interface PolicyRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const POLICY_DEBUG_SURFACE_META: ApiSuccessMeta = {
  warnings: [
    {
      code: 'DEBUG_SURFACE_POLICY_ROUTE',
      message: '`/api/policy/*` is a debug/ops surface for access and projection policy inspection. It is not a world-governance canonical API.'
    }
  ]
};

export const registerPolicyRoutes = (
  app: Express,
  _context: AppContext,
  deps: PolicyRouteDependencies
): void => {
  app.post(
    '/api/policy',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(createPolicyRequestSchema, req.body, 'POLICY_INVALID');

      const policy = await createPolicy(_context, body);

      jsonOk(res, toJsonSafe(policy), POLICY_DEBUG_SURFACE_META);
    })
  );

  app.post(
    '/api/policy/evaluate',
    deps.asyncHandler(async (req, res) => {
      const identityRequest = req as IdentityRequest;
      const body = parseBody(evaluatePolicyRequestSchema, req.body, 'POLICY_EVAL_INVALID');

      const result = await evaluatePolicy(_context, identityRequest.identity, body);

      jsonOk(res, toJsonSafe(result), POLICY_DEBUG_SURFACE_META);
    })
  );
};

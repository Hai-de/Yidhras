import type { Express, NextFunction, Request, Response } from 'express';

import type { IdentityRequest } from '../../identity/middleware.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
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
      const {
        effect,
        subject_id,
        subject_type,
        resource,
        action,
        field,
        conditions,
        priority
      } = req.body as {
        effect?: string;
        subject_id?: string;
        subject_type?: string;
        resource?: string;
        action?: string;
        field?: string;
        conditions?: unknown;
        priority?: number;
      };

      const policy = await createPolicy(
        context,
        {
          effect,
          subject_id,
          subject_type,
          resource,
          action,
          field,
          conditions,
          priority
        },
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
      const { resource, action, fields, attributes } = req.body as {
        resource?: string;
        action?: string;
        fields?: string[];
        attributes?: Record<string, unknown>;
      };

      const result = await evaluatePolicy(context, identityRequest.identity, {
        resource,
        action,
        fields,
        attributes
      });

      jsonOk(res, toJsonSafe(result));
    })
  );
};

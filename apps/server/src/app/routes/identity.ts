import {
  createIdentityBindingRequestSchema,
  expireIdentityBindingRequestSchema,
  queryIdentityBindingsRequestSchema,
  registerIdentityRequestSchema,
  unbindIdentityBindingRequestSchema
} from '@yidhras/contracts';
import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody } from '../http/zod.js';
import {
  createIdentityBinding,
  expireIdentityBinding,
  queryIdentityBindings,
  registerIdentity,
  unbindIdentityBinding
} from '../services/identity.js';

export interface IdentityRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
  parseOptionalTick(value: unknown, fieldName: string): bigint | null;
}

export const registerIdentityRoutes = (
  app: Express,
  context: AppContext,
  deps: IdentityRouteDependencies
): void => {
  app.post(
    '/api/identity/register',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(registerIdentityRequestSchema, req.body, 'IDENTITY_INVALID');

      const identity = await registerIdentity(context, body);

      jsonOk(res, toJsonSafe(identity));
    })
  );

  app.post(
    '/api/identity/bind',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(createIdentityBindingRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

      const binding = await createIdentityBinding(
        context,
        body,
        {
          parseOptionalTick: deps.parseOptionalTick
        }
      );

      jsonOk(res, toJsonSafe(binding));
    })
  );

  app.post(
    '/api/identity/bindings/query',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(queryIdentityBindingsRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

      const bindings = await queryIdentityBindings(context, body);

      jsonOk(res, toJsonSafe(bindings));
    })
  );

  app.post(
    '/api/identity/bindings/unbind',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(unbindIdentityBindingRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

      const binding = await unbindIdentityBinding(context, body);

      jsonOk(res, toJsonSafe(binding));
    })
  );

  app.post(
    '/api/identity/bindings/expire',
    deps.asyncHandler(async (req, res) => {
      const body = parseBody(expireIdentityBindingRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

      const binding = await expireIdentityBinding(context, body);

      jsonOk(res, toJsonSafe(binding));
    })
  );
};

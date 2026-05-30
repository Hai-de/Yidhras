import {
  createIdentityBindingRequestSchema,
  expireIdentityBindingRequestSchema,
  queryIdentityBindingsRequestSchema,
  registerIdentityRequestSchema,
  unbindIdentityBindingRequestSchema
} from '@yidhras/contracts';

import { asyncHandler } from '../http/async_handler.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import { parseBody } from '../http/zod.js';
import { requireAuth } from '../middleware/require_auth.js';
import {
  createIdentityBinding,
  expireIdentityBinding,
  queryIdentityBindings,
  registerIdentity,
  unbindIdentityBinding
} from '../services/identity/identity.js';
import type { RouteModule } from './types.js';

export function createIdentityRoutes(deps: {
  parseOptionalTick(value: unknown, fieldName: string): bigint | null;
}): RouteModule {
  return {
    register(app, context) {
  app.post(
    '/api/identity/register',
    requireAuth(),
    asyncHandler(async (req, res) => {
      const body = parseBody(registerIdentityRequestSchema, req.body, 'IDENTITY_INVALID');

// @ts-expect-error -- EOPT strict mode
      const identity = await registerIdentity(context, body);

      jsonOk(res, toJsonSafe(identity));
    })
  );

  app.post(
    '/api/identity/bind',
    requireAuth(),
    asyncHandler(async (req, res) => {
      const body = parseBody(createIdentityBindingRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

      const binding = await createIdentityBinding(
        context,
// @ts-expect-error -- EOPT strict mode
        body,
        {
          parseOptionalTick: (value: unknown, fieldName: string) => deps.parseOptionalTick(value, fieldName)
        }
      );

      jsonOk(res, toJsonSafe(binding));
    })
  );

  app.post(
    '/api/identity/bindings/query',
    requireAuth(),
    asyncHandler(async (req, res) => {
      const body = parseBody(queryIdentityBindingsRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

// @ts-expect-error -- EOPT strict mode
      const bindings = await queryIdentityBindings(context, body);

      jsonOk(res, toJsonSafe(bindings));
    })
  );

  app.post(
    '/api/identity/bindings/unbind',
    requireAuth(),
    asyncHandler(async (req, res) => {
      const body = parseBody(unbindIdentityBindingRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

// @ts-expect-error -- EOPT strict mode
      const binding = await unbindIdentityBinding(context, body);

      jsonOk(res, toJsonSafe(binding));
    })
  );

  app.post(
    '/api/identity/bindings/expire',
    requireAuth(),
    asyncHandler(async (req, res) => {
      const body = parseBody(expireIdentityBindingRequestSchema, req.body, 'IDENTITY_BINDING_INVALID');

      const binding = await expireIdentityBinding(context, body);

      jsonOk(res, toJsonSafe(binding));
    })
  );
    }
  };
}

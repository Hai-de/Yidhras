import type { Express, NextFunction, Request, Response } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
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
      const { id, type, name, claims, metadata } = req.body as {
        id?: string;
        type?: string;
        name?: string;
        claims?: unknown;
        metadata?: unknown;
      };

      const identity = await registerIdentity(context, {
        id,
        type,
        name,
        claims,
        metadata
      });

      jsonOk(res, toJsonSafe(identity));
    })
  );

  app.post(
    '/api/identity/bind',
    deps.asyncHandler(async (req, res) => {
      const { identity_id, agent_id, atmosphere_node_id, role, status, expires_at } = req.body as {
        identity_id?: string;
        agent_id?: string;
        atmosphere_node_id?: string;
        role?: string;
        status?: string;
        expires_at?: unknown;
      };

      const binding = await createIdentityBinding(
        context,
        { identity_id, agent_id, atmosphere_node_id, role, status, expires_at },
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
      const { identity_id, role, status, include_expired, agent_id, atmosphere_node_id } = req.body as {
        identity_id?: string;
        role?: string;
        status?: string;
        include_expired?: boolean;
        agent_id?: string;
        atmosphere_node_id?: string;
      };

      const bindings = await queryIdentityBindings(context, {
        identity_id,
        role,
        status,
        include_expired,
        agent_id,
        atmosphere_node_id
      });

      jsonOk(res, toJsonSafe(bindings));
    })
  );

  app.post(
    '/api/identity/bindings/unbind',
    deps.asyncHandler(async (req, res) => {
      const { binding_id, status } = req.body as {
        binding_id?: string;
        status?: string;
      };

      const binding = await unbindIdentityBinding(context, {
        binding_id,
        status
      });

      jsonOk(res, toJsonSafe(binding));
    })
  );

  app.post(
    '/api/identity/bindings/expire',
    deps.asyncHandler(async (req, res) => {
      const { binding_id } = req.body as {
        binding_id?: string;
      };

      const binding = await expireIdentityBinding(context, {
        binding_id
      });

      jsonOk(res, toJsonSafe(binding));
    })
  );
};

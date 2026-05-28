import type { Express, Router } from 'express';
import { Router as createRouter } from 'express';

import type { InferenceService } from '../../../inference/service.js';
import type { AppContext } from '../../context.js';
import type { PackScopeResolver } from '../../runtime/PackScopeResolver.js';
import { agentRoutes } from '../agent.js';
import { auditRoutes } from '../audit.js';
import { createClockRoutes } from '../clock.js';
import { experimentalPackProjectionRoutes } from '../experimental_pack_projection.js';
import { graphRoutes } from '../graph.js';
import { createIdentityRoutes } from '../identity.js';
import { createInferenceRoutes } from '../inference.js';
import { narrativeRoutes } from '../narrative.js';
import { overviewRoutes } from '../overview.js';
import { packOpeningRoutes } from '../pack_openings.js';
import { packSnapshotRoutes } from '../pack_snapshots.js';
import { relationalRoutes } from '../relational.js';
import { schedulerRoutes } from '../scheduler.js';
import { socialRoutes } from '../social.js';

export interface PackRoutesDependencies {
  context: AppContext;
  scopeResolver: PackScopeResolver;
  inferenceService: InferenceService;
  parseOptionalTick?: (value: unknown, fieldName: string) => bigint | null;
  toJsonSafe?: (value: unknown) => unknown;
  getErrorMessage?: (err: unknown) => string;
}

export const registerPackRoutes = (deps: PackRoutesDependencies): Router => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const router = createRouter({ mergeParams: true }) as unknown as Express;

  const { context } = deps;

  // Pattern A: direct RouteModule
  overviewRoutes.register(router, context);
  packOpeningRoutes.register(router, context);
  packSnapshotRoutes.register(router, context);
  graphRoutes.register(router, context);
  experimentalPackProjectionRoutes.register(router, context);
  socialRoutes.register(router, context);
  relationalRoutes.register(router, context);
  narrativeRoutes.register(router, context);
  agentRoutes.register(router, context);
  auditRoutes.register(router, context);
  schedulerRoutes.register(router, context);

  // Pattern B: factory functions
  createInferenceRoutes(deps.inferenceService).register(router, context);
  createClockRoutes({
    toJsonSafe: deps.toJsonSafe ?? ((v: unknown) => v),
    getErrorMessage: deps.getErrorMessage ?? ((err: unknown) => String(err))
  }).register(router, context);
  createIdentityRoutes({
    parseOptionalTick: deps.parseOptionalTick ?? (() => null)
  }).register(router, context);

  return router;
};

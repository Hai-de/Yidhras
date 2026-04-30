import type { Express, Router } from 'express';
import { Router as createRouter } from 'express';

import type { InferenceService } from '../../../inference/service.js';
import type { AppContext } from '../../context.js';
import type { PackScopeResolver } from '../../runtime/PackScopeResolver.js';
import { registerAgentRoutes } from '../agent.js';
import { registerAuditRoutes } from '../audit.js';
import { registerClockRoutes } from '../clock.js';
import { registerExperimentalPackProjectionRoutes } from '../experimental_pack_projection.js';
import { registerExperimentalRuntimeRoutes } from '../experimental_runtime.js';
import { registerGraphRoutes } from '../graph.js';
import { registerIdentityRoutes } from '../identity.js';
import { registerInferenceRoutes } from '../inference.js';
import { registerNarrativeRoutes } from '../narrative.js';
import { registerOverviewRoutes } from '../overview.js';
import { registerPackOpeningRoutes } from '../pack_openings.js';
import { registerPackSnapshotRoutes } from '../pack_snapshots.js';
import { registerRelationalRoutes } from '../relational.js';
import { registerSchedulerRoutes } from '../scheduler.js';
import { registerSocialRoutes } from '../social.js';

export interface PackRoutesDependencies {
  context: AppContext;
  scopeResolver: PackScopeResolver;
  asyncHandler: (
    handler: (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<void>
  ) => (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void;
  inferenceService: InferenceService;
  parseOptionalTick?: (value: unknown, fieldName: string) => bigint | null;
  parsePositiveStepTicks?: (value: unknown) => bigint;
  toJsonSafe?: <T>(value: T) => unknown;
  getErrorMessage?: (err: unknown) => string;
}

export const registerPackRoutes = (deps: PackRoutesDependencies): Router => {
  const router = createRouter({ mergeParams: true }) as unknown as Express;

  const { context, asyncHandler } = deps;

  registerInferenceRoutes(router, context, deps.inferenceService, { asyncHandler });
  registerOverviewRoutes(router, context, { asyncHandler });
  registerPackOpeningRoutes(router, context, { asyncHandler });
  registerPackSnapshotRoutes(router, context, { asyncHandler });
  registerGraphRoutes(router, context, { asyncHandler });
  registerClockRoutes(router, context, {
    parsePositiveStepTicks: deps.parsePositiveStepTicks ?? ((v: unknown) => BigInt(typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '1')),
    toJsonSafe: deps.toJsonSafe ?? ((v: unknown) => v),
    getErrorMessage: deps.getErrorMessage ?? ((err: unknown) => String(err))
  });
  registerExperimentalRuntimeRoutes(router, context, { asyncHandler });
  registerExperimentalPackProjectionRoutes(router, context, { asyncHandler });
  registerSocialRoutes(router, context, { asyncHandler });
  registerRelationalRoutes(router, context, { asyncHandler });
  registerNarrativeRoutes(router, context, { asyncHandler });
  registerAgentRoutes(router, context, { asyncHandler });
  registerAuditRoutes(router, context, { asyncHandler });
  registerIdentityRoutes(router, context, {
    asyncHandler,
    parseOptionalTick: deps.parseOptionalTick ?? (() => null)
  });
  registerSchedulerRoutes(router, context, { asyncHandler });

  return router as unknown as Router;
};

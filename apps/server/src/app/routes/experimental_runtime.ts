import type { Express, NextFunction, Request, Response } from 'express';

import { isExperimentalMultiPackOperatorApiEnabled } from '../../config/runtime_config.js';
import { ApiError } from '../../utils/api_error.js';
import type { AppContext } from '../context.js';
import { jsonOk, toJsonSafe } from '../http/json.js';
import {
  buildExperimentalPackRuntimeRegistrySnapshot,
  buildExperimentalSystemHealthSnapshot,
  getExperimentalPackRuntimeStatusSnapshot,
  loadExperimentalPackRuntime,
  unloadExperimentalPackRuntime
} from '../services/experimental_multi_pack_runtime.js';
import {
  getExperimentalPackSchedulerOperatorProjection,
  getExperimentalPackSchedulerOwnershipProjection,
  getExperimentalPackSchedulerSummaryProjection,
  getExperimentalPackSchedulerWorkersProjection
} from '../services/experimental_scheduler_runtime.js';

export interface ExperimentalRuntimeRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void;
}

const assertExperimentalOperatorApiEnabled = (context: AppContext): void => {
  if (!context.sim.isExperimentalMultiPackRuntimeEnabled() || !isExperimentalMultiPackOperatorApiEnabled()) {
    throw new ApiError(
      404,
      'EXPERIMENTAL_MULTI_PACK_RUNTIME_DISABLED',
      'Experimental multi-pack runtime operator API is disabled',
      {
        experimental_multi_pack_runtime_enabled: context.sim.isExperimentalMultiPackRuntimeEnabled(),
        operator_api_enabled: isExperimentalMultiPackOperatorApiEnabled()
      }
    );
  }
};

const resolvePackIdParam = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'EXPERIMENTAL_PACK_ID_INVALID', 'Experimental runtime pack id is required');
  }

  return value.trim();
};

const translateExperimentalLoadError = (packId: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Failed to load experimental runtime pack';

  if (message.includes('not found')) {
    throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', message, {
      pack_id: packId
    });
  }

  if (message.includes('max loaded packs exceeded')) {
    throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_CAPACITY_REACHED', message, {
      pack_id: packId
    });
  }

  throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_LOAD_FAILED', message, {
    pack_id: packId
  });
};

const translateExperimentalUnloadError = (packId: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Failed to unload experimental runtime pack';

  if (message.includes('active pack runtime')) {
    throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_ACTIVE_UNLOAD_FORBIDDEN', message, {
      pack_id: packId
    });
  }

  throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_UNLOAD_FAILED', message, {
    pack_id: packId
  });
};

const requireExperimentalPackHandle = (context: AppContext, packId: string) => {
  const handle = context.sim.getPackRuntimeHandle(packId);
  if (!handle) {
    throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', 'Experimental runtime pack not found', {
      pack_id: packId
    });
  }

  return handle;
};

export const registerExperimentalRuntimeRoutes = (
  app: Express,
  context: AppContext,
  deps: ExperimentalRuntimeRouteDependencies
): void => {
  app.get(
    '/api/experimental/runtime/system/health',
    deps.asyncHandler(async (_req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      jsonOk(res, toJsonSafe(buildExperimentalSystemHealthSnapshot(context)));
    })
  );

  app.get(
    '/api/experimental/runtime/packs',
    deps.asyncHandler(async (_req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      jsonOk(
        res,
        toJsonSafe(buildExperimentalPackRuntimeRegistrySnapshot(context.sim.getPackRuntimeRegistry()))
      );
    })
  );

  app.post(
    '/api/experimental/runtime/packs/:packId/load',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);

      try {
        const result = await loadExperimentalPackRuntime(context, packId);
        jsonOk(res, toJsonSafe({ acknowledged: true, ...result, pack: result.handle }));
      } catch (error) {
        translateExperimentalLoadError(packId, error);
      }
    })
  );

  app.post(
    '/api/experimental/runtime/packs/:packId/unload',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);

      try {
        jsonOk(res, toJsonSafe(await unloadExperimentalPackRuntime(context, packId)));
      } catch (error) {
        translateExperimentalUnloadError(packId, error);
      }
    })
  );

  app.get(
    '/api/experimental/runtime/packs/:packId/status',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);
      const snapshot = getExperimentalPackRuntimeStatusSnapshot(context, packId);
      requireExperimentalPackHandle(context, packId);
      jsonOk(res, toJsonSafe(snapshot));
    })
  );

  app.get(
    '/api/experimental/runtime/packs/:packId/clock',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);
      const handle = requireExperimentalPackHandle(context, packId);
      jsonOk(
        res,
        toJsonSafe({
          pack_id: handle.pack_id,
          clock: handle.getClockSnapshot(),
          runtime_speed: handle.getRuntimeSpeedSnapshot()
        })
      );
    })
  );

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/summary',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);
      requireExperimentalPackHandle(context, packId);
      jsonOk(res, toJsonSafe(await getExperimentalPackSchedulerSummaryProjection(context, packId)));
    })
  );

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/ownership',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);
      requireExperimentalPackHandle(context, packId);
      jsonOk(res, toJsonSafe(await getExperimentalPackSchedulerOwnershipProjection(context, packId)));
    })
  );

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/workers',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);
      requireExperimentalPackHandle(context, packId);
      jsonOk(res, toJsonSafe(await getExperimentalPackSchedulerWorkersProjection(context, packId)));
    })
  );

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/operator',
    deps.asyncHandler(async (req, res) => {
      assertExperimentalOperatorApiEnabled(context);
      const packId = resolvePackIdParam(req.params.packId);
      requireExperimentalPackHandle(context, packId);
      jsonOk(res, toJsonSafe(await getExperimentalPackSchedulerOperatorProjection(context, packId)));
    })
  );
}

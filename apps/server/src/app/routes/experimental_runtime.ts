import type { Express, NextFunction, Request, Response } from 'express'

import { OPERATOR_CAPABILITY } from '../../operator/constants.js'
import { packAccessGuard } from '../../operator/guard/pack_access.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { jsonOk, toJsonSafe } from '../http/json.js'
import { capabilityGuard } from '../middleware/capability.js'
import { createRuntimeKernelService } from '../runtime/runtime_kernel_service.js'
import { getPackRuntimeLookupPort } from '../services/app_context_ports.js'
import {
  buildExperimentalPackRuntimeRegistrySnapshot,
  buildExperimentalSystemHealthSnapshot,
  getExperimentalPackRuntimeStatusSnapshot,
  loadExperimentalPackRuntime,
  unloadExperimentalPackRuntime
} from '../services/experimental_multi_pack_runtime.js'
import { assertPackScope } from '../services/pack_scope_resolver.js'

export interface ExperimentalRuntimeRouteDependencies {
  asyncHandler(
    handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
  ): (req: Request, res: Response, next: NextFunction) => void
}

const resolvePackIdParam = (value: unknown): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError(400, 'EXPERIMENTAL_PACK_ID_INVALID', 'Experimental runtime pack id is required')
  }

  return value.trim()
}

const translateExperimentalLoadError = (packId: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Failed to load experimental runtime pack'

  if (message.includes('not found')) {
    throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', message, {
      pack_id: packId
    })
  }

  if (message.includes('max loaded packs exceeded')) {
    throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_CAPACITY_REACHED', message, {
      pack_id: packId
    })
  }

  throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_LOAD_FAILED', message, {
    pack_id: packId
  })
}

const translateExperimentalUnloadError = (packId: string, error: unknown): never => {
  const message = error instanceof Error ? error.message : 'Failed to unload experimental runtime pack'

  if (message.includes('active pack runtime')) {
    throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_ACTIVE_UNLOAD_FORBIDDEN', message, {
      pack_id: packId
    })
  }

  throw new ApiError(409, 'EXPERIMENTAL_PACK_RUNTIME_UNLOAD_FAILED', message, {
    pack_id: packId
  })
}

const requireExperimentalPackHost = (context: AppContext, packId: string) => {
  assertPackScope(context, packId, 'experimental', 'experimental runtime pack host')
  const host = context.getPackRuntimeHost?.(packId)
  if (!host) {
    throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', 'Experimental runtime pack not found', {
      pack_id: packId
    })
  }

  return host
}

const requireExperimentalPackHandle = (context: AppContext, packId: string) => {
  assertPackScope(context, packId, 'experimental', 'experimental runtime pack handle')
  const summary = getPackRuntimeLookupPort({
    packRuntimeLookup: context.packRuntimeLookup
  }).getPackRuntimeSummary(packId)
  const handle = context.getPackRuntimeHandle?.(packId)
  if (!summary || !handle) {
    throw new ApiError(404, 'EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND', 'Experimental runtime pack not found', {
      pack_id: packId
    })
  }

  return handle
}

export const registerExperimentalRuntimeRoutes = (
  app: Express,
  context: AppContext,
  deps: ExperimentalRuntimeRouteDependencies
): void => {
  const packGuard = packAccessGuard(context, { packIdParam: 'packId' })
  const controlGuard = capabilityGuard(context, OPERATOR_CAPABILITY.INVOKE_SCHEDULER_CONTROL, {
    packIdParam: 'packId'
  })
  const observeGuard = capabilityGuard(context, OPERATOR_CAPABILITY.PERCEIVE_SCHEDULER_OBSERVABILITY, {
    packIdParam: 'packId'
  })

  app.get(
    '/api/experimental/runtime/system/health',
    (_req, res) => {
jsonOk(res, toJsonSafe(buildExperimentalSystemHealthSnapshot(context)))
    }
  )

  app.get(
    '/api/experimental/runtime/packs',
    deps.asyncHandler(async (_req, res) => {
jsonOk(
        res,
        toJsonSafe(await buildExperimentalPackRuntimeRegistrySnapshot(context))
      )
    })
  )

  app.post(
    '/api/experimental/runtime/packs/:packId/load',
    packGuard,
    controlGuard,
    deps.asyncHandler(async (req, res) => {
const packId = resolvePackIdParam(req.params.packId)

      try {
        const result = await loadExperimentalPackRuntime(context, packId)
        jsonOk(res, toJsonSafe({ acknowledged: true, ...result, pack: result.handle }))
      } catch (error) {
        translateExperimentalLoadError(packId, error)
      }
    })
  )

  app.post(
    '/api/experimental/runtime/packs/:packId/unload',
    packGuard,
    controlGuard,
    deps.asyncHandler(async (req, res) => {
const packId = resolvePackIdParam(req.params.packId)

      try {
        jsonOk(res, toJsonSafe(await unloadExperimentalPackRuntime(context, packId)))
      } catch (error) {
        translateExperimentalUnloadError(packId, error)
      }
    })
  )

  app.post(
    '/api/experimental/runtime/packs/:packId/step',
    packGuard,
    controlGuard,
    (req, res) => {
const packId = resolvePackIdParam(req.params.packId)
      const host = requireExperimentalPackHost(context, packId)

      const amountInput = (req.body as Record<string, unknown> | undefined)?.amount
      const amount = typeof amountInput === 'number' && Number.isFinite(amountInput) && amountInput > 0
        ? BigInt(Math.trunc(amountInput))
        : 1n

      const previousTick = host.getClock().getTicks()
      host.getClock().tick(amount)
      const currentTick = host.getClock().getTicks()

      jsonOk(res, toJsonSafe({
        pack_id: packId,
        previous_tick: previousTick.toString(),
        current_tick: currentTick.toString(),
        advanced_by: amount.toString()
      }))
    }
  )

  app.get(
    '/api/experimental/runtime/packs/:packId/status',
    packGuard,
    observeGuard,
    deps.asyncHandler(async (req, res) => {
const packId = resolvePackIdParam(req.params.packId)
      const snapshot = await getExperimentalPackRuntimeStatusSnapshot(context, packId)
      requireExperimentalPackHandle(context, packId)
      jsonOk(res, toJsonSafe(snapshot))
    })
  )

  app.get(
    '/api/experimental/runtime/packs/:packId/clock',
    packGuard,
    observeGuard,
    (req, res) => {
const packId = resolvePackIdParam(req.params.packId)
      const handle = requireExperimentalPackHandle(context, packId)
      jsonOk(
        res,
        toJsonSafe({
          pack_id: handle.pack_id,
          clock: handle.getClockSnapshot(),
          runtime_speed: handle.getRuntimeSpeedSnapshot()
        })
      )
    }
  )

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/summary',
    packGuard,
    observeGuard,
    deps.asyncHandler(async (req, res) => {
const packId = resolvePackIdParam(req.params.packId)
      requireExperimentalPackHandle(context, packId)
      const kernel = createRuntimeKernelService(context, packId)
      jsonOk(res, toJsonSafe(await kernel.getSummary?.({})))
    })
  )

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/ownership',
    packGuard,
    observeGuard,
    deps.asyncHandler(async (req, res) => {
const packId = resolvePackIdParam(req.params.packId)
      requireExperimentalPackHandle(context, packId)
      const kernel = createRuntimeKernelService(context, packId)
      jsonOk(res, toJsonSafe(await kernel.getOwnershipAssignments?.({})))
    })
  )

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/workers',
    packGuard,
    observeGuard,
    deps.asyncHandler(async (req, res) => {
const packId = resolvePackIdParam(req.params.packId)
      requireExperimentalPackHandle(context, packId)
      const kernel = createRuntimeKernelService(context, packId)
      jsonOk(res, toJsonSafe(await kernel.getWorkers?.({})))
    })
  )

  app.get(
    '/api/experimental/runtime/packs/:packId/scheduler/operator',
    packGuard,
    observeGuard,
    deps.asyncHandler(async (req, res) => {
const packId = resolvePackIdParam(req.params.packId)
      requireExperimentalPackHandle(context, packId)
      const kernel = createRuntimeKernelService(context, packId)
      jsonOk(res, toJsonSafe(await kernel.getOperatorProjection?.({})))
    })
  )
}

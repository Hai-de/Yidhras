import { randomUUID } from 'node:crypto'

import { Prisma } from '@prisma/client'
import { packActionRequestSchema } from '@yidhras/contracts'

import { checkCapability } from '../../app/middleware/capability.js'
import { logOperatorAudit } from '../../operator/audit/logger.js'
import type { OperatorRequest } from '../../operator/auth/types.js'
import { AUDIT_ACTION, OPERATOR_ERROR_CODE } from '../../operator/constants.js'
import { packAccessGuard } from '../../operator/guard/pack_access.js'
import { pluginRuntimeRegistry } from '../runtime/plugin_runtime_registry.js'
import { ApiError } from '../../utils/api_error.js'
import type { AppContext } from '../context.js'
import { asyncHandler } from '../http/async_handler.js'
import { jsonOk } from '../http/json.js'
import type { PackQueryHandlerRegistry } from '../services/action/pack_query_resolver.js'
import { resolvePackTick } from '../services/pack/pack_runtime_resolution.js'
import type { RouteModule } from './types.js'

// ── Helpers ──

const isInvokeCapability = (key: string): boolean => key.startsWith('invoke.')
const isPerceiveCapability = (key: string): boolean => key.startsWith('perceive.')

export const createFrontendActionIntent = async (
  context: AppContext,
  packId: string,
  capabilityKey: string,
  payload: unknown,
  operatorIdentityId: string,
  now: bigint
): Promise<{ id: string }> => {
  const inferenceId = `fii_${randomUUID()}`

  await context.prisma.inferenceTrace.create({
    data: {
      id: inferenceId,
      kind: 'frontend_action',
      strategy: 'direct',
      provider: 'frontend',
      actor_ref: { identity_id: operatorIdentityId },
      input: { capability_key: capabilityKey, payload: payload ?? {} },
      context_snapshot: {},
      prompt_bundle: {},
      trace_metadata: { source: 'pack_frontend' },
      pack_id: packId,
      created_at: now,
      updated_at: now
    }
  })

  return context.prisma.actionIntent.create({
    data: {
      source_inference_id: inferenceId,
      intent_type: capabilityKey,
      actor_ref: { identity_id: operatorIdentityId },
      target_ref: Prisma.JsonNull,
      payload: (payload ?? {}),
      pack_id: packId,
      status: 'pending',
      created_at: now,
      updated_at: now
    },
    select: { id: true }
  })
}

const resolvePerceiveQuery = async (
  context: AppContext,
  queryHandlerRegistry: PackQueryHandlerRegistry,
  packId: string,
  capabilityKey: string,
  payload: unknown,
  operator: NonNullable<OperatorRequest['operator']>
): Promise<unknown> => {
  // 1. Try the query handler registry first
  const handler = queryHandlerRegistry.find(capabilityKey)
  if (handler) {
    return handler.resolve(context, packId, payload, operator)
  }

  // 2. Fallback to plugin workers (handlers registered via host.registerHandler)
  const runtimes = pluginRuntimeRegistry.listRuntimes(packId)
  for (const runtime of runtimes) {
    if (runtime.handler_names.includes(capabilityKey) && runtime.worker_client) {
      return runtime.worker_client.invoke('handler', capabilityKey, payload)
    }
  }

  throw new ApiError(
    404,
    'QUERY_HANDLER_NOT_FOUND',
    `No query handler registered for: ${capabilityKey}`,
    { capability_key: capabilityKey }
  )
}

// ── Route registration ──

export function createPackActionsRoute(queryHandlerRegistry: PackQueryHandlerRegistry): RouteModule {
  return {
    register(app, context) {
      const packGuard = packAccessGuard(context, { packIdParam: 'packId' })

      app.post(
        '/api/packs/:packId/actions',
        packGuard,
        asyncHandler(async (req, res) => {
       
      const opReq = req as OperatorRequest
      const packId = typeof opReq.params['packId'] === 'string' ? opReq.params['packId'] : ''

      if (!packId) {
        throw new ApiError(400, 'INVALID_PACK_ID', 'packId is required')
      }

      // 1. Parse & validate body
      const parseResult = packActionRequestSchema.safeParse(opReq.body)
      if (!parseResult.success) {
        throw new ApiError(400, 'INVALID_ACTION_REQUEST', 'Request body validation failed', {
          errors: parseResult.error.issues
        })
      }
      const { capability_key, payload } = parseResult.data

      // 2. Operator already checked by packAccessGuard, but TypeScript needs the guard
      if (!opReq.operator) {
        throw new ApiError(
          401,
          OPERATOR_ERROR_CODE.OPERATOR_REQUIRED,
          'Authentication required'
        )
      }

      // 3. Validate capability prefix
      if (!isInvokeCapability(capability_key) && !isPerceiveCapability(capability_key)) {
        throw new ApiError(
          400,
          'UNSUPPORTED_CAPABILITY_PREFIX',
          'capability_key must start with "perceive." or "invoke."',
          { capability_key }
        )
      }

      // 4. L2 Capability check
      const capabilityResult = await checkCapability(
        context,
        opReq.operator.id,
        packId,
        capability_key
      )

      if (!capabilityResult.allowed) {
        await logOperatorAudit(context, {
          operator_id: opReq.operator.id,
          pack_id: packId,
          action: AUDIT_ACTION.CAPABILITY_DENIED,
          detail_json: {
            capability_key,
            subject_entity_id: capabilityResult.subjectEntityId
          },
          client_ip: opReq.ip
        })

        throw new ApiError(
          403,
          OPERATOR_ERROR_CODE.CAPABILITY_DENIED,
          `Missing capability: ${capability_key}`,
          { capability_key, subject_entity_id: capabilityResult.subjectEntityId }
        )
      }

      // 5. Route based on prefix
      if (isPerceiveCapability(capability_key)) {
        const data = await resolvePerceiveQuery(
          context,
          queryHandlerRegistry,
          packId,
          capability_key,
          payload,
          opReq.operator
        )
        jsonOk(res, { capability_key, data })
      } else {
        const now = resolvePackTick(context)
        const intent = await createFrontendActionIntent(
          context,
          packId,
          capability_key,
          payload,
          opReq.operator.identity_id,
          now
        )
        jsonOk(res, { capability_key, intent_id: intent.id })
      }
    })
  )
    }
  };
}

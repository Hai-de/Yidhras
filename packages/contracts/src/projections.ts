import { z } from 'zod'

import { runtimeStatusDataSchema } from './system.js'

const nonEmptyStringSchema = z.string().trim().min(1)
const positiveIntQuerySchema = z.coerce.number().finite().int().positive()

export const packIdParamsSchema = z.object({
  packId: nonEmptyStringSchema
})

export const packOverviewDataSchema = z.object({
  pack_id: nonEmptyStringSchema.nullable(),
  entity_count: z.number().int().nonnegative(),
  entity_state_count: z.number().int().nonnegative(),
  authority_grant_count: z.number().int().nonnegative(),
  mediator_binding_count: z.number().int().nonnegative(),
  rule_execution_count: z.number().int().nonnegative(),
  latest_rule_execution: z
    .object({
      id: nonEmptyStringSchema,
      rule_id: nonEmptyStringSchema,
      execution_status: nonEmptyStringSchema,
      created_at: nonEmptyStringSchema
    })
    .nullable()
})

export const operatorOverviewProjectionSchema = packOverviewDataSchema.extend({
  pack_id: nonEmptyStringSchema.nullable().optional()
})

export const globalProjectionIndexSchema = z.object({
  generated_at: nonEmptyStringSchema,
  runtime: runtimeStatusDataSchema,
  pack: z
    .object({
      entity_summary: z.object({
        entity_count: z.number().int().nonnegative(),
        actor_count: z.number().int().nonnegative(),
        artifact_count: z.number().int().nonnegative(),
        authority_count: z.number().int().nonnegative(),
        mediator_binding_count: z.number().int().nonnegative(),
        rule_execution_count: z.number().int().nonnegative()
      }),
      timeline_count: z.number().int().nonnegative()
    })
    .nullable()
})

export const overviewSummaryDataSchema = z.object({
  runtime: runtimeStatusDataSchema,
  world_time: z.object({
    tick: nonEmptyStringSchema,
    calendars: z.array(z.unknown())
  }),
  active_agent_count: z.number().int().nonnegative(),
  recent_events: z.array(z.record(z.string(), z.unknown())),
  latest_posts: z.array(z.record(z.string(), z.unknown())),
  latest_propagation: z.array(z.record(z.string(), z.unknown())),
  failed_jobs: z.array(z.record(z.string(), z.unknown())),
  dropped_intents: z.array(z.record(z.string(), z.unknown())),
  notifications: z.array(z.record(z.string(), z.unknown())),
  operator_projection: operatorOverviewProjectionSchema,
  global_projection_index: globalProjectionIndexSchema
})

export const packTimelineEntrySchema = z.object({
  id: nonEmptyStringSchema,
  kind: z.enum(['event', 'rule_execution']),
  created_at: nonEmptyStringSchema,
  title: z.string(),
  description: z.string(),
  refs: z.record(z.string(), z.string().nullable()),
  data: z.record(z.string(), z.unknown())
})

export const packNarrativeProjectionDataSchema = z.object({
  pack: z.object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    version: nonEmptyStringSchema
  }),
  timeline: z.array(packTimelineEntrySchema)
})

export const entityOverviewQuerySchema = z.object({
  limit: positiveIntQuerySchema.optional()
})

export const entityStateProjectionSchema = z.object({
  namespace: nonEmptyStringSchema,
  value: z.record(z.string(), z.unknown())
})

export const entityPackProjectionSchema = z.object({
  entity: z
    .object({
      entity_kind: nonEmptyStringSchema,
      entity_type: z.string().nullable(),
      tags: z.array(nonEmptyStringSchema),
      state: z.array(entityStateProjectionSchema)
    })
    .nullable(),
  recent_rule_executions: z.array(
    z.object({
      id: nonEmptyStringSchema,
      rule_id: nonEmptyStringSchema,
      capability_key: z.string().nullable(),
      execution_status: nonEmptyStringSchema,
      created_at: nonEmptyStringSchema
    })
  )
})

const memoryBlockDiagnosticsSchema = z.object({
  evaluated: z.array(z.record(z.string(), z.unknown())),
  inserted: z.array(nonEmptyStringSchema),
  delayed: z.array(nonEmptyStringSchema),
  cooling: z.array(nonEmptyStringSchema),
  retained: z.array(nonEmptyStringSchema),
  inactive: z.array(nonEmptyStringSchema)
})

const contextGovernanceSchema = z.object({
  latest_policy: z.object({
    policy_decisions: z.array(z.record(z.string(), z.unknown())),
    blocked_nodes: z.array(z.record(z.string(), z.unknown())),
    locked_nodes: z.array(z.record(z.string(), z.unknown())),
    visibility_denials: z.array(z.record(z.string(), z.unknown()))
  }),
  overlay: z.object({
    count: z.number().int().nonnegative(),
    latest_items: z.array(
      z.object({
        node_id: z.string(),
        overlay_id: z.string(),
        overlay_type: z.string(),
        persistence_mode: z.string(),
        created_by: z.enum(['system', 'agent']),
        status: z.string(),
        preferred_slot: z.string().nullable()
      })
    ),
    latest_mutations: z.array(z.record(z.string(), z.unknown()))
  }),
  memory_blocks: memoryBlockDiagnosticsSchema
})

export const entityOverviewDataSchema = z.object({
  profile: z.object({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    snr: z.number(),
    is_pinned: z.boolean(),
    created_at: nonEmptyStringSchema,
    updated_at: nonEmptyStringSchema
  }),
  binding_summary: z.object({
    active: z.array(z.record(z.string(), z.unknown())),
    atmosphere: z.array(z.record(z.string(), z.unknown())),
    counts: z.record(z.string(), z.number())
  }),
  relationship_summary: z.object({
    incoming: z.array(z.record(z.string(), z.unknown())),
    outgoing: z.array(z.record(z.string(), z.unknown())),
    counts: z.record(z.string(), z.number())
  }),
  pack_projection: entityPackProjectionSchema,
  recent_activity: z.array(z.record(z.string(), z.unknown())),
  recent_posts: z.array(z.record(z.string(), z.unknown())),
  recent_workflows: z.array(z.record(z.string(), z.unknown())),
  recent_events: z.array(z.record(z.string(), z.unknown())),
  recent_inference_results: z.array(z.record(z.string(), z.unknown())),
  snr: z.object({
    current: z.number(),
    recent_logs: z.array(z.record(z.string(), z.unknown()))
  }),
  memory: z.object({
    summary: z.record(z.string(), z.unknown()),
    latest_blocks: memoryBlockDiagnosticsSchema
  }),
  context_governance: contextGovernanceSchema
})

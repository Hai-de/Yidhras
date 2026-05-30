import type {
  WorldDomainEvent,
  WorldEngineObservationRecord,
  WorldObjectiveEventEffect,
  WorldObjectiveMutationEffect,
  WorldRuleExecuteObjectiveRequest,
  WorldStateDeltaOperation,
  WorldStateQuery,
  WorldStepPrepareRequest
} from './world_engine.js'

/**
 * Read-only session snapshot exposed to world-engine contributors.
 * Contributors must not mutate the session directly; all mutations
 * must be expressed through returned contribution structures.
 */
export interface WorldEngineSessionContext {
  readonly pack_id: string
  readonly mode: 'active' | 'experimental'
  readonly current_tick: string
  readonly current_revision: string
  readonly world_entities: ReadonlyArray<Record<string, unknown>>
  readonly entity_states: ReadonlyArray<Record<string, unknown>>
  readonly authority_grants: ReadonlyArray<Record<string, unknown>>
  readonly mediator_bindings: ReadonlyArray<Record<string, unknown>>
  readonly rule_execution_records: ReadonlyArray<Record<string, unknown>>
}

/**
 * A single contribution to a prepared world step.
 * Delta operations, events and observability records are merged
 * across all contributors by the orchestrator.
 */
export interface StepContribution {
  readonly delta_operations: WorldStateDeltaOperation[]
  readonly emitted_events: WorldDomainEvent[]
  readonly observability: WorldEngineObservationRecord[]
}

/**
 * Contributors that participate in world step preparation.
 * Each contributor receives the prepare request and a read-only
 * session context, and may return a contribution or null if it
 * declines to participate.
 *
 * Priority determines invocation order; lower numbers run first.
 */
export interface StepContributor {
  readonly name: string
  readonly priority: number
  contributePrepare(
    input: WorldStepPrepareRequest,
    context: WorldEngineSessionContext
  ): StepContribution | null | Promise<StepContribution | null>
}

/**
 * A single contribution to objective rule execution.
 */
export interface RuleContribution {
  readonly rule_id: string
  readonly mutations: WorldObjectiveMutationEffect[]
  readonly emitted_events: WorldObjectiveEventEffect[]
  readonly diagnostics?: {
    readonly no_match_reason?: string | null
    readonly evaluated_rule_count?: number
    readonly rendered_template_count?: number
  }
}

/**
 * Contributors that participate in objective rule execution.
 * The orchestrator iterates contributors in priority order and
 * uses the first non-null result.
 */
export interface RuleContributor {
  readonly name: string
  readonly priority: number
  contributeExecution(
    input: WorldRuleExecuteObjectiveRequest,
    context: WorldEngineSessionContext
  ): RuleContribution | null | Promise<RuleContribution | null>
}

/**
 * A single contribution to a state query.
 */
export interface QueryContribution {
  readonly data: unknown
  readonly warnings?: WorldEngineObservationRecord[]
  readonly next_cursor?: string | null
}

/**
 * Contributors that extend or override state queries.
 * Each contributor declares which query_name(s) it supports.
 * Use '*' to indicate a fallback contributor for any query.
 *
 * The orchestrator selects the first matching contributor;
 * built-in queries (pack_summary, world_entities, …) are handled
 * by the default engine unless a plugin contributor explicitly
 * overrides them.
 */
export interface QueryContributor {
  readonly name: string
  readonly supports_query_name: string
  readonly priority: number
  contributeQuery(
    input: WorldStateQuery,
    context: WorldEngineSessionContext
  ): QueryContribution | null | Promise<QueryContribution | null>
}

/**
 * Construct a WorldEngineSessionContext from typed domain records.
 *
 * Centralizes the type assertion required because TypeScript interfaces
 * without index signatures are not structurally assignable to
 * `Record<string, unknown>` under strict mode.
 *
 * Each array accepts any object type; the values are narrowed to
 * `ReadonlyArray<Record<string, unknown>>` for consumption by contributors.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- TS limitation: interface without index signature → Record
export const toSessionRecordArray = <T>(
  arr: ReadonlyArray<T>
): ReadonlyArray<Record<string, unknown>> =>
  arr as unknown as ReadonlyArray<Record<string, unknown>>;

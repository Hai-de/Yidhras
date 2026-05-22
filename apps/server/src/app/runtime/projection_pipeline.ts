import { evaluateProjectionRules } from '../../domain/projection/projection_evaluator.js'
import type { ProjectionEvaluationContext, ProjectionRuleDef } from '../../domain/projection/types.js'
import { listPackAuthorityGrants } from '../../packs/storage/authority_repo.js'
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js'
import { listPackEntityStates, upsertPackEntityState } from '../../packs/storage/entity_state_repo.js'
import { listPackMediatorBindings } from '../../packs/storage/mediator_repo.js'
import { listPackRuleExecutionRecords } from '../../packs/storage/rule_execution_repo.js'
import type { AppContext } from '../context.js'
import type { PackRuntimePort } from '../services/pack/pack_runtime_ports.js'

/** Per-(pack, rule) last execution tick tracker for cumulative tick_interval */
const ruleLastExecutionTicks = new Map<string, Map<string, bigint>>();

const getPackLastExecutionTicks = (packId: string): Map<string, bigint> => {
  let packMap = ruleLastExecutionTicks.get(packId);
  if (!packMap) {
    packMap = new Map<string, bigint>();
    ruleLastExecutionTicks.set(packId, packMap);
  }
  return packMap;
};

const buildProjectionEntityStateId = (packId: string, projectionKey: string): string => {
  return `${packId}:state:__projection__:${projectionKey}`
}

export const runProjectionPipeline = async (
  context: AppContext,
  packRuntime: PackRuntimePort
): Promise<void> => {
  const pack = packRuntime.getPack()
  const projectionRules = pack.rules?.projection ?? []
  if (projectionRules.length === 0) {
    return
  }

  const packId = packRuntime.getPackId()
  const currentTick = packRuntime.getCurrentTick()
  const now = packRuntime.getCurrentRevision()

  const [
    worldEntities,
    entityStates,
    authorityGrants,
    mediatorBindings,
    ruleExecutionRecords
  ] = await Promise.all([
    listPackWorldEntities(context.packStorageAdapter, packId),
    listPackEntityStates(context.packStorageAdapter, packId),
    listPackAuthorityGrants(context.packStorageAdapter, packId),
    listPackMediatorBindings(context.packStorageAdapter, packId),
    listPackRuleExecutionRecords(context.packStorageAdapter, packId)
  ])

  const evalContext: ProjectionEvaluationContext = {
    packId,
    currentTick,
    entities: worldEntities.map(e => ({ id: e.id, entity_kind: e.entity_kind, entity_type: e.entity_type })),
    entityStates: entityStates.map(s => ({ entity_id: s.entity_id, state_namespace: s.state_namespace, state_json: s.state_json })),
    mediatorBindings: mediatorBindings.map(b => ({ mediator_id: b.mediator_id, subject_entity_id: b.subject_entity_id, binding_kind: b.binding_kind })),
    authorityGrants: authorityGrants.map(g => ({ id: g.id, source_entity_id: g.source_entity_id, capability_key: g.capability_key, status: g.status })),
    ruleExecutionRecords: ruleExecutionRecords.map(r => ({ id: r.id, rule_id: r.rule_id, execution_status: r.execution_status, payload_json: r.payload_json })),
    lastExecutionTicks: getPackLastExecutionTicks(packId)
  }

  const parsedRules: ProjectionRuleDef[] = projectionRules.map(rule => ({
    id: rule.id,
    when: {
      tick_interval: rule.when.tick_interval,
      on_event_type: rule.when.on_event_type,
      entity_type_is: rule.when.entity_type_is
    },
    then: {
      compute: rule.then.compute,
      source_entity_type: rule.then.source_entity_type,
      source_state_key: rule.then.source_state_key,
      source_collection: rule.then.source_collection,
      target_projection: rule.then.target_projection,
      aggregate_by: rule.then.aggregate_by,
      filter_condition: rule.then.filter_condition
    }
  }))

  const results = evaluateProjectionRules(parsedRules, evalContext)

  for (const result of results) {
    const stateJson: Record<string, unknown> = {
      computed_value: result.computed_value,
      dimensions: result.dimensions,
      computed_at_tick: currentTick.toString()
    }

    await upsertPackEntityState(context.packStorageAdapter, {
      id: buildProjectionEntityStateId(packId, result.projection_key),
      pack_id: packId,
      entity_id: '__projection__',
      state_namespace: result.projection_key,
      state_json: stateJson,
      now
    })
  }
}

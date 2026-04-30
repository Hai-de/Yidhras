import type { AppInfrastructure } from '../../app/context.js';
import { getRuntimeStatusSnapshot } from '../../app/services/system.js';
import {
  createPackEntityOverviewProjectionService,
  type PackEntityProjectionSnapshot
} from '../../packs/runtime/projections/pack_entity_overview_projection_service.js';
import { createPackProjectionScopeAdapter } from '../../packs/runtime/projections/pack_projection_scope_adapter.js';

export interface OperatorOverviewProjectionSnapshot {
  runtime: Awaited<ReturnType<typeof getRuntimeStatusSnapshot>>;
  pack_projection: {
    entity_count: number;
    entity_state_count: number;
    authority_grant_count: number;
    mediator_binding_count: number;
    rule_execution_count: number;
    latest_rule_execution: {
      id: string;
      rule_id: string;
      execution_status: string;
      created_at: string;
    } | null;
  };
}

export interface OperatorOverviewProjectionOptions {
  packId?: string;
  feature?: string;
}

const toPackOverviewProjectionSummary = (
  projection: PackEntityProjectionSnapshot
): OperatorOverviewProjectionSnapshot['pack_projection'] => {
  const latestRuleExecution = projection.recent_rule_executions[0] ?? null;
  return {
    entity_count: projection.summary.entity_count,
    entity_state_count: projection.entities.reduce((sum, entity) => sum + entity.state.length, 0),
    authority_grant_count: projection.authorities.length,
    mediator_binding_count: projection.mediator_bindings.length,
    rule_execution_count: projection.summary.rule_execution_count,
    latest_rule_execution: latestRuleExecution
      ? {
          id: latestRuleExecution.id,
          rule_id: latestRuleExecution.rule_id,
          execution_status: latestRuleExecution.execution_status,
          created_at: latestRuleExecution.created_at
        }
      : null
  };
};

export const getOperatorOverviewProjection = async (
  context: AppInfrastructure,
  options: OperatorOverviewProjectionOptions = {}
): Promise<OperatorOverviewProjectionSnapshot> => {
  const runtime = await getRuntimeStatusSnapshot(context as Parameters<typeof getRuntimeStatusSnapshot>[0], {
    packId: options.packId
  });
  const activePack = context.activePack.getActivePack();

  if (!activePack && options.packId === undefined) {
    return {
      runtime,
      pack_projection: {
        entity_count: 0,
        entity_state_count: 0,
        authority_grant_count: 0,
        mediator_binding_count: 0,
        rule_execution_count: 0,
        latest_rule_execution: null
      }
    };
  }

  const scope = createPackProjectionScopeAdapter(context);
  const resolved = await scope.resolveStablePack(
    options.packId ?? activePack?.metadata.id ?? '',
    options.feature ?? 'operator overview projection'
  );
  const projectionService = createPackEntityOverviewProjectionService(context);
  const projection = await projectionService.getProjection(resolved);

  return {
    runtime,
    pack_projection: toPackOverviewProjectionSummary(projection)
  };
};

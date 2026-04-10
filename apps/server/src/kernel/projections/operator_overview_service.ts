import type { AppContext } from '../../app/context.js';
import { getRuntimeStatusSnapshot } from '../../app/services/system.js';
import { resolvePackProjectionTarget } from '../../packs/runtime/projections/active_pack_projection_guard.js';
import { listPackAuthorityGrants } from '../../packs/storage/authority_repo.js';
import { listPackWorldEntities } from '../../packs/storage/entity_repo.js';
import { listPackEntityStates } from '../../packs/storage/entity_state_repo.js';
import { listPackMediatorBindings } from '../../packs/storage/mediator_repo.js';
import { listPackRuleExecutionRecords } from '../../packs/storage/rule_execution_repo.js';

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

export const getOperatorOverviewProjection = async (
  context: AppContext,
  options: OperatorOverviewProjectionOptions = {}
): Promise<OperatorOverviewProjectionSnapshot> => {
  const runtime = await getRuntimeStatusSnapshot(context);
  const { activePack, resolvedPackId } = resolvePackProjectionTarget(context, {
    requestedPackId: options.packId,
    feature: options.feature ?? 'operator overview projection',
    allowMissingActivePack: options.packId === undefined
  });

  if (!activePack || !resolvedPackId) {
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

  const [entities, entityStates, authorityGrants, mediatorBindings, ruleExecutions] = await Promise.all([
    listPackWorldEntities(resolvedPackId),
    listPackEntityStates(resolvedPackId),
    listPackAuthorityGrants(resolvedPackId),
    listPackMediatorBindings(resolvedPackId),
    listPackRuleExecutionRecords(resolvedPackId)
  ]);

  const latestRuleExecution = [...ruleExecutions].sort((left, right) => Number(right.created_at - left.created_at))[0] ?? null;

  return {
    runtime,
    pack_projection: {
      entity_count: entities.length,
      entity_state_count: entityStates.length,
      authority_grant_count: authorityGrants.length,
      mediator_binding_count: mediatorBindings.length,
      rule_execution_count: ruleExecutions.length,
      latest_rule_execution: latestRuleExecution
        ? {
            id: latestRuleExecution.id,
            rule_id: latestRuleExecution.rule_id,
            execution_status: latestRuleExecution.execution_status,
            created_at: latestRuleExecution.created_at.toString()
          }
        : null
    }
  };
};

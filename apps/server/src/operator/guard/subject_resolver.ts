import type { AppInfrastructure } from '../../app/context.js'
import type { OperatorContext } from '../auth/types.js'
import type { SubjectResolutionResult } from './types.js'

/**
 * Operator → Subject Entity 解析。
 * 决定 Operator 以哪个主体身份参与 capability 判定。
 */
export const resolveSubjectForOperator = async (
  context: AppInfrastructure,
  operator: OperatorContext,
  packId: string,
  targetAgentId?: string
): Promise<SubjectResolutionResult> => {
  // 1. 显式 targetAgentId
  if (targetAgentId) {
    const binding = await context.repos.identityOperator.findBindingByAgentAndIdentity(targetAgentId, operator.identity_id)

    if (binding) {
      return {
        subjectEntityId: targetAgentId,
        actingAsAgentId: targetAgentId,
        provenance: 'operator_bound_as_agent'
      }
    }
  }

  // 2. 默认 Agent 绑定
  const defaultBinding = await context.repos.identityOperator.findDefaultBindingForIdentity(operator.identity_id)

  if (defaultBinding?.agent_id) {
    return {
      subjectEntityId: defaultBinding.agent_id,
      actingAsAgentId: defaultBinding.agent_id,
      provenance: 'operator_default_binding'
    }
  }

  // 3. 自身 identity
  return {
    subjectEntityId: operator.identity_id,
    actingAsAgentId: null,
    provenance: 'operator_direct_identity'
  }
}

/**
 * Agent 自主行为时，查找控制该 Agent 的 Operator。
 */
export const resolveSubjectForAgentAction = async (
  context: AppInfrastructure,
  agentId: string,
  _packId: string
): Promise<SubjectResolutionResult> => {
  const binding = await context.repos.identityOperator.findOperatorBindingForAgent(agentId)

  if (binding?.identity?.type === 'user') {
    return {
      subjectEntityId: binding.identity.id,
      actingAsAgentId: agentId,
      provenance: 'agent_controlled_by_operator'
    }
  }

  return {
    subjectEntityId: agentId,
    actingAsAgentId: null,
    provenance: 'agent_npc'
  }
}

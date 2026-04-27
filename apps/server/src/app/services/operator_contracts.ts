import { getPackEntityOverviewProjection } from '../../packs/runtime/projections/entity_overview_service.js';
import type { AppContext } from '../context.js';
import { buildInferenceContextV2 } from './context_assembler.js';

export interface OperatorAuthorityInspectorSnapshot {
  pack: {
    id: string;
    name: string;
    version: string;
  };
  subject_entity_id: string;
  authority_resolution: Awaited<ReturnType<typeof buildInferenceContextV2>>['authority_context'];
  mediator_bindings: Awaited<ReturnType<typeof buildInferenceContextV2>>['world_rule_context']['mediator_bindings'];
}

export interface OperatorPerceptionDiffSnapshot {
  pack: {
    id: string;
    name: string;
    version: string;
  };
  subject_entity_id: string;
  visible_state_entries: Awaited<ReturnType<typeof buildInferenceContextV2>>['perception_context']['visible_state_entries'];
  hidden_state_entries: Awaited<ReturnType<typeof buildInferenceContextV2>>['perception_context']['hidden_state_entries'];
}

export interface OperatorRuleExecutionTimelineSnapshot {
  pack: {
    id: string;
    name: string;
    version: string;
  };
  timeline: Awaited<ReturnType<typeof getPackEntityOverviewProjection>>['recent_rule_executions'];
}

export interface OperatorAdvancedContractsSnapshot {
  authority_inspector: OperatorAuthorityInspectorSnapshot;
  perception_diff: OperatorPerceptionDiffSnapshot;
  rule_execution_timeline: OperatorRuleExecutionTimelineSnapshot;
  handoff: {
    frontend_scope: string[];
    backend_scope: string[];
  };
}

const resolvePackMetadata = (context: AppContext) => {
  const pack = context.activePack.getActivePack();
  if (!pack) {
    throw new Error('World pack not ready for operator advanced contracts');
  }
  return {
    pack,
    metadata: {
      id: pack.metadata.id,
      name: pack.metadata.name,
      version: pack.metadata.version
    }
  };
};

export const getOperatorAdvancedContracts = async (
  context: AppContext,
  subjectEntityId: string
): Promise<OperatorAdvancedContractsSnapshot> => {
  const { metadata } = resolvePackMetadata(context);
  const inferenceContext = await buildInferenceContextV2(context, {
    actor_entity_id: subjectEntityId,
    strategy: 'mock'
  });
  const packProjection = await getPackEntityOverviewProjection(context, metadata.id);

  return {
    authority_inspector: {
      pack: metadata,
      subject_entity_id: subjectEntityId,
      authority_resolution: inferenceContext.authority_context,
      mediator_bindings: inferenceContext.world_rule_context.mediator_bindings
    },
    perception_diff: {
      pack: metadata,
      subject_entity_id: subjectEntityId,
      visible_state_entries: inferenceContext.perception_context.visible_state_entries,
      hidden_state_entries: inferenceContext.perception_context.hidden_state_entries
    },
    rule_execution_timeline: {
      pack: metadata,
      timeline: packProjection.recent_rule_executions
    },
    handoff: {
      frontend_scope: [
        'Authority Inspector 页面 UI',
        'Rule Execution Timeline 页面 UI',
        'Perception Diff 页面 UI',
        '筛选器、布局、导航与交互状态管理',
        '可视化与工作台整合'
      ],
      backend_scope: [
        'authority_context / perception_context / mediator provenance 输出',
        'recent_rule_executions timeline 数据输出',
        'pack / entity / rule evidence 合同说明'
      ]
    }
  };
};

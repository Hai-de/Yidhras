import type { SlotConditionContext, SlotConditionResult } from '@yidhras/contracts';

import {
  evaluateContextLength,
  evaluateConversationTurn,
  evaluateKeywordMatch,
  evaluateLogicMatch
} from '../../../../src/inference/slot_condition_evaluators.js';
import type { SlotConditionEvaluator } from '../../../../src/plugins/extensions/slot_condition_registry.js';
import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js';

function adapt(
  fn: (condition: { type: string; [key: string]: unknown }, context: SlotConditionContext) => SlotConditionResult
): (context: SlotConditionContext) => Promise<SlotConditionResult> {
  return async (context: SlotConditionContext) => {
    // 内置评估器从 context.options 中获取对应 condition 参数
    const condition = (context.options ?? {}) as unknown as { type: string; [key: string]: unknown };
    return fn(condition, context);
  };
}

const keywordMatchEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.keyword_match',
  version: '1.0.0',
  evaluate: adapt(evaluateKeywordMatch as (c: { type: string; [key: string]: unknown }, ctx: SlotConditionContext) => SlotConditionResult)
};

const logicMatchEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.logic_match',
  version: '1.0.0',
  evaluate: async (context: SlotConditionContext) => {
    const condition = (context.options ?? {}) as unknown as { expression: Record<string, unknown> };
    return evaluateLogicMatch({ expression: condition.expression as Record<string, unknown> }, context);
  }
};

const conversationTurnEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.conversation_turn',
  version: '1.0.0',
  evaluate: adapt(evaluateConversationTurn as (c: { type: string; [key: string]: unknown }, ctx: SlotConditionContext) => SlotConditionResult)
};

const contextLengthEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.context_length',
  version: '1.0.0',
  evaluate: adapt(evaluateContextLength as (c: { type: string; [key: string]: unknown }, ctx: SlotConditionContext) => SlotConditionResult)
};

export function activate(host: ServerPluginHostApi): void {
  host.registerSlotConditionEvaluator(keywordMatchEvaluator);
  host.registerSlotConditionEvaluator(logicMatchEvaluator);
  host.registerSlotConditionEvaluator(conversationTurnEvaluator);
  host.registerSlotConditionEvaluator(contextLengthEvaluator);
}

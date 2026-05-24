import type { SlotConditionContext, SlotConditionResult } from '@yidhras/contracts';

import {
  evaluateContextLength,
  evaluateConversationTurn,
  evaluateKeywordMatch,
  evaluateLogicMatch
} from '../../../../src/inference/slot_condition_evaluators.js';
import type { SlotConditionEvaluator } from '../../../../src/plugins/extensions/slot_condition_registry.js';
import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ConditionParam = { type: string; [key: string]: unknown };

function adapt(
  fn: (condition: ConditionParam, context: SlotConditionContext) => SlotConditionResult
): (context: SlotConditionContext) => Promise<SlotConditionResult> {
  return async (context: SlotConditionContext) => {
    const options = isRecord(context.options) ? context.options : {};
    return fn(options as ConditionParam, context);
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
    const options = isRecord(context.options) ? context.options : {};
    const expression = isRecord(options.expression) ? options.expression : {};
    return evaluateLogicMatch({ expression }, context);
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

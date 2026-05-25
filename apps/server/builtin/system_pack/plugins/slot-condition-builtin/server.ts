import type { SlotConditionContext, SlotConditionResult } from '@yidhras/contracts';
import { z } from 'zod';

import {
  evaluateContextLength,
  evaluateConversationTurn,
  evaluateKeywordMatch,
  evaluateLogicMatch
} from '../../../../src/inference/slot_condition_evaluators.js';
import type { ServerPluginHostApi } from '../../../../src/plugins/runtime.js';

const comparisonOperatorSchema = z.enum(['gt', 'lt', 'gte', 'lte', 'eq']);

const keywordMatchOptionsSchema = z.object({
  keywords: z.array(z.string()),
  match_mode: z.enum(['any', 'all']).optional()
});

const logicMatchOptionsSchema = z.object({
  expression: z.record(z.string(), z.unknown())
});

const numericComparisonOptionsSchema = z.object({
  operator: comparisonOperatorSchema,
  value: z.number()
});

function validationFailure(key: string, error: z.ZodError): SlotConditionResult {
  return {
    active: false,
    reason: `${key}: invalid options: ${z.prettifyError(error)}`
  };
}

const evaluateKeywordMatchHandler = async (context: SlotConditionContext): Promise<SlotConditionResult> => {
  const parsed = keywordMatchOptionsSchema.safeParse(context.options ?? {});
  if (!parsed.success) {
    return validationFailure('slot_condition.keyword_match', parsed.error);
  }

  return evaluateKeywordMatch(parsed.data, context);
};

const evaluateLogicMatchHandler = async (context: SlotConditionContext): Promise<SlotConditionResult> => {
  const parsed = logicMatchOptionsSchema.safeParse(context.options ?? {});
  if (!parsed.success) {
    return validationFailure('slot_condition.logic_match', parsed.error);
  }

  return evaluateLogicMatch(parsed.data, context);
};

const evaluateConversationTurnHandler = async (context: SlotConditionContext): Promise<SlotConditionResult> => {
  const parsed = numericComparisonOptionsSchema.safeParse(context.options ?? {});
  if (!parsed.success) {
    return validationFailure('slot_condition.conversation_turn', parsed.error);
  }

  return evaluateConversationTurn(parsed.data, context);
};

const evaluateContextLengthHandler = async (context: SlotConditionContext): Promise<SlotConditionResult> => {
  const parsed = numericComparisonOptionsSchema.safeParse(context.options ?? {});
  if (!parsed.success) {
    return validationFailure('slot_condition.context_length', parsed.error);
  }

  return evaluateContextLength(parsed.data, context);
};

export function activate(host: ServerPluginHostApi): void {
  host.registerHandler('slot_condition.keyword_match.evaluate', evaluateKeywordMatchHandler);
  host.registerSlotConditionEvaluator({
    type: 'slot_condition_evaluator',
    name: 'keyword_match',
    key: 'slot_condition.keyword_match',
    version: '1.0.0',
    priority: 100,
    invoke: 'slot_condition.keyword_match.evaluate'
  });

  host.registerHandler('slot_condition.logic_match.evaluate', evaluateLogicMatchHandler);
  host.registerSlotConditionEvaluator({
    type: 'slot_condition_evaluator',
    name: 'logic_match',
    key: 'slot_condition.logic_match',
    version: '1.0.0',
    priority: 100,
    invoke: 'slot_condition.logic_match.evaluate'
  });

  host.registerHandler('slot_condition.conversation_turn.evaluate', evaluateConversationTurnHandler);
  host.registerSlotConditionEvaluator({
    type: 'slot_condition_evaluator',
    name: 'conversation_turn',
    key: 'slot_condition.conversation_turn',
    version: '1.0.0',
    priority: 100,
    invoke: 'slot_condition.conversation_turn.evaluate'
  });

  host.registerHandler('slot_condition.context_length.evaluate', evaluateContextLengthHandler);
  host.registerSlotConditionEvaluator({
    type: 'slot_condition_evaluator',
    name: 'context_length',
    key: 'slot_condition.context_length',
    version: '1.0.0',
    priority: 100,
    invoke: 'slot_condition.context_length.evaluate'
  });
}

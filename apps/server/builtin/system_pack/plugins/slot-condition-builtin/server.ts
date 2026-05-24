import type { SlotConditionContext, SlotConditionResult } from '@yidhras/contracts';
import { z } from 'zod';

import {
  evaluateContextLength,
  evaluateConversationTurn,
  evaluateKeywordMatch,
  evaluateLogicMatch
} from '../../../../src/inference/slot_condition_evaluators.js';
import type { SlotConditionEvaluator } from '../../../../src/plugins/extensions/slot_condition_registry.js';
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

const keywordMatchEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.keyword_match',
  version: '1.0.0',
  async evaluate(context: SlotConditionContext): Promise<SlotConditionResult> {
    const parsed = keywordMatchOptionsSchema.safeParse(context.options ?? {});
    if (!parsed.success) {
      return validationFailure(this.key, parsed.error);
    }

    return evaluateKeywordMatch(parsed.data, context);
  }
};

const logicMatchEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.logic_match',
  version: '1.0.0',
  async evaluate(context: SlotConditionContext): Promise<SlotConditionResult> {
    const parsed = logicMatchOptionsSchema.safeParse(context.options ?? {});
    if (!parsed.success) {
      return validationFailure(this.key, parsed.error);
    }

    return evaluateLogicMatch(parsed.data, context);
  }
};

const conversationTurnEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.conversation_turn',
  version: '1.0.0',
  async evaluate(context: SlotConditionContext): Promise<SlotConditionResult> {
    const parsed = numericComparisonOptionsSchema.safeParse(context.options ?? {});
    if (!parsed.success) {
      return validationFailure(this.key, parsed.error);
    }

    return evaluateConversationTurn(parsed.data, context);
  }
};

const contextLengthEvaluator: SlotConditionEvaluator = {
  key: 'slot_condition.context_length',
  version: '1.0.0',
  async evaluate(context: SlotConditionContext): Promise<SlotConditionResult> {
    const parsed = numericComparisonOptionsSchema.safeParse(context.options ?? {});
    if (!parsed.success) {
      return validationFailure(this.key, parsed.error);
    }

    return evaluateContextLength(parsed.data, context);
  }
};

export function activate(host: ServerPluginHostApi): void {
  host.registerSlotConditionEvaluator(keywordMatchEvaluator);
  host.registerSlotConditionEvaluator(logicMatchEvaluator);
  host.registerSlotConditionEvaluator(conversationTurnEvaluator);
  host.registerSlotConditionEvaluator(contextLengthEvaluator);
}

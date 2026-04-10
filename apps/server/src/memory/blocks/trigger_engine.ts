import { evaluateMemoryLogicExpr } from './logic_dsl.js';
import { createInitialMemoryRuntimeState } from './runtime_state.js';
import type {
  MemoryActivationEvaluation,
  MemoryBehavior,
  MemoryBlock,
  MemoryEvaluationContext,
  MemoryKeywordTrigger,
  MemoryRecentSourceTrigger,
  MemoryRuntimeState,
  MemoryTrigger
} from './types.js';

const containsKeyword = (value: string, keyword: string, caseSensitive = false): boolean => {
  if (caseSensitive) {
    return value.includes(keyword);
  }

  return value.toLowerCase().includes(keyword.toLowerCase());
};

const buildKeywordHaystacks = (block: MemoryBlock, context: MemoryEvaluationContext, trigger: MemoryKeywordTrigger): string[] => {
  const fields = trigger.fields ?? ['content_text'];
  const haystacks: string[] = [];

  for (const field of fields) {
    if (field === 'content_text') {
      haystacks.push(block.content_text);
      continue;
    }

    if (field === 'content_structured' && block.content_structured) {
      haystacks.push(JSON.stringify(block.content_structured));
      continue;
    }

    if (field === 'recent_trace_reasoning') {
      for (const trace of context.recent?.trace ?? []) {
        if (typeof trace.payload.reasoning === 'string') {
          haystacks.push(trace.payload.reasoning);
        }
      }
      continue;
    }

    if (field === 'recent_event_text') {
      for (const event of context.recent?.event ?? []) {
        const title = typeof event.payload.title === 'string' ? event.payload.title : '';
        const description = typeof event.payload.description === 'string' ? event.payload.description : '';
        haystacks.push([title, description].filter(value => value.length > 0).join('\n'));
      }
    }
  }

  return haystacks.filter(value => value.trim().length > 0);
};

const evaluateKeywordTrigger = (
  block: MemoryBlock,
  context: MemoryEvaluationContext,
  trigger: MemoryKeywordTrigger
): boolean => {
  const haystacks = buildKeywordHaystacks(block, context, trigger);
  if (haystacks.length === 0 || trigger.keywords.length === 0) {
    return false;
  }

  const matchesKeyword = (keyword: string): boolean => {
    return haystacks.some(haystack => containsKeyword(haystack, keyword, trigger.case_sensitive ?? false));
  };

  if (trigger.match === 'all') {
    return trigger.keywords.every(matchesKeyword);
  }

  return trigger.keywords.some(matchesKeyword);
};

const evaluateRecentSourceTrigger = (
  context: MemoryEvaluationContext,
  trigger: MemoryRecentSourceTrigger
): boolean => {
  const candidates = context.recent?.[trigger.source] ?? [];

  return candidates.some(candidate => {
    const value = candidate.payload[trigger.match.field];
    switch (trigger.match.op) {
      case 'eq':
        return value === trigger.match.value;
      case 'in':
        return Array.isArray(trigger.match.values) && trigger.match.values.includes(value);
      case 'contains':
        return typeof value === 'string' && typeof trigger.match.value === 'string' && value.includes(trigger.match.value);
      case 'exists':
        return value !== undefined && value !== null;
      case 'gt':
        return typeof value === 'number' && typeof trigger.match.value === 'number' && value > trigger.match.value;
      case 'lt':
        return typeof value === 'number' && typeof trigger.match.value === 'number' && value < trigger.match.value;
      default:
        return false;
    }
  });
};

const evaluateTrigger = (block: MemoryBlock, context: MemoryEvaluationContext, trigger: MemoryTrigger): boolean => {
  switch (trigger.type) {
    case 'keyword':
      return evaluateKeywordTrigger(block, context, trigger);
    case 'logic':
      return evaluateMemoryLogicExpr(trigger.expr, {
        pack_state: context.pack_state,
        recent: context.recent,
        context: {
          attributes: context.attributes,
          current_tick: context.current_tick,
          resolved_agent_id: context.resolved_agent_id,
          pack_id: context.pack_id
        },
        actor_ref: context.actor_ref
      });
    case 'recent_source':
      return evaluateRecentSourceTrigger(context, trigger);
    default:
      return false;
  }
};

const resolveDistanceFromLatestMessage = (block: MemoryBlock, context: MemoryEvaluationContext): number | null => {
  const sourceMessageId = block.source_ref?.source_message_id;
  if (!sourceMessageId) {
    return null;
  }

  const recentTraceIds = (context.recent?.trace ?? []).map(record => record.id);
  const index = recentTraceIds.findIndex(id => id === sourceMessageId || id === block.source_ref?.source_id);
  return index >= 0 ? index : null;
};

const calculateActivationScore = (triggerMatches: Array<{ label: string; score: number }>): number => {
  return triggerMatches.reduce((sum, match) => sum + match.score, 0);
};

const shouldTreatAsAlways = (behavior: MemoryBehavior): boolean => {
  return behavior.activation.mode === 'always' || behavior.activation.triggers.length === 0;
};

const computeMatchedTriggers = (
  block: MemoryBlock,
  behavior: MemoryBehavior,
  context: MemoryEvaluationContext
): Array<{ label: string; score: number }> => {
  if (shouldTreatAsAlways(behavior)) {
    return [{ label: 'always', score: 1 }];
  }

  return behavior.activation.triggers.flatMap((trigger, index) => {
    const matched = evaluateTrigger(block, context, trigger);
    if (!matched) {
      return [];
    }

    return [{
      label: `${trigger.type}:${index}`,
      score: typeof trigger.score === 'number' && Number.isFinite(trigger.score) ? trigger.score : 1
    }];
  });
};

const resolveStatus = (
  behavior: MemoryBehavior,
  state: MemoryRuntimeState,
  nowTick: bigint,
  matched: boolean
): MemoryActivationEvaluation['status'] => {
  const cooldownUntil = state.cooldown_until_tick ? BigInt(state.cooldown_until_tick) : null;
  if (cooldownUntil !== null && cooldownUntil > nowTick) {
    return 'cooling';
  }

  const delayedUntil = state.delayed_until_tick ? BigInt(state.delayed_until_tick) : null;
  if (delayedUntil !== null && delayedUntil > nowTick) {
    return 'delayed';
  }

  const retainUntil = state.retain_until_tick ? BigInt(state.retain_until_tick) : null;
  if (retainUntil !== null && retainUntil > nowTick && !matched) {
    return 'retained';
  }

  if (!matched) {
    return 'inactive';
  }

  if (behavior.retention.delay_rounds_before_insert > 0) {
    return 'delayed';
  }

  return 'active';
};

export const evaluateMemoryBlockActivation = (input: {
  block: MemoryBlock;
  behavior: MemoryBehavior;
  state?: MemoryRuntimeState | null;
  context: MemoryEvaluationContext;
}): MemoryActivationEvaluation => {
  const runtimeState = input.state ?? createInitialMemoryRuntimeState(input.block.id);
  const matchedTriggers = computeMatchedTriggers(input.block, input.behavior, input.context);
  const activationScore = calculateActivationScore(matchedTriggers);
  const matched = matchedTriggers.length > 0 && activationScore >= input.behavior.activation.min_score;
  const nowTick = BigInt(input.context.current_tick);
  const recentDistance = resolveDistanceFromLatestMessage(input.block, input.context);
  const status = resolveStatus(input.behavior, runtimeState, nowTick, matched);

  return {
    memory_id: input.block.id,
    status,
    activation_score: activationScore,
    matched_triggers: matchedTriggers.map(item => item.label),
    reason: matched ? null : 'no_trigger_match',
    recent_distance_from_latest_message: recentDistance
  };
};

export const applyMemoryActivationToRuntimeState = (input: {
  behavior: MemoryBehavior;
  evaluation: MemoryActivationEvaluation;
  previousState?: MemoryRuntimeState | null;
  currentTick: string;
}): MemoryRuntimeState => {
  const previous = input.previousState ?? createInitialMemoryRuntimeState(input.evaluation.memory_id);
  const now = BigInt(input.currentTick);

  const next: MemoryRuntimeState = {
    ...previous,
    memory_id: input.evaluation.memory_id,
    last_activation_score: input.evaluation.activation_score,
    recent_distance_from_latest_message: input.evaluation.recent_distance_from_latest_message,
    currently_active: input.evaluation.status === 'active' || input.evaluation.status === 'retained'
  };

  if (input.evaluation.status === 'active') {
    next.trigger_count = previous.trigger_count + 1;
    next.last_triggered_tick = input.currentTick;
    next.last_inserted_tick = input.currentTick;
    next.delayed_until_tick =
      input.behavior.retention.delay_rounds_before_insert > 0
        ? (now + BigInt(input.behavior.retention.delay_rounds_before_insert)).toString()
        : null;
    next.retain_until_tick =
      input.behavior.retention.retain_rounds_after_trigger > 0
        ? (now + BigInt(input.behavior.retention.retain_rounds_after_trigger)).toString()
        : null;
    next.cooldown_until_tick =
      input.behavior.retention.cooldown_rounds_after_insert > 0
        ? (now + BigInt(input.behavior.retention.cooldown_rounds_after_insert)).toString()
        : null;
    return next;
  }

  if (input.evaluation.status === 'delayed') {
    next.last_triggered_tick = previous.last_triggered_tick ?? input.currentTick;
    next.delayed_until_tick =
      previous.delayed_until_tick ?? (now + BigInt(Math.max(input.behavior.retention.delay_rounds_before_insert, 1))).toString();
    return next;
  }

  if (input.evaluation.status === 'retained') {
    next.retain_until_tick = previous.retain_until_tick;
    return next;
  }

  if (input.evaluation.status === 'cooling') {
    next.cooldown_until_tick = previous.cooldown_until_tick;
    return next;
  }

  next.currently_active = false;
  return next;
};

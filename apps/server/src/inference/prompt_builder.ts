import type { InferenceContext, PromptResolvableContext } from './types.js';

type PromptContext = InferenceContext | PromptResolvableContext;

export const buildContextPromptPayload = (context: PromptContext): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    actor_ref: context.actor_ref,
    actor_display_name: context.actor_display_name,
    resolved_agent_id: context.resolved_agent_id,
    agent_snapshot: context.agent_snapshot,
    attributes: context.attributes,
    visible_variables: 'visible_variables' in context ? context.visible_variables : [],
    variable_context_summary: context.variable_context_summary,
    pack_state: context.pack_state,
    tick: context.tick.toString(),
    world_pack: context.world_pack,
    strategy: context.strategy
  };
  if (context.context_run) {
    payload.context_run = context.context_run;
  }
  if ('binding_ref' in context) {
    payload.binding_ref = context.binding_ref;
  }
  if (context.memory_context) {
    payload.memory_context = context.memory_context;
  }
  if ('policy_summary' in context) {
    payload.policy_summary = context.policy_summary;
  }
  return payload;
};

export const buildOutputContractPrompt = (): string => {
  return [
    'Return a normalized decision object.',
    'Use JSON-compatible values only.',
    'Expected keys: action_type, target_ref, payload, confidence, delay_hint_ticks, reasoning, meta.',
    'Represent all tick-like values as integer strings.'
  ].join('\n');
};

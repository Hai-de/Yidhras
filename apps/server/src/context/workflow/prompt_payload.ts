import type { InferenceContext } from '../../inference/types.js';

export const buildContextPromptPayload = (context: InferenceContext): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    actor_ref: context.actor_ref,
    actor_display_name: context.actor_display_name,
    resolved_agent_id: context.resolved_agent_id,
    agent_snapshot: context.agent_snapshot,
    attributes: context.attributes,
    visible_variables: context.visible_variables,
    variable_context_summary: context.variable_context_summary,
    pack_state: context.pack_state,
    tick: context.tick.toString(),
    world_pack: context.world_pack,
    strategy: context.strategy,
    context_run: context.context_run,
    binding_ref: context.binding_ref,
    memory_context: context.memory_context,
    previous_agent_output: context.previous_agent_output ?? null,
    policy_summary: context.policy_summary
  };

  if (context.agent_conversation_memory) {
    payload['agent_conversation_memory'] = context.agent_conversation_memory;
  }
  if (context.current_agent_id) {
    payload['current_agent_id'] = context.current_agent_id;
  }
  if (context.conversation_profile) {
    payload['conversation_profile'] = context.conversation_profile;
  }

  return payload;
};

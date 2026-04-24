import type { AppContext } from '../../app/context.js';
import { buildInferenceContext } from '../../inference/context_builder.js';
import type { ActorResolvable, InferenceContext } from '../../inference/types.js';
import { resolveAuthorityForSubject, resolveMediatorBindingsForPack } from '../authority/resolver.js';
import { resolvePerceptionForSubject } from '../perception/resolver.js';

export interface InferenceContextV2 {
  base: InferenceContext;
  subject_context: ActorResolvable;
  authority_context: Awaited<ReturnType<typeof resolveAuthorityForSubject>>;
  perception_context: Awaited<ReturnType<typeof resolvePerceptionForSubject>>;
  world_rule_context: {
    mediator_bindings: Awaited<ReturnType<typeof resolveMediatorBindingsForPack>>;
    pack_runtime: InferenceContext['pack_runtime'];
  };
}

export const buildInferenceContextV2 = async (
  context: AppContext,
  input: Parameters<typeof buildInferenceContext>[1]
): Promise<InferenceContextV2> => {
  const base = await buildInferenceContext(context, input);

  const authorityContext = await resolveAuthorityForSubject(context, {
    packId: base.world_pack.id,
    subjectEntityId: base.resolved_agent_id
  });
  const perceptionContext = await resolvePerceptionForSubject(context, {
    packId: base.world_pack.id,
    packState: base.pack_state
  });
  const mediatorBindings = await resolveMediatorBindingsForPack(context, {
    packId: base.world_pack.id
  });

  return {
    base,
    subject_context: {
      actor_ref: base.actor_ref,
      actor_display_name: base.actor_display_name,
      identity: base.identity,
      binding_ref: base.binding_ref,
      resolved_agent_id: base.resolved_agent_id,
      agent_snapshot: base.agent_snapshot
    },
    authority_context: authorityContext,
    perception_context: perceptionContext,
    world_rule_context: {
      mediator_bindings: mediatorBindings,
      pack_runtime: base.pack_runtime
    }
  };
};

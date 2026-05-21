export interface MutationResolvedResult {
  intent: {
    action_intent_id: string;
    operation: string;
    reason: string | null;
    target: Record<string, unknown>;
    requested: Record<string, unknown>;
  };
  baseline: Record<string, unknown>;
  result: {
    absolute: Record<string, unknown>;
  };
}

export const buildMutationResolvedResult = (input: {
  action_intent_id: string;
  operation: string;
  reason: string | null;
  target: Record<string, unknown>;
  requested: Record<string, unknown>;
  baseline: Record<string, unknown>;
  absolute: Record<string, unknown>;
}): MutationResolvedResult => {
  return {
    intent: {
      action_intent_id: input.action_intent_id,
      operation: input.operation,
      reason: input.reason,
      target: input.target,
      requested: input.requested
    },
    baseline: input.baseline,
    result: {
      absolute: input.absolute
    }
  };
};

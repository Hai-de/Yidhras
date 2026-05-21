export const buildOutputContractPrompt = (): string => {
  return [
    'Return a normalized decision object.',
    'Use JSON-compatible values only.',
    'Expected keys: action_type, target_ref, payload, confidence, delay_hint_ticks, reasoning, meta.',
    'Represent all tick-like values as integer strings.'
  ].join('\n');
};

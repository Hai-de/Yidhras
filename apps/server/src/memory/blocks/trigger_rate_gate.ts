import type { MemoryTriggerRateDecisionRecord } from './types.js';

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const FNV_MASK_64 = 0xffffffffffffffffn;
const SAMPLE_DIVISOR_64 = 18446744073709551616;
const MISSING_PACK_ID_SENTINEL = '__no_pack__';

export interface TriggerRateGateSeedInput {
  packId: string | null;
  memoryId: string;
  currentTick: string;
  previousTriggerCount: number;
}

export const buildTriggerRateGateSeed = (input: TriggerRateGateSeedInput): string => {
  return [
    'memory_trigger_rate_gate',
    input.packId ?? MISSING_PACK_ID_SENTINEL,
    input.memoryId,
    input.currentTick,
    String(input.previousTriggerCount)
  ].join('::');
};

export const fnv1a64 = (input: string): bigint => {
  const bytes = new TextEncoder().encode(input);
  let hash = FNV_OFFSET_BASIS_64;

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & FNV_MASK_64;
  }

  return hash;
};

export const computeTriggerRateSample = (seed: string): number => {
  return Number(fnv1a64(seed)) / SAMPLE_DIVISOR_64;
};

export interface EvaluateTriggerRateGateInput extends TriggerRateGateSeedInput {
  triggerRate: number;
  present: boolean;
  applied: boolean;
}

export const evaluateDeterministicTriggerRateGate = (
  input: EvaluateTriggerRateGateInput
): MemoryTriggerRateDecisionRecord => {
  const normalizedRate = Math.max(0, Math.min(1, input.triggerRate));

  if (!input.present) {
    return {
      present: false,
      value: null,
      applied: false,
      sample: null,
      passed: null
    };
  }

  if (!input.applied) {
    return {
      present: true,
      value: input.triggerRate,
      applied: false,
      sample: null,
      passed: null
    };
  }

  if (normalizedRate <= 0) {
    return {
      present: true,
      value: input.triggerRate,
      applied: true,
      sample: null,
      passed: false
    };
  }

  if (normalizedRate >= 1) {
    return {
      present: true,
      value: input.triggerRate,
      applied: true,
      sample: null,
      passed: true
    };
  }

  const seed = buildTriggerRateGateSeed(input);
  const sample = computeTriggerRateSample(seed);

  return {
    present: true,
    value: input.triggerRate,
    applied: true,
    sample,
    passed: sample < normalizedRate
  };
};

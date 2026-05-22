export type StepStrategyKind = 'variable' | 'adaptive';

export interface StepStrategyRange {
  min: bigint;
  max: bigint;
}

export interface AdaptiveConfig {
  targetLoopMs: number;
  scaleUpThresholdMs: number;
  scaleDownThresholdMs: number;
}

export interface StepStrategy {
  kind: StepStrategyKind;
  range: StepStrategyRange;
  loopIntervalMs: number;
  adaptive?: AdaptiveConfig;
}

export interface StepContext {
  currentTick: bigint;
  lastLoopDurationMs: number;
  overlapSkippedCount: number;
  pendingEventCount: number;
}

export function buildStepContext(params: {
  currentTick: bigint;
  lastLoopDurationMs: number;
  overlapSkippedCount: number;
  pendingEventCount: number;
}): StepContext {
  return {
    currentTick: params.currentTick,
    lastLoopDurationMs: params.lastLoopDurationMs,
    overlapSkippedCount: params.overlapSkippedCount,
    pendingEventCount: params.pendingEventCount
  };
}

function clampStep(step: bigint, range: StepStrategyRange): bigint {
  if (step < range.min) return range.min;
  if (step > range.max) return range.max;
  return step;
}

export function computeVariableStep(
  strategy: StepStrategy,
  _ctx: StepContext,
  requestedStep?: bigint
): bigint {
  const step = requestedStep ?? strategy.range.min;
  return clampStep(step, strategy.range);
}

export function computeAdaptiveStep(
  strategy: StepStrategy,
  ctx: StepContext,
  previousStep: bigint
): bigint {
  const adaptive = strategy.adaptive;
  if (!adaptive) return clampStep(previousStep, strategy.range);

  if (ctx.overlapSkippedCount > 0) {
    const reduced = previousStep - 1n;
    return clampStep(reduced > 0n ? reduced : previousStep / 2n, strategy.range);
  }

  if (ctx.lastLoopDurationMs < adaptive.scaleUpThresholdMs) {
    return clampStep(previousStep + 1n, strategy.range);
  }

  if (ctx.lastLoopDurationMs > adaptive.scaleDownThresholdMs) {
    return clampStep(previousStep - 1n, strategy.range);
  }

  return previousStep;
}

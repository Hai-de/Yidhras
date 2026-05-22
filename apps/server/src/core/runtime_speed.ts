import type { StepContext, StepStrategy } from './step_strategy.js';
import { computeAdaptiveStep, computeVariableStep } from './step_strategy.js';

export type RuntimeSpeedSource = 'default' | 'world_pack' | 'override';

export interface RuntimeSpeedSnapshot {
  mode: 'variable' | 'adaptive';
  source: RuntimeSpeedSource;
  strategy: StepStrategy;
  effective_step_ticks: string;
  override_since: number | null;
}

export class RuntimeSpeedPolicy {
  private strategy: StepStrategy;
  private overrideStrategy: StepStrategy | null = null;
  private overrideSince: number | null = null;
  private previousStep: bigint;

  constructor(defaultStrategy?: StepStrategy) {
    this.strategy = defaultStrategy ?? {
      kind: 'variable',
      range: { min: 1n, max: 1n },
      loopIntervalMs: 1000
    };
    this.previousStep = this.strategy.range.min;
  }

  clearOverride(): void {
    this.overrideStrategy = null;
    this.overrideSince = null;
  }

  getStrategy(): StepStrategy {
    return this.overrideStrategy ?? this.strategy;
  }

  setStrategy(strategy: StepStrategy): void {
    this.overrideStrategy = strategy;
    this.overrideSince = Date.now();
    this.previousStep = strategy.range.min;
  }

  getLoopIntervalMs(): number {
    return this.getStrategy().loopIntervalMs;
  }

  getEffectiveStepTicks(ctx: StepContext, requestedStep?: bigint): bigint {
    const active = this.getStrategy();

    if (active.kind === 'adaptive') {
      const result = computeAdaptiveStep(active, ctx, this.previousStep);
      this.previousStep = result;
      return result;
    }

    return computeVariableStep(active, ctx, requestedStep);
  }

  getSnapshot(): RuntimeSpeedSnapshot {
    const active = this.getStrategy();
    const source: RuntimeSpeedSource = this.overrideStrategy !== null
      ? 'override'
      : 'default';

    return {
      mode: active.kind,
      source,
      strategy: active,
      effective_step_ticks: this.previousStep.toString(),
      override_since: this.overrideSince
    };
  }
}

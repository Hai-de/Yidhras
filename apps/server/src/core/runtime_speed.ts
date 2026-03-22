export type RuntimeSpeedSource = 'default' | 'world_pack' | 'override';

export interface RuntimeSpeedSnapshot {
  mode: 'fixed';
  source: RuntimeSpeedSource;
  configured_step_ticks: string | null;
  override_step_ticks: string | null;
  override_since: number | null;
  effective_step_ticks: string;
}

export class RuntimeSpeedPolicy {
  private readonly defaultStepTicks: bigint;
  private configuredStepTicks: bigint | null = null;
  private overrideStepTicks: bigint | null = null;
  private overrideSince: number | null = null;

  constructor(defaultStepTicks: bigint = 1n) {
    this.defaultStepTicks = defaultStepTicks;
  }

  public setConfiguredStepTicks(stepTicks: bigint | null): void {
    this.configuredStepTicks = stepTicks;
  }

  public setOverrideStepTicks(stepTicks: bigint | null): void {
    this.overrideStepTicks = stepTicks;
    this.overrideSince = stepTicks === null ? null : Date.now();
  }

  public clearOverride(): void {
    this.overrideStepTicks = null;
    this.overrideSince = null;
  }

  public getEffectiveStepTicks(): bigint {
    if (this.overrideStepTicks !== null) {
      return this.overrideStepTicks;
    }

    if (this.configuredStepTicks !== null) {
      return this.configuredStepTicks;
    }

    return this.defaultStepTicks;
  }

  public getSnapshot(): RuntimeSpeedSnapshot {
    const source: RuntimeSpeedSource = this.overrideStepTicks !== null
      ? 'override'
      : (this.configuredStepTicks !== null ? 'world_pack' : 'default');

    return {
      mode: 'fixed',
      source,
      configured_step_ticks: this.configuredStepTicks === null ? null : this.configuredStepTicks.toString(),
      override_step_ticks: this.overrideStepTicks === null ? null : this.overrideStepTicks.toString(),
      override_since: this.overrideSince,
      effective_step_ticks: this.getEffectiveStepTicks().toString()
    };
  }
}

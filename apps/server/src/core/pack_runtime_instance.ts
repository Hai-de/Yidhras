import type { RuntimeClockProjectionSnapshot } from '../app/runtime/runtime_clock_projection.js';
import { ChronosEngine } from '../clock/engine.js';
import type { CalendarConfig } from '../clock/types.js';
import type { WorldPack } from '../packs/manifest/loader.js';
import type { PackRuntimeClockSnapshot, PackRuntimeHandle, PackRuntimeHealthSnapshot } from './pack_runtime_handle.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';
import { RuntimeSpeedPolicy, type RuntimeSpeedSnapshot } from './runtime_speed.js';
import type { StepContext, StepStrategy } from './step_strategy.js';
import { getWorldPackRuntimeConfig } from './world_pack_runtime.js';

const buildPackRuntimeClock = (pack: WorldPack): ChronosEngine => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
  const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
  const runtimeConfig = getWorldPackRuntimeConfig(pack);
  return new ChronosEngine({ calendarConfigs: calendars, initialTicks: runtimeConfig.initialTick });
};

const buildDefaultStepStrategy = (pack: WorldPack): StepStrategy => {
  const runtimeConfig = getWorldPackRuntimeConfig(pack);
  return runtimeConfig.stepStrategy ?? {
    kind: 'variable',
    range: { min: 1n, max: 1n },
    loopIntervalMs: 1000
  };
};

export interface PackRuntimeInstanceOptions {
  pack: WorldPack;
  packFolderName: string;
  instanceId: string;
  clock?: ChronosEngine;
  runtimeSpeed?: RuntimeSpeedPolicy;
  initialStatus?: PackRuntimeHealthSnapshot['status'];
  initialMessage?: string | null;
}

export class PackRuntimeInstance implements PackRuntimeHost {
  private readonly pack: WorldPack;
  private readonly packFolderName: string;
  private readonly clock: ChronosEngine;
  private readonly runtimeSpeed: RuntimeSpeedPolicy;
  private health: PackRuntimeHealthSnapshot;
  private readonly handle: PackRuntimeHandle;
  private currentRevision = 0n;

  constructor(options: PackRuntimeInstanceOptions) {
    this.pack = options.pack;
    this.packFolderName = options.packFolderName;
    this.clock = options.clock ?? buildPackRuntimeClock(options.pack);
    this.runtimeSpeed = options.runtimeSpeed ?? new RuntimeSpeedPolicy(buildDefaultStepStrategy(options.pack));
    this.health = {
      status: options.initialStatus ?? 'loaded',
      message: options.initialMessage ?? null
    };
    this.handle = {
      instance_id: options.instanceId,
      metadata_id: this.pack.metadata.id,
      pack_folder_name: this.packFolderName,
      pack: this.pack,
      getClockSnapshot: () => this.getClockSnapshot(),
      getRuntimeSpeedSnapshot: () => this.getRuntimeSpeedSnapshot(),
      getHealthSnapshot: () => this.getHealthSnapshot()
    };
  }

  public load(): void {
    this.health = { status: 'loaded', message: this.health.message ?? null };
  }

  public start(): void {
    this.health = { status: 'running', message: this.health.message ?? null };
  }

  public stop(): void {
    this.health = { status: 'stopped', message: this.health.message ?? null };
  }

  public dispose(): void {
    this.health = { status: 'stopped', message: null };
  }

  public getHandle(): PackRuntimeHandle {
    return this.handle;
  }

  public getPack(): WorldPack {
    return this.pack;
  }

  public getClock(): ChronosEngine {
    return this.clock;
  }

  public getStepStrategy(): StepStrategy {
    return this.runtimeSpeed.getStrategy();
  }

  public setStepStrategy(strategy: StepStrategy): void {
    this.runtimeSpeed.setStrategy(strategy);
  }

  public getEffectiveStepTicks(ctx: StepContext, requestedStep?: bigint): bigint {
    return this.runtimeSpeed.getEffectiveStepTicks(ctx, requestedStep);
  }

  public getLoopIntervalMs(): number {
    return this.runtimeSpeed.getLoopIntervalMs();
  }

  public getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot {
    return this.runtimeSpeed.getSnapshot();
  }

  public getHealthSnapshot(): PackRuntimeHealthSnapshot {
    return this.health;
  }

  public getClockSnapshot(): PackRuntimeClockSnapshot {
    return {
      current_tick: this.clock.getTicks().toString()
    };
  }

  public clearRuntimeSpeedOverride(): void {
    this.runtimeSpeed.clearOverride();
  }

  public getPackId(): string {
    return this.handle.instance_id;
  }

  public getCurrentTick(): bigint {
    return this.clock.getTicks();
  }

  public getCurrentRevision(): bigint {
    return this.currentRevision;
  }

  public getAllTimes(): unknown {
    return this.clock.getAllTimes();
  }

  public getStepTicks(): bigint {
    return this.getStepStrategy().range.min;
  }

  public step(amount: bigint = 1n): void {
    this.clock.tick(amount);
    this.currentRevision = this.clock.getTicks();
  }

  public applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void {
    this.clock.setTicks(BigInt(snapshot.current_tick));
    this.currentRevision = BigInt(snapshot.current_revision);
  }

  public getPackSlotDeclarations(): Record<string, Record<string, unknown>> | null {
    const slots = this.pack.ai?.slots;
    if (!slots) return null;
    return slots;
  }
}

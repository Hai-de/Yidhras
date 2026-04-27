import { ChronosEngine } from '../clock/engine.js';
import type { CalendarConfig } from '../clock/types.js';
import type { WorldPack } from '../packs/manifest/loader.js';
import type { PackRuntimeClockSnapshot, PackRuntimeHandle, PackRuntimeHealthSnapshot } from './pack_runtime_handle.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';
import { RuntimeSpeedPolicy, type RuntimeSpeedSnapshot } from './runtime_speed.js';
import { getWorldPackRuntimeConfig } from './world_pack_runtime.js';

const buildPackRuntimeClock = (pack: WorldPack): ChronosEngine => {
  const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
  const runtimeConfig = getWorldPackRuntimeConfig(pack);
  return new ChronosEngine({ calendarConfigs: calendars, initialTicks: runtimeConfig.initialTick });
};

const configureRuntimeSpeedFromPack = (runtimeSpeed: RuntimeSpeedPolicy, pack: WorldPack): void => {
  const runtimeConfig = getWorldPackRuntimeConfig(pack);
  if (runtimeConfig.configuredStepTicks !== undefined && runtimeConfig.configuredStepTicks > 0n) {
    runtimeSpeed.setConfiguredStepTicks(runtimeConfig.configuredStepTicks);
    return;
  }

  runtimeSpeed.setConfiguredStepTicks(null);
};

export interface PackRuntimeInstanceOptions {
  pack: WorldPack;
  packFolderName: string;
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

  constructor(options: PackRuntimeInstanceOptions) {
    this.pack = options.pack;
    this.packFolderName = options.packFolderName;
    this.clock = options.clock ?? buildPackRuntimeClock(options.pack);
    this.runtimeSpeed = options.runtimeSpeed ?? new RuntimeSpeedPolicy(1n);
    configureRuntimeSpeedFromPack(this.runtimeSpeed, this.pack);
    this.health = {
      status: options.initialStatus ?? 'loaded',
      message: options.initialMessage ?? null
    };
    this.handle = {
      pack_id: this.pack.metadata.id,
      pack_folder_name: this.packFolderName,
      pack: this.pack,
      getClockSnapshot: () => this.getClockSnapshot(),
      getRuntimeSpeedSnapshot: () => this.getRuntimeSpeedSnapshot(),
      getHealthSnapshot: () => this.getHealthSnapshot()
    };
  }

  public async load(): Promise<void> {
    this.health = {
      status: 'loaded',
      message: this.health.message ?? null
    };
  }

  public async start(): Promise<void> {
    this.health = {
      status: 'running',
      message: this.health.message ?? null
    };
  }

  public async stop(): Promise<void> {
    this.health = {
      status: 'stopped',
      message: this.health.message ?? null
    };
  }

  public async dispose(): Promise<void> {
    this.health = {
      status: 'stopped',
      message: null
    };
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

  public setRuntimeSpeedOverride(stepTicks: bigint): void {
    this.runtimeSpeed.setOverrideStepTicks(stepTicks);
  }

  public clearRuntimeSpeedOverride(): void {
    this.runtimeSpeed.clearOverride();
  }
}

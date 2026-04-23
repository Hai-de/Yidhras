import type { RuntimeDatabaseBootstrap } from '../app/runtime/runtime_bootstrap.js';
import type { RuntimeClockProjectionSnapshot } from '../app/runtime/runtime_clock_projection.js';
import type { ActivePackRuntimeFacade } from '../app/services/app_context_ports.js';
import { ChronosEngine } from '../clock/engine.js';
import type { CalendarConfig } from '../clock/types.js';
import { renderNarrativeTemplate } from '../narrative/resolver.js';
import {
  createPromptVariableContext,
  createPromptVariableLayer,
  normalizePromptVariableRecord
} from '../narrative/variable_context.js';
import { type PackManifestLoader, type WorldPack } from '../packs/manifest/loader.js';
import type { PermissionContext } from '../permission/types.js';
import { PackRuntimeInstance } from './pack_runtime_instance.js';
import type { PackRuntimeRegistry } from './pack_runtime_registry.js';
import { activateWorldPackRuntime } from './runtime_activation.js';
import { type RuntimeSpeedPolicy, type RuntimeSpeedSnapshot } from './runtime_speed.js';

export interface DefaultActivePackRuntimeFacadeOptions {
  loader: Pick<PackManifestLoader, 'loadPack'>;
  prisma: Parameters<typeof activateWorldPackRuntime>[0]['prisma'];
  packsDir: string;
  runtimeSpeed: RuntimeSpeedPolicy;
  runtimeBootstrap: RuntimeDatabaseBootstrap;
  runtimeRegistry: Pick<PackRuntimeRegistry, 'register'>;
}

export class DefaultActivePackRuntimeFacade implements ActivePackRuntimeFacade {
  private readonly loader: Pick<PackManifestLoader, 'loadPack'>;
  private readonly prisma: Parameters<typeof activateWorldPackRuntime>[0]['prisma'];
  private readonly packsDir: string;
  private readonly runtimeSpeed: RuntimeSpeedPolicy;
  private readonly runtimeBootstrap: RuntimeDatabaseBootstrap;
  private readonly runtimeRegistry: Pick<PackRuntimeRegistry, 'register'>;
  private activePack?: WorldPack;
  private currentRevision: bigint = 0n;
  private clock: ChronosEngine;

  constructor(options: DefaultActivePackRuntimeFacadeOptions) {
    this.loader = options.loader;
    this.prisma = options.prisma;
    this.packsDir = options.packsDir;
    this.runtimeSpeed = options.runtimeSpeed;
    this.runtimeBootstrap = options.runtimeBootstrap;
    this.runtimeRegistry = options.runtimeRegistry;
    this.clock = new ChronosEngine([], 0n);
  }

  public async init(packFolderName: string): Promise<void> {
    await this.runtimeBootstrap.prepareDatabase();

    const activated = await activateWorldPackRuntime({
      packFolderName,
      loader: this.loader,
      prisma: this.prisma,
      packsDir: this.packsDir,
      runtimeSpeed: this.runtimeSpeed
    });

    this.activePack = activated.pack;
    this.clock = activated.clock;
    this.currentRevision = activated.clock.getTicks();

    if (!this.activePack || !this.activePack.metadata.id) {
      throw new Error(
        `[SimulationManager] Pack loaded but metadata.id is missing. ` +
        `This indicates a silent fallback to an invalid pack state.`
      );
    }

    const projectionClock = this.createProjectionClock(this.activePack);

    this.runtimeRegistry.register(
      activated.pack.metadata.id,
      new PackRuntimeInstance({
        pack: activated.pack,
        packFolderName,
        clock: projectionClock,
        runtimeSpeed: this.runtimeSpeed,
        initialStatus: 'running'
      })
    );

    console.log(`[SimulationManager] Initialized with pack: ${activated.pack.metadata.name}`);
  }

  public getActivePack(): WorldPack | undefined {
    return this.activePack;
  }

  public getClock(): ChronosEngine {
    return this.clock;
  }

  public getCurrentRevision(): bigint {
    return this.currentRevision;
  }


  public resolvePackVariables(template: string, permission?: PermissionContext, actorState?: Record<string, unknown> | null): string {
    const pack = this.activePack;
    const layers = [
      createPromptVariableLayer({
        namespace: 'pack',
        values: normalizePromptVariableRecord({
          metadata: pack?.metadata ?? null,
          variables: pack?.variables ?? {}
        }),
        alias_values: normalizePromptVariableRecord({
          ...(pack?.variables ?? {}),
          world_name: pack?.metadata.name ?? '',
          pack_name: pack?.metadata.name ?? '',
          pack_id: pack?.metadata.id ?? ''
        }),
        metadata: {
          source_label: 'simulation-active-pack',
          trusted: true
        }
      }),
      createPromptVariableLayer({
        namespace: 'runtime',
        values: normalizePromptVariableRecord({
          current_tick: this.getCurrentTick().toString()
        }),
        alias_values: normalizePromptVariableRecord({
          current_tick: this.getCurrentTick().toString()
        }),
        metadata: {
          source_label: 'simulation-runtime',
          trusted: true
        }
      })
    ];

    if (actorState && Object.keys(actorState).length > 0) {
      layers.push(createPromptVariableLayer({
        namespace: 'actor_state',
        values: normalizePromptVariableRecord(actorState),
        alias_values: normalizePromptVariableRecord(actorState),
        metadata: {
          source_label: 'simulation-actor-state',
          trusted: true
        }
      }));
    }

    const variableContext = createPromptVariableContext({ layers });

    return renderNarrativeTemplate({
      template,
      variableContext,
      permission,
      templateSource: 'simulation.resolvePackVariables'
    }).text;
  }

  public getStepTicks(): bigint {
    return this.runtimeSpeed.getEffectiveStepTicks();
  }

  public getRuntimeSpeedSnapshot(): RuntimeSpeedSnapshot {
    return this.runtimeSpeed.getSnapshot();
  }

  public setRuntimeSpeedOverride(stepTicks: bigint): void {
    this.runtimeSpeed.setOverrideStepTicks(stepTicks);
  }

  public clearRuntimeSpeedOverride(): void {
    this.runtimeSpeed.clearOverride();
  }

  public getCurrentTick(): bigint {
    return this.clock.getTicks();
  }

  public getAllTimes() {
    return this.clock.getAllTimes();
  }

  public applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void {
    this.clock.setTicks(BigInt(snapshot.current_tick));
    this.currentRevision = BigInt(snapshot.current_revision);
  }

  public async step(amount: bigint = 1n): Promise<void> {
    this.clock.tick(amount);
    this.currentRevision = this.clock.getTicks();
  }

  private createProjectionClock(pack: WorldPack): ChronosEngine {
    const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
    return new ChronosEngine(calendars, this.clock.getTicks());
  }
}

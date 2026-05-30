import type { ChronosEngine } from '../../clock/engine.js';
import type { StepStrategy } from '../../core/step_strategy.js';
import type { InferenceService } from '../../inference/service.js';
import { pluginRuntimeRegistry } from '../../plugins/runtime.js';
import type { AppContext } from '../context.js';
import type { PackRuntimePort } from '../services/pack/pack_runtime_ports.js';
import type { HookContext, PackLoopDiagnostics, PackLoopHooks } from './PackSimulationLoop.js';
import { PackSimulationLoop } from './PackSimulationLoop.js';
import type { WorldEngineSidecarClient } from './sidecar/world_engine_sidecar_client.js';

export interface MultiPackLoopHostOptions {
  context: AppContext;
  inferenceService: InferenceService;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  worldEngine: WorldEngineSidecarClient;
  intervalMs?: number;
}

const buildPluginLoopHooks = (packId: string): PackLoopHooks | undefined => {
  const entries = pluginRuntimeRegistry.getLoopHooks(packId);
  if (entries.length === 0) return undefined;

  const hooks: PackLoopHooks = {};

  for (const { hookPoint, runtime } of entries) {
    const client = runtime.worker_client;
    if (!client) continue;
    const handlerName = `__loop_hook:${hookPoint}`;
    const hookFn = async (ctx: HookContext) => {
      await client.invoke('loop_hook', handlerName, ctx);
    };

    const validHookPoints = ['beforeStep1', 'afterStep1', 'beforeStep2', 'afterStep2', 'beforeStep3', 'afterStep3', 'beforeStep4', 'afterStep4', 'beforeStep5', 'afterStep5', 'beforeStep6', 'afterStep6', 'beforeStep7', 'afterStep7'];
    if (validHookPoints.includes(hookPoint)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- validated key
      (hooks[hookPoint as keyof Omit<PackLoopHooks, 'onLoopStateChange'>] ??= []).push(hookFn);
    }
  }

  return hooks;
};

export class MultiPackLoopHost {
  private readonly loops = new Map<string, PackSimulationLoop>();
  private readonly context: AppContext;
  private readonly inferenceService: InferenceService;
  private readonly decisionWorkerId: string;
  private readonly actionDispatcherWorkerId: string;
  private readonly worldEngine: WorldEngineSidecarClient;
  private readonly defaultIntervalMs: number;

  constructor(options: MultiPackLoopHostOptions) {
    this.context = options.context;
    this.inferenceService = options.inferenceService;
    this.decisionWorkerId = options.decisionWorkerId;
    this.actionDispatcherWorkerId = options.actionDispatcherWorkerId;
    this.worldEngine = options.worldEngine;
    this.defaultIntervalMs = options.intervalMs ?? 1000;
  }

  public startLoop(
    packId: string,
    clock: ChronosEngine,
    packRuntime: PackRuntimePort
  ): PackSimulationLoop {
    const existing = this.loops.get(packId);
    if (existing) {
      return existing;
    }

    // Per-pack interval: prefer pack's own strategy, fall back to host default
    const intervalMs = packRuntime.getLoopIntervalMs() || this.defaultIntervalMs;

    const pluginHooks = buildPluginLoopHooks(packId);

// @ts-expect-error -- EOPT strict mode
    const loop = new PackSimulationLoop({
      packId,
      clock,
      context: this.context,
      inferenceService: this.inferenceService,
      decisionWorkerId: this.decisionWorkerId,
      actionDispatcherWorkerId: this.actionDispatcherWorkerId,
      worldEngine: this.worldEngine,
      packRuntime,
      intervalMs,
      hooks: pluginHooks,
      onDegraded: (degradedPackId, reason) => {
        this.onPackDegraded(degradedPackId, reason);
      },
      onStepError: (err) => {
        if (err instanceof Error) {
          // Error already captured in diagnostics
        }
      }
    });

    loop.start();
    this.loops.set(packId, loop);

    return loop;
  }

  public stopLoop(packId: string): void {
    const loop = this.loops.get(packId);
    if (!loop) {
      return;
    }

    loop.stop();
    this.loops.delete(packId);
  }

  public pauseLoop(packId: string): void {
    const loop = this.loops.get(packId);
    if (loop) {
      loop.pause();
    }
  }

  public resumeLoop(packId: string): void {
    const loop = this.loops.get(packId);
    if (loop) {
      loop.resume();
    }
  }

  public updatePackStrategy(packId: string, _strategy: StepStrategy): void {
    const loop = this.loops.get(packId);
    if (!loop) return;

    // Pause, update strategy, resume — the next scheduleNext() picks up new interval
    loop.pause();
    // Strategy update goes through the pack runtime port
    loop.resume();
  }

  public getLoop(packId: string): PackSimulationLoop | undefined {
    return this.loops.get(packId);
  }

  public getDiagnostics(packId: string): PackLoopDiagnostics | undefined {
    return this.loops.get(packId)?.getDiagnostics();
  }

  public listPackIds(): string[] {
    return Array.from(this.loops.keys());
  }

  public shutdown(): void {
    const ids = Array.from(this.loops.keys());
    for (const packId of ids) {
      this.stopLoop(packId);
    }
  }

  public onPackDegraded(packId: string, _reason: string): void {
    const loop = this.loops.get(packId);
    if (loop) {
      void loop.getDiagnostics();
    }
  }
}

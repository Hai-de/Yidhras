import type { ChronosEngine } from '../../clock/engine.js';
import type { InferenceService } from '../../inference/service.js';
import type { AppContext } from '../context.js';
import type { PackLoopDiagnostics } from './PackSimulationLoop.js';
import { PackSimulationLoop } from './PackSimulationLoop.js';

export interface MultiPackLoopHostOptions {
  context: AppContext;
  inferenceService: InferenceService;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
  intervalMs?: number;
}

export class MultiPackLoopHost {
  private readonly loops = new Map<string, PackSimulationLoop>();
  private readonly context: AppContext;
  private readonly inferenceService: InferenceService;
  private readonly decisionWorkerId: string;
  private readonly actionDispatcherWorkerId: string;
  private readonly intervalMs: number;

  constructor(options: MultiPackLoopHostOptions) {
    this.context = options.context;
    this.inferenceService = options.inferenceService;
    this.decisionWorkerId = options.decisionWorkerId;
    this.actionDispatcherWorkerId = options.actionDispatcherWorkerId;
    this.intervalMs = options.intervalMs ?? 1000;
  }

  public startLoop(packId: string, clock: ChronosEngine): PackSimulationLoop {
    const existing = this.loops.get(packId);
    if (existing) {
      return existing;
    }

    const loop = new PackSimulationLoop({
      packId,
      clock,
      context: this.context,
      inferenceService: this.inferenceService,
      decisionWorkerId: this.decisionWorkerId,
      actionDispatcherWorkerId: this.actionDispatcherWorkerId,
      intervalMs: this.intervalMs,
      onDegraded: (degradedPackId, reason) => {
        this.onPackDegraded(degradedPackId, reason);
      },
      onStepError: (err) => {
        // Log but don't crash — per-pack isolation
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
    // The pack is already paused by PackSimulationLoop.
    // Emit degraded state — this will be wired to PackRuntimeRegistry in Phase 4.
    const loop = this.loops.get(packId);
    if (loop) {
      // Degraded state is reflected in diagnostics.consecutive_failures >= threshold
      // and status 'paused'. Diagnostics are available via loop.getDiagnostics().
      void loop.getDiagnostics();
    }
  }
}

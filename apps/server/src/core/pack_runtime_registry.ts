import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';

export type PackRuntimeStatus = 'loading' | 'ready' | 'degraded' | 'unloading' | 'gone';

export interface PackRuntimeState {
  status: PackRuntimeStatus;
  degradedReason?: string;
  updatedAt: number;
}

export interface PackRuntimeRegistry {
  listLoadedPackIds(): string[];
  listHandles(): PackRuntimeHandle[];
  getHandle(packId: string): PackRuntimeHandle | null;
  getHost(packId: string): PackRuntimeHost | null;
  register(packId: string, host: PackRuntimeHost): void;
  unregister(packId: string): boolean;

  // State machine
  getState(packId: string): PackRuntimeState | null;
  getStatus(packId: string): PackRuntimeStatus | null;
  transitionTo(packId: string, status: PackRuntimeStatus, metadata?: { degradedReason?: string }): void;
}

export class InMemoryPackRuntimeRegistry implements PackRuntimeRegistry {
  private readonly hosts = new Map<string, PackRuntimeHost>();
  private readonly states = new Map<string, PackRuntimeState>();

  public listLoadedPackIds(): string[] {
    return Array.from(this.hosts.keys());
  }

  public listHandles(): PackRuntimeHandle[] {
    return Array.from(this.hosts.values()).map(host => host.getHandle());
  }

  public getHandle(packId: string): PackRuntimeHandle | null {
    return this.hosts.get(packId)?.getHandle() ?? null;
  }

  public getHost(packId: string): PackRuntimeHost | null {
    return this.hosts.get(packId) ?? null;
  }

  public register(packId: string, host: PackRuntimeHost): void {
    this.hosts.set(packId, host);
    this.transitionTo(packId, 'ready');
  }

  public unregister(packId: string): boolean {
    this.transitionTo(packId, 'gone');
    this.states.delete(packId);
    return this.hosts.delete(packId);
  }

  // -- State machine --

  public getState(packId: string): PackRuntimeState | null {
    return this.states.get(packId) ?? null;
  }

  public getStatus(packId: string): PackRuntimeStatus | null {
    return this.states.get(packId)?.status ?? null;
  }

  public transitionTo(packId: string, status: PackRuntimeStatus, metadata?: { degradedReason?: string }): void {
    const existing = this.states.get(packId);
    this.states.set(packId, {
      status,
      degradedReason: metadata?.degradedReason ?? existing?.degradedReason,
      updatedAt: Date.now()
    });
  }

  /** Set loading state before pack is fully initialized. */
  public markLoading(packId: string): void {
    this.transitionTo(packId, 'loading');
  }

  /** Set degraded state (e.g. after crash threshold reached). */
  public markDegraded(packId: string, reason: string): void {
    this.transitionTo(packId, 'degraded', { degradedReason: reason });
  }

  /** Set unloading state before disposal. */
  public markUnloading(packId: string): void {
    this.transitionTo(packId, 'unloading');
  }
}

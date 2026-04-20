import type { PackRuntimeHandle } from './pack_runtime_handle.js';
import type { PackRuntimeHost } from './pack_runtime_host.js';

export interface PackRuntimeRegistry {
  listLoadedPackIds(): string[];
  listHandles(): PackRuntimeHandle[];
  getHandle(packId: string): PackRuntimeHandle | null;
  getHost(packId: string): PackRuntimeHost | null;
  register(packId: string, host: PackRuntimeHost): void;
  unregister(packId: string): boolean;
}

export class InMemoryPackRuntimeRegistry implements PackRuntimeRegistry {
  private readonly hosts = new Map<string, PackRuntimeHost>();

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
  }

  public unregister(packId: string): boolean {
    return this.hosts.delete(packId);
  }
}

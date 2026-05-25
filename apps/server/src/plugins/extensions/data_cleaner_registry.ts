import type { DataCleaner, DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts';

export interface DataCleanerOwner {
  readonly packId: string;
  readonly installationId: string;
  readonly pluginId: string;
}

class DataCleanerRegistry {
  private cleaners = new Map<string, DataCleaner>();
  private owners = new Map<string, DataCleanerOwner>();

  public register(cleaner: DataCleaner, owner?: DataCleanerOwner): void {
    if (this.cleaners.has(cleaner.key)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- has() guard above
      const existing = this.cleaners.get(cleaner.key)!;
      if (existing.version === cleaner.version) return;
    }

    this.cleaners.set(cleaner.key, cleaner);
    if (owner) {
      this.owners.set(cleaner.key, owner);
    } else {
      this.owners.delete(cleaner.key);
    }
  }

  public get(key: string): DataCleaner | undefined {
    return this.cleaners.get(key);
  }

  public list(): DataCleaner[] {
    return [...this.cleaners.values()];
  }

  public listByPack(packId: string): DataCleaner[] {
    const result: DataCleaner[] = [];
    for (const [key, owner] of this.owners.entries()) {
      if (owner.packId === packId) {
        const cleaner = this.cleaners.get(key);
        if (cleaner) result.push(cleaner);
      }
    }
    return result;
  }

  public keys(): string[] {
    return [...this.cleaners.keys()];
  }

  public getOwner(key: string): DataCleanerOwner | undefined {
    return this.owners.get(key);
  }

  public unregisterByOwner(owner: Pick<DataCleanerOwner, 'packId' | 'installationId'>): void {
    for (const [key, registeredOwner] of this.owners.entries()) {
      if (registeredOwner.packId === owner.packId && registeredOwner.installationId === owner.installationId) {
        this.cleaners.delete(key);
        this.owners.delete(key);
      }
    }
  }

  public clearPack(packId: string): void {
    for (const [key, owner] of this.owners.entries()) {
      if (owner.packId === packId) {
        this.cleaners.delete(key);
        this.owners.delete(key);
      }
    }
  }

  public async clean(key: string, input: DataCleanerInput): Promise<DataCleanerOutput> {
    const cleaner = this.cleaners.get(key);
    if (!cleaner) {
      throw new Error(`DataCleaner not found: ${key}`);
    }

    return cleaner.clean(input);
  }

  public clear(): void {
    this.cleaners.clear();
    this.owners.clear();
  }
}

export const dataCleanerRegistry = new DataCleanerRegistry();

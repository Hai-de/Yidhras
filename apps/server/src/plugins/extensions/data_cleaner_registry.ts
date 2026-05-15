import type { DataCleaner, DataCleanerInput, DataCleanerOutput } from '@yidhras/contracts';

class DataCleanerRegistry {
  private cleaners = new Map<string, DataCleaner>();

  public register(cleaner: DataCleaner): void {
    if (this.cleaners.has(cleaner.key)) {
      const existing = this.cleaners.get(cleaner.key)!;
      if (existing.version === cleaner.version) return;
    }

    this.cleaners.set(cleaner.key, cleaner);
  }

  public get(key: string): DataCleaner | undefined {
    return this.cleaners.get(key);
  }

  public list(): DataCleaner[] {
    return [...this.cleaners.values()];
  }

  public keys(): string[] {
    return [...this.cleaners.keys()];
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
  }
}

export const dataCleanerRegistry = new DataCleanerRegistry();

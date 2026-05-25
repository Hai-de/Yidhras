import type { SlotTransformContext, SlotTransformResult } from '@yidhras/contracts';

/**
 * 内容变换器接口（变换型）。
 * key 格式：slot_transform.<name>
 */
export interface SlotContentTransformer {
  readonly key: string;
  readonly version: string;
  transform(content: string, context: SlotTransformContext): Promise<SlotTransformResult>;
}

class SlotContentTransformRegistry {
  /** per-pack 命名空间：packId → (key → transformer) */
  private store = new Map<string, Map<string, SlotContentTransformer>>();

  /**
   * 注册变换器到指定 pack。
   * 同 pack 内 key 冲突 → 抛错；不同 pack 允许同名 key。
   */
  public register(packId: string, transformer: SlotContentTransformer): void {
    let packStore = this.store.get(packId);
    if (!packStore) {
      packStore = new Map<string, SlotContentTransformer>();
      this.store.set(packId, packStore);
    }

    if (packStore.has(transformer.key)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- has() guard above
      const existing = packStore.get(transformer.key)!;
      if (existing.version === transformer.version) {
        return;
      }
      throw new Error(
        `SlotContentTransformer key conflict in pack '${packId}': '${transformer.key}' already registered (v${existing.version}), tried to register v${transformer.version}`
      );
    }

    packStore.set(transformer.key, transformer);
  }

  public get(packId: string, key: string): SlotContentTransformer | undefined {
    return this.store.get(packId)?.get(key);
  }

  public list(packId: string): SlotContentTransformer[] {
    const packStore = this.store.get(packId);
    if (!packStore) {
      return [];
    }
    return [...packStore.values()];
  }

  public keys(packId: string): string[] {
    const packStore = this.store.get(packId);
    if (!packStore) {
      return [];
    }
    return [...packStore.keys()];
  }

  public async transform(
    packId: string,
    key: string,
    content: string,
    context: SlotTransformContext
  ): Promise<SlotTransformResult> {
    const transformer = this.get(packId, key);
    if (!transformer) {
      return {
        transformed: content,
        metadata: { error: `SlotContentTransformer not found: ${key} in pack ${packId}` }
      };
    }

    return transformer.transform(content, context);
  }

  public clearPack(packId: string): void {
    this.store.delete(packId);
  }

  public clear(): void {
    this.store.clear();
  }
}

export const slotContentTransformRegistry = new SlotContentTransformRegistry();

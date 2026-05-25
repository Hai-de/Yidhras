import type { SlotConditionContext, SlotConditionResult } from '@yidhras/contracts';

/**
 * 条件评估器接口（门控型）。
 * key 格式：slot_condition.<name>
 */
export interface SlotConditionEvaluator {
  readonly key: string;
  readonly version: string;
  evaluate(context: SlotConditionContext): Promise<SlotConditionResult>;
}

class SlotConditionRegistry {
  /** per-pack 命名空间：packId → (key → evaluator) */
  private store = new Map<string, Map<string, SlotConditionEvaluator>>();

  /**
   * 注册评估器到指定 pack。
   * 同 pack 内 key 冲突 → 抛错；不同 pack 允许同名 key。
   */
  public register(packId: string, evaluator: SlotConditionEvaluator): void {
    let packStore = this.store.get(packId);
    if (!packStore) {
      packStore = new Map<string, SlotConditionEvaluator>();
      this.store.set(packId, packStore);
    }

    if (packStore.has(evaluator.key)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- has() guard above
      const existing = packStore.get(evaluator.key)!;
      if (existing.version === evaluator.version) {
        return;
      }
      throw new Error(
        `SlotConditionEvaluator key conflict in pack '${packId}': '${evaluator.key}' already registered (v${existing.version}), tried to register v${evaluator.version}`
      );
    }

    packStore.set(evaluator.key, evaluator);
  }

  /**
   * 注册全局内置评估器（标记为 builtin，pack 级可覆盖）。
   * 仅在目标 pack 不存在同 key 时生效。
   */
  public registerBuiltin(packId: string, evaluator: SlotConditionEvaluator): void {
    let packStore = this.store.get(packId);
    if (!packStore) {
      packStore = new Map<string, SlotConditionEvaluator>();
      this.store.set(packId, packStore);
    }

    if (!packStore.has(evaluator.key)) {
      packStore.set(evaluator.key, evaluator);
    }
  }

  public get(packId: string, key: string): SlotConditionEvaluator | undefined {
    return this.store.get(packId)?.get(key);
  }

  public list(packId: string): SlotConditionEvaluator[] {
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

  public async evaluate(
    packId: string,
    key: string,
    context: SlotConditionContext
  ): Promise<SlotConditionResult> {
    const evaluator = this.get(packId, key);
    if (!evaluator) {
      return {
        active: false,
        reason: `SlotConditionEvaluator not found: ${key} in pack ${packId}`
      };
    }

    return evaluator.evaluate(context);
  }

  public clearPack(packId: string): void {
    this.store.delete(packId);
  }

  public clear(): void {
    this.store.clear();
  }
}

export const slotConditionRegistry = new SlotConditionRegistry();

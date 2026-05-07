import type { SlotBehaviorState } from '../inference/slot_behavior_state.js';

/**
 * 行为状态存储接口。
 * 支持后续替换为持久化后端（Prisma / 文件 / Redis）。
 */
export interface BehaviorStateStore {
  getState(slotId: string, packId: string): SlotBehaviorState | undefined;
  setState(slotId: string, packId: string, state: SlotBehaviorState): void;
  clearForConversation(packId: string, conversationId: string): void;
  clearForInference(packId: string, inferenceId: string): void;
}

/**
 * 基于内存 Map 的行为状态存储实现。
 */
export function createMemoryBehaviorStateStore(): BehaviorStateStore {
  const store = new Map<string, SlotBehaviorState>();

  function compoundKey(slotId: string, packId: string): string {
    return `${slotId}::${packId}`;
  }

  return {
    getState(slotId, packId) {
      return store.get(compoundKey(slotId, packId));
    },

    setState(slotId, packId, state) {
      store.set(compoundKey(slotId, packId), state);
    },

    clearForConversation(packId, conversationId) {
      const prefix = `::${packId}`;
      const convSuffix = `::${conversationId}`;
      for (const key of store.keys()) {
        if (key.endsWith(prefix)) {
          store.delete(key);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      convSuffix; // conversation-scoped clearing — Phase 2+ implementation
    },

    clearForInference(packId, inferenceId) {
      const prefix = `::${packId}`;
      for (const key of store.keys()) {
        if (key.endsWith(prefix)) {
          store.delete(key);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      inferenceId; // inference-scoped clearing — Phase 2+ implementation when inference_id available
    }
  };
}

/**
 * 模块级单例 — 在 app 初始化时由 composition root 设置。
 * executor 通过此单例访问状态存储，避免修改 executor 接口签名。
 */
let singletonStore: BehaviorStateStore | null = null;

export function getBehaviorStateStore(): BehaviorStateStore | null {
  return singletonStore;
}

export function setBehaviorStateStore(store: BehaviorStateStore): void {
  singletonStore = store;
}

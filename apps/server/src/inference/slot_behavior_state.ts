/**
 * 插槽激活状态 — 5 状态机。
 * 对齐 memory_trigger_sidecar 的 MemoryActivationStatusDto 命名。
 *
 *   Pending  ──条件满足──→ Active
 *   Pending  ──条件满足+delay──→ Delayed ──delay_elapsed──→ Active
 *   Active   ──sticky_remaining>0──→ Retained（跳过条件评估）
 *   Retained ──sticky耗尽+cooldown──→ Cooling
 *   Cooling  ──冷却结束──→ Pending
 *   Cooling 优先级最高：即使 sticky 仍有次数，冷却期也不激活
 */
export type SlotActivationStatus = 'Pending' | 'Delayed' | 'Active' | 'Retained' | 'Cooling';

/**
 * 插槽行为运行时状态 —— 跨推理调用持久化。
 */
export interface SlotBehaviorState {
  slot_id: string;
  /** 当前激活状态 */
  status: SlotActivationStatus;
  /** 黏性剩余次数（Retained 状态时递减） */
  sticky_remaining?: number;
  /** 冷却结束 tick（世界 tick，Cooling 状态时使用） */
  cooldown_until_tick?: number;
  /** 延迟触发开始 tick（世界 tick，Delayed 状态时使用） */
  delay_until_tick?: number;
  /** 递归深度计数 */
  recursion_depth?: number;
  /** 最后激活 tick */
  last_activated_tick?: number;
  /** 触发总次数（用于 trigger_probability 的确定性采样种子） */
  trigger_count: number;
}

/**
 * 创建初始行为状态。
 */
export function createInitialBehaviorState(slotId: string): SlotBehaviorState {
  return {
    slot_id: slotId,
    status: 'Pending',
    trigger_count: 0
  };
}

/**
 * 状态转换输入。
 */
export interface StateTransitionInput {
  /** 条件是否满足 */
  conditionMet: boolean;
  /** 当前世界 tick */
  currentTick: number;
  /** 最大黏性激活次数 */
  stickyMaxActivations?: number;
  /** 冷却 tick 数 */
  cooldownTicks?: number;
  /** 延迟触发 tick 数 */
  delayTicks?: number;
}

/**
 * 执行状态转换（Phase 1 骨架 — Phase 2 实现完整逻辑）。
 * Phase 1：条件满足 → Active，不满足 → 保持 Pending。
 */
export function applyStateTransitions(
  state: SlotBehaviorState,
  input: StateTransitionInput
): SlotBehaviorState {
  const next = { ...state };

  switch (state.status) {
    case 'Pending': {
      if (!input.conditionMet) {
        break;
      }

      if (input.delayTicks && input.delayTicks > 0) {
        next.status = 'Delayed';
        next.delay_until_tick = input.currentTick + input.delayTicks;
      } else {
        next.status = 'Active';
        next.last_activated_tick = input.currentTick;
        next.trigger_count = state.trigger_count + 1;
        if (input.stickyMaxActivations !== undefined && input.stickyMaxActivations > 1) {
          next.sticky_remaining = input.stickyMaxActivations - 1;
        }
      }
      break;
    }

    case 'Delayed': {
      if (input.currentTick >= (state.delay_until_tick ?? 0)) {
        next.status = 'Active';
        next.last_activated_tick = input.currentTick;
        next.trigger_count = state.trigger_count + 1;
        next.delay_until_tick = undefined;
        if (input.stickyMaxActivations !== undefined && input.stickyMaxActivations > 1) {
          next.sticky_remaining = input.stickyMaxActivations - 1;
        }
      }
      break;
    }

    case 'Active': {
      // Cooling 优先级最高
      if (input.cooldownTicks && input.cooldownTicks > 0) {
        next.status = 'Cooling';
        next.cooldown_until_tick = input.currentTick + input.cooldownTicks;
        next.sticky_remaining = undefined;
      } else if ((state.sticky_remaining ?? 0) > 0) {
        next.status = 'Retained';
        next.sticky_remaining = (state.sticky_remaining ?? 1) - 1;
      } else {
        next.status = 'Pending';
      }
      break;
    }

    case 'Retained': {
      if (input.conditionMet) {
        next.trigger_count = state.trigger_count + 1;
        if ((state.sticky_remaining ?? 0) > 0) {
          next.sticky_remaining = (state.sticky_remaining ?? 1) - 1;
        } else {
          if (input.cooldownTicks && input.cooldownTicks > 0) {
            next.status = 'Cooling';
            next.cooldown_until_tick = input.currentTick + input.cooldownTicks;
          } else {
            next.status = 'Pending';
          }
          next.sticky_remaining = undefined;
        }
      } else {
        if (input.cooldownTicks && input.cooldownTicks > 0) {
          next.status = 'Cooling';
          next.cooldown_until_tick = input.currentTick + input.cooldownTicks;
        } else {
          next.status = 'Pending';
        }
        next.sticky_remaining = undefined;
      }
      break;
    }

    case 'Cooling': {
      if (input.currentTick >= (state.cooldown_until_tick ?? 0)) {
        next.status = 'Pending';
        next.cooldown_until_tick = undefined;
      }
      // Cooling 状态下即使条件满足也不激活
      break;
    }
  }

  return next;
}

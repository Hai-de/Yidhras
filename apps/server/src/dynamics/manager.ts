import { AlgorithmConfig,DynamicsCalculator } from './algorithms.js';
import { NodeValueState, ValueChangeReason, ValueUpdateResult } from './types.js';

export class ValueDynamicsManager {
  private states: Map<string, NodeValueState> = new Map();
  // 映射变动原因到特定算法配置 (从 World Pack 加载)
  private algorithmMap: Map<ValueChangeReason, AlgorithmConfig> = new Map();

  constructor(initialStates: NodeValueState[] = []) {
    initialStates.forEach(s => this.states.set(s.node_id, s));
  }

  /**
   * 配置某种变动原因使用的算法
   */
  public registerAlgorithm(reason: ValueChangeReason, config: AlgorithmConfig): void {
    this.algorithmMap.set(reason, config);
  }

  /**
   * 初始化或获取节点价值状态
   */
  public getOrCreateState(nodeId: string, currentTick: bigint): NodeValueState {
    if (!this.states.has(nodeId)) {
      this.states.set(nodeId, {
        node_id: nodeId,
        snr: 0.5,
        is_pinned: false,
        last_updated_tick: currentTick
      });
    }
    return this.states.get(nodeId)!;
  }

  public setPin(nodeId: string, isPinned: boolean): void {
    const state = this.states.get(nodeId);
    if (state) {
      state.is_pinned = isPinned;
    }
  }

  /**
   * 应用价值变化 (包含可插拔算法逻辑)
   */
  public applyChange(
    nodeId: string, 
    rawDelta: number, 
    reason: ValueChangeReason, 
    currentTick: bigint
  ): ValueUpdateResult {
    const state = this.getOrCreateState(nodeId, currentTick);
    const oldSnr = state.snr;

    // 1. 如果是贬值且节点已被钉住，则拦停贬值
    if (rawDelta < 0 && state.is_pinned) {
      console.log(`[ValueDynamics] Depreciation blocked for pinned node: ${nodeId}`);
      return { node_id: nodeId, old_snr: oldSnr, new_snr: oldSnr, delta: 0, reason };
    }

    // 2. 查找是否有特定算法配置，如果没有则使用默认线性算法
    const config = this.algorithmMap.get(reason) || { type: 'linear', params: { factor: 1.0 } };
    
    // 3. 计算实际的 SNR 增量
    const calculatedDelta = DynamicsCalculator.calculate(oldSnr, rawDelta, config);

    // 4. 计算新信噪比并约束在 [0.0, 1.0]
    let newSnr = oldSnr + calculatedDelta;
    newSnr = Math.max(0.0, Math.min(1.0, newSnr));

    // 5. 更新状态
    state.snr = newSnr;
    state.last_updated_tick = currentTick;

    return {
      node_id: nodeId,
      old_snr: oldSnr,
      new_snr: newSnr,
      delta: newSnr - oldSnr,
      reason
    };
  }

  public getAllStates(): NodeValueState[] {
    return Array.from(this.states.values());
  }
}

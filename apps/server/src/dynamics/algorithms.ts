export type DynamicsAlgorithmType = 'linear' | 'exponential' | 'sigmoid' | 'clamped_linear';

export interface AlgorithmConfig {
  type: DynamicsAlgorithmType;
  params: Record<string, number>;
}

export class DynamicsCalculator {
  /**
   * 根据配置执行计算
   * @param currentSnr 当前信噪比
   * @param delta 原始变动值 (作为算法输入)
   * @param config 算法配置
   */
  public static calculate(currentSnr: number, delta: number, config: AlgorithmConfig): number {
    switch (config.type) {
      case 'linear':
        return delta * (config.params.factor ?? 1.0);

      case 'exponential': {
        // 变动随当前值指数级增加/减少
        // new_delta = delta * (base ^ currentSnr)
        const base = config.params.base ?? 2.0;
        const scale = config.params.scale ?? 1.0;
        return delta * Math.pow(base, currentSnr) * scale;
      }

      case 'sigmoid': {
        // S形曲线，在某个临界点变动最剧烈
        // 用于模拟“影响力突破瓶颈”或“雪崩式贬值”
        const k = config.params.steepness ?? 10;
        const x0 = config.params.midpoint ?? 0.5;
        const sigmoid = 1 / (1 + Math.exp(-k * (currentSnr - x0)));
        return delta * sigmoid;
      }

      case 'clamped_linear': {
        // 带有上下限的线性变动
        const maxDelta = config.params.max_delta ?? 1.0;
        const minDelta = config.params.min_delta ?? -1.0;
        return Math.max(minDelta, Math.min(maxDelta, delta));
      }

      default:
        return delta;
    }
  }
}

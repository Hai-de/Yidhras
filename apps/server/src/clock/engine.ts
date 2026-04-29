import { CalendarConfig, TimeFormatted, TimeUnit } from './types.js';

export interface ChronosEngineOptions {
  calendarConfigs: CalendarConfig[];
  initialTicks?: bigint;
  monotonic?: boolean;
  maxStepTicks?: bigint;
}

export class ChronosEngine {
  private absoluteTicks: bigint = 0n;
  private calendars: CalendarConfig[] = [];
  private readonly monotonic: boolean;
  private readonly maxStepTicks: bigint;

  constructor(options: ChronosEngineOptions) {
    this.calendars = options.calendarConfigs;
    this.absoluteTicks = options.initialTicks ?? 0n;
    this.monotonic = options.monotonic ?? true;
    this.maxStepTicks = options.maxStepTicks ?? 100000n;
  }

  /**
   * 增加滴答 (Tick)
   */
  public tick(amount: bigint = 1n): void {
    if (amount > this.maxStepTicks) {
      throw new Error(
        `[ChronosEngine] 单次步进量 ${amount.toString()} 超过最大限制 ${this.maxStepTicks.toString()}。` +
        `如需更大步进，请调整 clock.max_step_ticks 配置。`
      );
    }
    this.absoluteTicks += amount;
  }

  /**
   * 获取当前绝对滴答
   */
  public getTicks(): bigint {
    return this.absoluteTicks;
  }

  /**
   * 设置绝对滴答。
   * 当 monotonic 启用时拒绝时间倒流。
   */
  public setTicks(next: bigint): void {
    if (this.monotonic && next < this.absoluteTicks) {
      throw new Error(
        `[ChronosEngine] 拒绝时间倒流: 当前 ${this.absoluteTicks.toString()} → 请求 ${next.toString()}。` +
        `如需允许时间倒流，请在配置中设置 clock.monotonic_enabled: false（风险自负：可能导致事件因果混乱）。`
      );
    }
    this.absoluteTicks = next;
  }

  /**
   * 将绝对滴答转换为所有已配置历法的时间显示
   */
  public getAllTimes(): TimeFormatted[] {
    return this.calendars.map(cal => this.formatTime(cal));
  }

  /**
   * 针对单一历法进行复杂进位计算
   */
  private formatTime(config: CalendarConfig): TimeFormatted {
    let remaining = this.absoluteTicks;
    const units: Record<string, bigint | number> = {};
    const displayParts: string[] = [];

    // 从最小单位向上计算
    for (let i = 0; i < config.units.length; i++) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
      const unit = config.units[i];
      const nextUnit = config.units[i + 1];

      if (!nextUnit) {
        // 最高级单位 (如: Era / Year)，直接存储剩余值
        units[unit.name] = remaining;
        displayParts.unshift(`${remaining} ${unit.name}`);
        break;
      }

      // 计算当前单位的进位
      let currentVal: bigint;

      if (nextUnit.irregular_ratios) {
        // 处理不规则进位 (如: 月份天数不等)
        // 注意：不规则进位通常基于某个循环 (如: 一年12个月)
        const cycleLength = nextUnit.irregular_ratios.reduce((a, b) => a + b, 0);
        const cycleTicks = BigInt(cycleLength) * this.getUnitBaseRatio(config.units, i);

        // 先算出过了多少个大循环 (年)
        remaining %= cycleTicks;

        // 在当前循环内，通过累减确定具体单位数值 (月)
        let subVal = 0;
        const unitBase = this.getUnitBaseRatio(config.units, i);
        for (const r of nextUnit.irregular_ratios) {
          const rTicks = BigInt(r) * unitBase;
          if (remaining >= rTicks) {
            remaining -= rTicks;
            subVal++;
          } else {
            break;
          }
        }
        currentVal = BigInt(subVal);
      } else {
        // 普通固定进位
        const ratio = BigInt(nextUnit.ratio);
        currentVal = remaining % ratio;
        remaining /= ratio;
      }

      units[unit.name] = currentVal;
      displayParts.unshift(`${currentVal}${unit.name}`);
    }

    return {
      calendar_id: config.id,
      calendar_name: config.name,
      display: displayParts.join(' '),
      units
    };
  }

  /**
   * 计算某个单位相对于基础 Tick 的倍率
   */
  private getUnitBaseRatio(units: TimeUnit[], index: number): bigint {
    let base = 1n;
    for (let i = 0; i < index; i++) {
      base *= BigInt(units[i + 1].ratio);
    }
    return base;
  }
}

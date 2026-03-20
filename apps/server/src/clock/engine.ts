import { CalendarConfig, TimeFormatted, TimeUnit } from './types.js';

export class ChronosEngine {
  private absoluteTicks: bigint = 0n; // 核心绝对计数器 (BigInt)
  private calendars: CalendarConfig[] = [];

  constructor(calendars: CalendarConfig[], initialTicks: bigint = 0n) {
    this.calendars = calendars;
    this.absoluteTicks = initialTicks;
  }

  /**
   * 增加滴答 (Tick)
   */
  public tick(amount: bigint = 1n): void {
    this.absoluteTicks += amount;
  }

  /**
   * 获取当前绝对滴答
   */
  public getTicks(): bigint {
    return this.absoluteTicks;
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

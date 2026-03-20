import { ChronosEngine } from './engine.js';
import { CalendarConfig } from './types.js';

// 1. 定义测试用历法
const testCalendars: CalendarConfig[] = [
  {
    id: "earth_legacy",
    name: "地球旧历",
    tick_rate: 1000,
    units: [
      { name: "秒", ratio: 1 },
      { name: "分", ratio: 60 },
      { name: "时", ratio: 60 },
      { name: "日", ratio: 24 },
      { name: "月", ratio: 0, irregular_ratios: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] },
      { name: "年", ratio: 12 }
    ]
  },
  {
    id: "cyber_std",
    name: "赛博标准历",
    tick_rate: 1000,
    units: [
      { name: "脉冲", ratio: 1 },
      { name: "周期", ratio: 100 },
      { name: "阶段", ratio: 10 }
    ]
  }
];

// 2. 初始化引擎
const engine = new ChronosEngine(testCalendars, 0n);

console.log("--- 初始状态 ---");
engine.getAllTimes().forEach(t => console.log(`${t.calendar_name}: ${t.display}`));

// 3. 模拟时间流逝
console.log("\n--- 增加 3662 秒 (约1小时1分2秒) ---");
engine.tick(3662n);
engine.getAllTimes().forEach(t => console.log(`${t.calendar_name}: ${t.display}`));

console.log("\n--- 增加 1,000,000 秒 (约11.5天) ---");
engine.tick(1000000n);
engine.getAllTimes().forEach(t => console.log(`${t.calendar_name}: ${t.display}`));

console.log("\n--- 跨越式增加 (模拟过了 2 年 3 个月) ---");
// 1年 = 365天 (不考虑闰年简化测试)
const dayInTicks = 24n * 60n * 60n;
const yearTicks = 365n * dayInTicks;
const threeMonthsTicks = (31n + 28n + 31n) * dayInTicks;
engine.tick(2n * yearTicks + threeMonthsTicks);
engine.getAllTimes().forEach(t => console.log(`${t.calendar_name}: ${t.display}`));

console.log("\n--- 验证 BigInt 极限 (增加 10^15 滴答) ---");
engine.tick(1000000000000000n);
engine.getAllTimes().forEach(t => console.log(`${t.calendar_name}: ${t.display}`));

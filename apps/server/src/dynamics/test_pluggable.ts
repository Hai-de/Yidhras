import { ValueDynamicsManager } from './manager.js';
import { ValueChangeReason } from './types.js';

const manager = new ValueDynamicsManager();
const currentTick = 100n;

// 1. 模拟从 World Pack 加载的算法配置
manager.registerAlgorithm(ValueChangeReason.POST_ENGAGEMENT, {
  type: 'linear',
  params: { factor: 1.2 }
});
manager.registerAlgorithm(ValueChangeReason.FAKE_NEWS_DETECTED, {
  type: 'exponential',
  params: { base: 1.5, scale: 0.5 }
});
manager.registerAlgorithm(ValueChangeReason.FOLLOWED_BY_ELITE, {
  type: 'sigmoid',
  params: { midpoint: 0.6, steepness: 12 }
});

// 2. 测试不同初始状态下的变动
// 节点 A: 低信噪比 (0.2)
// 节点 B: 高信噪比 (0.8)
manager.getOrCreateState("node-A", currentTick).snr = 0.2;
manager.getOrCreateState("node-B", currentTick).snr = 0.8;

console.log("--- 初始状态 ---");
console.log("Node-A SNR: 0.2, Node-B SNR: 0.8");

// 3. 验证线性算法 (post_engagement)
console.log("\n--- 验证线性算法 (Delta: +0.1, Factor: 1.2) ---");
const resA1 = manager.applyChange("node-A", 0.1, ValueChangeReason.POST_ENGAGEMENT, currentTick);
console.log(`Node-A: 0.2 -> ${resA1.new_snr.toFixed(3)} (预期增量 0.12)`);

// 4. 验证指数算法 (fake_news)
// 逻辑: 变动随 SNR 增加而变大
console.log("\n--- 验证指数算法 (Delta: -0.1, Base: 1.5) ---");
const resA2 = manager.applyChange("node-A", -0.1, ValueChangeReason.FAKE_NEWS_DETECTED, currentTick);
const resB2 = manager.applyChange("node-B", -0.1, ValueChangeReason.FAKE_NEWS_DETECTED, currentTick);
console.log(`Node-A (Low SNR): ${resA1.new_snr.toFixed(3)} -> ${resA2.new_snr.toFixed(3)}`);
console.log(`Node-B (High SNR): 0.8 -> ${resB2.new_snr.toFixed(3)} (预期下降更剧烈)`);

// 5. 验证 S 形曲线 (followed_by_elite)
// 逻辑: 在 0.6 附近增益最强
console.log("\n--- 验证 S 形曲线 (Delta: +0.2, Midpoint: 0.6) ---");
manager.getOrCreateState("node-C", currentTick).snr = 0.55; // 接近临界点
const resC = manager.applyChange("node-C", 0.2, ValueChangeReason.FOLLOWED_BY_ELITE, currentTick);
console.log(`Node-C (SNR 0.55): 0.55 -> ${resC.new_snr.toFixed(3)} (临界点附近的剧烈增长)`);

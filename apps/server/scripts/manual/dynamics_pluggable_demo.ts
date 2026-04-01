import { ValueDynamicsManager } from '../../src/dynamics/manager.js';
import { ValueChangeReason } from '../../src/dynamics/types.js';

const manager = new ValueDynamicsManager();
const currentTick = 100n;

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

manager.getOrCreateState('node-A', currentTick).snr = 0.2;
manager.getOrCreateState('node-B', currentTick).snr = 0.8;

console.log('--- 初始状态 ---');
console.log('Node-A SNR: 0.2, Node-B SNR: 0.8');

console.log('\n--- 验证线性算法 (Delta: +0.1, Factor: 1.2) ---');
const resA1 = manager.applyChange('node-A', 0.1, ValueChangeReason.POST_ENGAGEMENT, currentTick);
console.log(`Node-A: 0.2 -> ${resA1.new_snr.toFixed(3)} (预期增量 0.12)`);

console.log('\n--- 验证指数算法 (Delta: -0.1, Base: 1.5) ---');
const resA2 = manager.applyChange('node-A', -0.1, ValueChangeReason.FAKE_NEWS_DETECTED, currentTick);
const resB2 = manager.applyChange('node-B', -0.1, ValueChangeReason.FAKE_NEWS_DETECTED, currentTick);
console.log(`Node-A (Low SNR): ${resA1.new_snr.toFixed(3)} -> ${resA2.new_snr.toFixed(3)}`);
console.log(`Node-B (High SNR): 0.8 -> ${resB2.new_snr.toFixed(3)} (预期下降更剧烈)`);

console.log('\n--- 验证 S 形曲线 (Delta: +0.2, Midpoint: 0.6) ---');
manager.getOrCreateState('node-C', currentTick).snr = 0.55;
const resC = manager.applyChange('node-C', 0.2, ValueChangeReason.FOLLOWED_BY_ELITE, currentTick);
console.log(`Node-C (SNR 0.55): 0.55 -> ${resC.new_snr.toFixed(3)} (临界点附近的剧烈增长)`);

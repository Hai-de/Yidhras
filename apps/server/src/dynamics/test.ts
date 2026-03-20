import { ValueDynamicsManager } from './manager.js';
import { ValueChangeReason } from './types.js';

const manager = new ValueDynamicsManager();
const currentTick = 100n;

// 1. 初始化两个测试节点
manager.getOrCreateState("agent-001", currentTick); // 平民
manager.getOrCreateState("admin-agent", currentTick); // 钉住的管理员
manager.setPin("admin-agent", true);

console.log("--- 初始状态 ---");
manager.getAllStates().forEach(s => console.log(`${s.node_id}: SNR=${s.snr}, Pinned=${s.is_pinned}`));

// 2. 模拟贬值事件 (如: 散布谣言)
console.log("\n--- 模拟贬值事件 (Delta: -0.3) ---");
const res1 = manager.applyChange("agent-001", -0.3, ValueChangeReason.FAKE_NEWS_DETECTED, currentTick + 10n);
const res2 = manager.applyChange("admin-agent", -0.3, ValueChangeReason.FAKE_NEWS_DETECTED, currentTick + 10n);
console.log(`平民结果: SNR ${res1.old_snr} -> ${res1.new_snr}`);
console.log(`管理员结果: SNR ${res2.old_snr} -> ${res2.new_snr} (预期不变)`);

// 3. 模拟极端升值事件
console.log("\n--- 模拟极端升值 (Delta: +10.0) ---");
const res3 = manager.applyChange("agent-001", 10.0, ValueChangeReason.NARRATIVE_ENDORSEMENT, currentTick + 20n);
console.log(`平民结果: SNR ${res3.old_snr} -> ${res3.new_snr} (预期封顶 1.0)`);

// 4. 模拟极端贬值事件
console.log("\n--- 模拟极端贬值 (Delta: -5.0) ---");
const res4 = manager.applyChange("agent-001", -5.0, ValueChangeReason.NOISE_FLAGGED, currentTick + 30n);
console.log(`平民结果: SNR ${res4.old_snr} -> ${res4.new_snr} (预期触底 0.0)`);

// 5. 钉住状态下的升值测试 (钉住节点应该能升值)
console.log("\n--- 钉住节点升值测试 (Delta: +0.2) ---");
const res5 = manager.applyChange("admin-agent", 0.2, ValueChangeReason.POST_ENGAGEMENT, currentTick + 40n);
console.log(`管理员结果: SNR ${res5.old_snr} -> ${res5.new_snr} (预期升至 0.7)`);

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 建立假未实现台账并完成分类冻结：区分命名残影、错误占位、accepted host seam 误标、experimental 误读与真实功能缺口  `#fake-plan-p1`
- [x] 清理高置信度代码残影：优先处理 sidecar/handshake stub 命名、主路径误导性占位文本与边界注释/命名  `#fake-plan-p2`
- [x] 统一文档与过程资产口径：把 accepted host seam、fallback debt、experimental default-off 与真实未实现缺口分开表述  `#fake-plan-p3`
- [x] 补充回归护栏：为 metadata/错误文本/边界语义增加必要测试与快照更新  `#fake-plan-p4`
- [x] 同步 progress 与后续分流：把真实功能缺口转入后续专题，关闭本轮假未实现清理条目  `#fake-plan-p5`
<!-- LIMCODE_TODO_LIST_END -->

# 假未实现清理与边界口径收口实施计划

## 背景与目标

当前仓库的主要问题并不是大量主路径“没实现”，而是存在一批**会制造“好像还没做完”错觉**的内容，主要包括：

1. **命名/元数据残影**：实现已落地，但仍保留 `stub` / `placeholder` / 历史迁移期命名；
2. **错误回退占位输出**：主链路已存在，但失败态仍暴露占位式文本；
3. **迁移期文档口径漂移**：有些内容应被视为 accepted TS-host-owned seam，却仍容易被理解为“未迁移缺口”；
4. **experimental 能力与真实未实现混杂**：default-off 的 operator/test-only 能力容易被误认成未落地；
5. **测试护栏不足**：缺少用例保护这些边界，后续很容易再次回退到“假未实现”状态。

本计划目标不是新增大功能，而是：

> **先把“假未实现”从代码、文档、测试和过程资产里清掉，让真实缺口与长期边界分离。**

---

## 参考依据

- 当前待办来源：`TODO.md`
- 相关架构事实：`docs/ARCH.md`
- 相关接口事实：`docs/API.md`
- 活跃进度：`.limcode/progress.md`
- Rust 迁移状态矩阵：`.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`
- world engine 迁移缺口审查：`.limcode/review/rust-module-migration-gap-review.md`
- multi-pack experimental 评估：`.limcode/review/multi-pack-runtime-experimental-assessment.md`
- 近期已完成的边界收口专题：`.limcode/plans/pack-host-api-long-term-host-mediated-read-contract-implementation.plan.md`

---

## 本次范围

### 纳入本计划

1. 清理**高置信度假未实现**：
   - 已不是 stub，但仍自称 stub 的命名/元数据；
   - 已有正式 owner，但文档仍像“默认待迁移”；
   - 已实现主能力，但错误文字/对外表述仍像临时壳。
2. 建立**统一分类法**，把问题分成：
   - 假未实现（应清理）
   - 真缺口（应进入后续功能计划）
   - accepted host seam（不应继续当作待迁移项）
   - experimental/default-off（不应与未实现混淆）
3. 补最小测试/文档护栏，防止回退。

### 不纳入本计划

1. 直接实现新的重量级能力，例如：
   - `trigger_rate` 真正支持；
   - multi-pack 从 experimental 变为 stable。
2. 大规模语义重构或产品化 redesign。
3. 清理测试中的正常 stub/fake test double（仅处理误导正式行为边界的残影，不清理合理测试替身）。

---

## 问题分组与优先级

### P0：高优先级、低争议、立即可清

这些属于“几乎不改行为，只消除误导”的内容，应该最先做：

1. **sidecar/handshake 元数据残影**
   - 例如 memory trigger sidecar 已接真实 `source.evaluate`，但对外仍使用 `memory-trigger-sidecar-stub`、`engine_capabilities: ['stub', ...]` 等历史标记；
   - 目标：让对外诊断信息描述当前真实状态，而非迁移早期状态。
2. **显式的错误恢复占位文本梳理**
   - 例如 narrative/prompt 相关失败态返回的 `[ERROR_RECOVERED_STUB]`、`[INVALID_TEMPLATE_*]`、`[RESTRICTED_OR_MISSING]` 等；
   - 目标：区分哪些应保留为内部安全哨兵，哪些应改成更中性/正式的 diagnostics 文本或统一错误占位策略。
3. **文档中的明显过时措辞**
   - 把已 accepted 的 host seam 继续描述成“未迁完”的表述；
   - 把 experimental/default-off 描述得像“还没做”。

### P1：中优先级、需要分类与收口原则

1. **迁移文档口径统一**
   - world engine / scheduler / memory trigger 中，哪些是 fallback debt，哪些是长期 TS host seam；
2. **process 资产同步**
   - `.limcode/progress.md`、review、matrix、enhancement backlog 的措辞收口；
3. **边界注释与类型表达强化**
   - 防止新代码继续扩张 raw sidecar / 暂时性命名。

### P2：后续专题，不应混入本轮

1. `trigger_rate` 等真实功能缺口；
2. fallback/shadow 退休；
3. multi-pack 稳定化；
4. 更深产品化错误呈现。

---

## 实施策略

## Phase 1：建立“假未实现”台账与分类法

### 目标

先冻结清理对象，避免一边清理一边扩散范围。

### 实施内容

1. 逐项盘点目前命中的“疑似假未实现”内容，按下列标签分类：
   - `naming_residue`：命名/元数据仍保留 `stub` / `placeholder`；
   - `fallback_sentinel`：错误回退哨兵存在，但主逻辑并非未实现；
   - `accepted_host_seam_mislabel`：长期宿主边界被误写为迁移缺口；
   - `experimental_misread`：default-off experimental 被误解为没做；
   - `real_gap_do_not_touch`：真实功能缺口，不在本轮实现。
2. 为每项记录：
   - 文件路径；
   - 当前表述；
   - 为什么会误导；
   - 计划动作（rename / rewrite comment / doc reclassification / leave as-is with explanation）。
3. 形成**冻结清单**，作为本轮唯一处理对象，避免把真实 feature 开发混进来。

### 产出

- 一份假未实现台账；
- 一套后续文档/代码都能复用的分类法。

### 验收标准

- 所有本轮要改的对象都已被分类；
- 明确区分“本轮清理对象”和“后续真实功能缺口”。

---

## Phase 2：清理高置信度代码残影

### 目标

先处理不改主行为、但最会误导阅读者的代码与元数据。

### 重点对象

1. **sidecar 握手/健康元数据**
   - 更新过时的 `stub` 命名、instance id、capability 标签；
   - 保证反映当前真实能力边界。
2. **错误恢复/占位输出策略**
   - 审查 narrative/prompt 等路径中的占位文本；
   - 区分：
     - 面向内部调试的安全哨兵；
     - 面向上层调用方/用户的正式失败文本；
   - 收口成统一、可解释、不暗示“功能没写”的表达。
3. **边界注释/命名**
   - 避免正式对象继续以 migration/stub 语气命名；
   - 对确实仍是 compatibility path 的对象，保留但明确说明角色。

### 约束

- 不改变现有 runtime ownership；
- 不顺手扩功能；
- 不为了清字面，把有意义的 fallback 机制误删。

### 验收标准

- 高置信度假未实现代码残影被清掉；
- 阅读代码的人不会再把这些主路径误判为“只写了壳”。

---

## Phase 3：统一文档与过程资产口径

### 目标

让仓库文档表达与当前实现现实一致，减少“代码是 A，文档像 B”的错觉。

### 重点更新对象

- `docs/ARCH.md`
- `docs/API.md`（仅在边界表达需要更清晰时）
- `.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`
- `.limcode/review/rust-module-migration-gap-review.md`
- `.limcode/review/multi-pack-runtime-experimental-assessment.md`（若需要补状态口径）
- `.limcode/progress.md`
- 必要时 `.limcode/enhancements-backlog.md`

### 核心原则

1. **accepted host seam 不再默认写成 gap**
   - 例如 PackHostApi、host clock projection、plugin contributor lifecycle 等；
2. **experimental/default-off 不等于未实现**
   - multi-pack/operator API 应继续强调“可试验但不承诺稳定”，而不是“缺失”；
3. **fallback debt 与长期 owner 分开写**
   - scheduler/memory 的 TS baseline 属于 fallback/parity debt；
   - world engine 某些 TS seam 则是长期宿主边界。

### 验收标准

- 文档中的“未完成感”只保留给真实缺口；
- 长期宿主边界、compatibility debt、experimental 能力三者被明确分开。

---

## Phase 4：补测试与回归护栏

### 目标

确保“假未实现清理”不是一次性润色，而是有回归保护。

### 需要覆盖的方向

1. **sidecar metadata / handshake 契约测试**
   - 确认对外 capability/instance 描述与真实状态一致；
2. **错误回退文本策略测试**
   - 确认失败态输出是统一、可预期的正式哨兵/diagnostics，而非历史 stub 词汇；
3. **边界语义回归测试**
   - 对 accepted host seam 的核心行为继续保持；
4. **必要的文档/快照更新**
   - 避免测试仍把旧 `stub` 文本写死。

### 验收标准

- 本轮清理涉及的关键表述有测试保护；
- 后续修改不会轻易把 `stub` / 假未实现语义重新引回主路径。

---

## Phase 5：收尾与后续分流

### 目标

把本轮处理结果沉淀为清晰的后续入口。

### 实施内容

1. 关闭本轮“假未实现”清理条目；
2. 将真正剩余的内容分流：
   - 真功能缺口 -> 后续新计划/增强项；
   - accepted host seam -> 归档为架构事实；
   - experimental 能力 -> 保留为 default-off/operator/test-only 事实；
3. 同步 progress 的 `latestConclusion` / `nextAction`，明确后续不再把本轮问题重新混为“未实现功能”。

### 验收标准

- 本轮完成后，仓库中“还没实现”和“只是迁移残影/实验态/长期宿主边界”不会再混写；
- 后续开发者能直接知道什么该清、什么不该碰、什么需要另立专题。

---

## 里程碑建议

### M1：冻结假未实现台账
- 完成全量分类；
- 明确本轮只处理高置信度误导项。

### M2：代码残影清理完成
- sidecar metadata / 命名残影 / 错误占位输出完成第一轮清理。

### M3：文档与过程资产口径统一
- accepted seam / real gap / experimental 三类说法收口完成。

### M4：测试与收尾完成
- 关键行为与表述有回归保护；
- progress 与后续入口同步完成。

---

## 风险与注意事项

1. **把真实缺口误当成假未实现清掉**
   - 风险：掩盖真实路线问题；
   - 控制：先做分类冻结，再动手。
2. **为了去掉 stub 字样，误删测试/兼容层语义**
   - 风险：破坏回退机制或测试可读性；
   - 控制：只清主路径和对外契约层，测试替身按需保留。
3. **文档统一时过度乐观**
   - 风险：把仍然开放的技术债说成已经彻底解决；
   - 控制：accepted seam、fallback debt、real gap 分开写。
4. **本轮范围膨胀成大重构**
   - 风险：计划失焦；
   - 控制：不纳入 trigger_rate、多包稳定化、fallback retirement 等真实 feature/architecture 议题。

---

## 完成判据

本计划完成后，应满足：

1. 仓库主路径中高置信度“假未实现”表述显著减少；
2. sidecar / host / experimental / fallback 的真实角色更容易一眼看明白；
3. 文档、review、progress 不再把已接受的宿主边界机械描述为“还没迁完”；
4. 真实功能缺口被单独保留，不再与历史 stub 残影混淆；
5. 本轮清理结果有测试和过程资产护栏，后续不易回退。

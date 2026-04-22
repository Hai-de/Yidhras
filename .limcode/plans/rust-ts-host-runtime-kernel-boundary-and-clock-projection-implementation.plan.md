<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/rust-ts-host-runtime-kernel-boundary-and-clock-projection-design.md","contentHash":"sha256:28922ac4808194504524ef27ff9f0c4d25fac75168af3da702bda907bf07a588"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 固化 Host Runtime Kernel 边界：确认插件系统、clock observable truth、commit result 的所有权语义  `#p1`
- [x] 引入 world engine commit 到宿主时钟投影的类型与端口接口  `#p2`
- [x] 实现 TS host clock projection service，并接入 active runtime facade / simulation manager  `#p3`
- [x] 收口 /api/clock、/api/clock/formatted、packHostApi.getCurrentTick 等读取路径到统一投影口  `#p4`
- [x] 补齐 world engine commit → host projection 的测试与回归验证  `#p5`
- [x] 生成 Rust 模块迁移状态总表，明确 scheduler / memory trigger / world engine 的已迁移核心与 TS 保留原因  `#p6`
- [x] 补充文档与退出条件：fallback/parity 依赖、world engine host seam、后续 phase2/phase3 缺口  `#p7`
<!-- LIMCODE_TODO_LIST_END -->

# Rust-TS Host Runtime Kernel 边界与时钟投影实施计划

## 来源设计

- 设计文档：`.limcode/design/rust-ts-host-runtime-kernel-boundary-and-clock-projection-design.md`
- 本计划严格以该设计为准，不在本计划阶段重审“是否应该采用 Rust core + TS host runtime kernel”这一前提。

## 目标

在**插件系统长期保留于 TS host** 的前提下，完成以下实施准备与落地：

1. 将当前隐含的“Rust sidecar core + TS host runtime kernel”架构显式化；
2. 为 world engine 定义并落地 commit → host observable clock projection 接口；
3. 统一外部时钟读取路径，避免 sidecar session / 本地 `ChronosEngine` / persistence summary 多源并存；
4. 输出一份面向后续迁移治理的模块总表，说明哪些逻辑已切 Rust、哪些宿主能力仍在 TS、TS 为什么现在还不能删。

---

## 范围

### 纳入本次实施的内容

- world engine commit 结果到 TS host clock projection 的接口与应用路径；
- `/api/clock`、`/api/clock/formatted`、`packHostApi.getCurrentTick()` 等读取口的收口；
- active runtime facade / simulation manager 对可见时钟投影的承接；
- scheduler / memory trigger / world engine 三模块迁移清单文档化；
- fallback / parity / host seam 的退出条件补充。

### 不纳入本次实施的内容

- 将插件 contributor 体系整体迁入 Rust；
- 将 world engine persistence ownership 整体迁入 Rust；
- 将 query host seam / invocation side-effect seam 全面迁入 Rust；
- 在本次实施中消灭所有 TS fallback/parity 参考实现。

---

## 当前问题归类

本次要解决的“时钟问题”，统一定义为：

> **Host Runtime Projection Consistency 问题**

而不是“Rust 时钟未实现”或“前端假数据”。

具体表现为：

- world engine sidecar 已能返回 `committed_tick` / `clock_delta.next_tick`；
- TS host 在 commit 后未将其投影为统一的 observable runtime clock；
- API 与 UI 继续读取旧的本地 clock 或未同步的宿主状态，导致时间看起来固定或漂移。

---

## 工作流拆分

## 工作流 A：边界固化

### 目标

把现有隐式架构收口为正式的工程约束，避免后续实现再次引入“双真相”。

### 实施内容

1. 在 server runtime 层明确三类概念：
   - `commit result`
   - `host runtime projection`
   - `observable clock truth`
2. 确认并记录：
   - 插件系统属于 TS host capability；
   - Rust sidecar 输出的是待宿主采纳的结果，而非直接对外真相；
   - `/api/clock*` 与前端 runtime store 只认宿主投影。
3. 为后续代码评审建立约束：
   - 禁止新代码直接从多个来源拼接 clock；
   - 对外时钟读取必须经统一 projection/query port。

### 交付物

- runtime kernel 边界注释/文档补充；
- 供后续实现引用的接口语义说明。

---

## 工作流 B：接口与类型落地

### 目标

把设计中的抽象接口变成可实现的 TypeScript 契约。

### 计划引入的核心接口

1. `RuntimeClockProjectionSnapshot`
2. `WorldEngineCommitProjectionInput`
3. `RuntimeClockProjectionPort`
4. `ActivePackRuntimeProjectionPort`
5. `HostRuntimeClockQueryPort`

### 实施步骤

1. 在 runtime 相关目录下新增或整理类型定义文件；
2. 明确 `committed_tick` / `clock_delta.next_tick` 的优先级解析规则；
3. 为 projection service 和 route/query consumer 设计稳定调用签名；
4. 保持接口命名体现“host projection”语义，避免与 sidecar session 状态混淆。

### 验收标准

- 所有时钟相关调用方都能通过统一接口表达需求；
- 不再需要调用方自行猜测 `committed_tick` 与 `clock_delta` 的优先级；
- 类型语义能区分“内部结果”和“对外投影”。

---

## 工作流 C：宿主时钟投影服务实现

### 目标

在 TS host runtime kernel 中提供唯一的可见时钟状态维护器。

### 实施内容

1. 实现 `RuntimeClockProjectionPort`：
   - `getSnapshot(pack_id)`
   - `applyWorldEngineCommitProjection(input)`
   - `rebuildFromRuntimeSeed(input)`
2. 维护 projection generation / updated_at 之类的观测元数据；
3. 以 pack-scoped 方式组织快照，避免未来 multi-pack 扩展时再次返工；
4. 明确初始化与重建路径：
   - active pack init 时生成初始 projection；
   - runtime reload / recovery 时可重建 projection。

### 与现有对象的集成点

- `SimulationManager`
- `DefaultActivePackRuntimeFacade`
- 当前本地 `ChronosEngine` 的 observable 用法

### 核心约束

- 不再把本地 `ChronosEngine.tick()` 当作 runtime loop 的权威推进方式；
- 由 projection apply 驱动宿主可见时钟更新。

---

## 工作流 D：world engine commit → host projection 接线

### 目标

把时钟问题的真正缺口补齐：commit 后显式更新宿主可见时钟。

### 实施内容

1. 在 world engine prepared step 执行链路中，获取：
   - persistence 返回的 `clock_delta`
   - sidecar commit 返回的 `committed_tick` / `committed_revision`
2. 组装 `WorldEngineCommitProjectionInput`；
3. 调用 `RuntimeClockProjectionPort.applyWorldEngineCommitProjection(...)`；
4. 将生成的新 snapshot 应用到 active runtime / simulation manager；
5. 确保后续 API 读取的是新的 projection，而不是旧 facade 状态。

### 风险点

- 需避免 commit 成功但 projection 未更新的部分失败状态；
- 需定义 projection apply 失败时的错误语义与日志记录策略；
- 需确认 `clock_delta` 与 `committed_tick` 不一致时的处理优先级和 observability。

### 验收标准

- runtime loop 每次成功 commit 后，宿主可见 tick 单调前进；
- `/api/clock/formatted` 能反映最新 tick；
- 不再出现“sidecar 已 commit，但 UI 看到旧 tick”的分裂状态。

---

## 工作流 E：读取路径收口

### 目标

把对外时钟读取统一收口到 host projection query port。

### 待读取点

至少包括：

1. `/api/clock`
2. `/api/clock/formatted`
3. `packHostApi.getCurrentTick()`
4. runtime status / overview 中对当前 tick 的展示
5. 前端 runtime bootstrap / runtime store 对主时钟的依赖链

### 实施策略

1. 建立 `HostRuntimeClockQueryPort`；
2. route / host api 统一依赖 query port；
3. 清点仍然直接调用 `context.sim.getCurrentTick()` 的对外暴露路径；
4. 区分：
   - 内部运行时逻辑临时读取；
   - 对外 API/UI 真相读取。

### 验收标准

- 对外路径只剩一个 clock source；
- 不再同时从 sidecar session、本地 facade、summary repo 各自读取；
- 未来若更换底层 ownership，不需要再改所有 route。

---

## 工作流 F：测试与回归验证

### 目标

确保边界化改造不会只是修“当前一个案例”，而是形成稳定行为。

### 需要新增/调整的测试方向

1. **unit**
   - `WorldEngineCommitProjectionInput` 优先级解析
   - projection service `apply/rebuild/getSnapshot`
   - active runtime `applyClockProjection`
2. **integration**
   - runtime loop 完整走 world engine prepare/persist/commit 后，宿主 tick 更新
   - `/api/clock/formatted` 返回的 absolute tick 与 calendars 与 projection 一致
3. **regression**
   - 插件系统启用时，clock 读取路径仍只依赖 host projection
   - sidecar restart / binary fallback 场景下 projection 行为可恢复

### 验收标准

- 能复现并验证“之前 tick 不更新”的问题已被 projection 机制覆盖；
- 不引入第二套 clock truth；
- 不破坏现有 sidecar fallback 流程。

---

## 工作流 G：Rust 模块迁移状态总表

### 目标

把 review 里的结论整理成一份工程可操作的治理总表。

### 输出格式建议

按模块分三大类：

#### Scheduler decision kernel
- 已迁移 Rust 核心
- 仍在 TS 的宿主职责
- TS 当前不可删原因
- 后续 phase2/phase3 缺口

#### Memory trigger engine
- 已迁移 Rust 核心
- 仍在 TS 的宿主职责
- TS 当前不可删原因
- 后续 phase2/phase3 缺口

#### World engine
- 已迁移 Rust 核心
- 仍在 TS 的宿主职责
- TS 当前不可删原因
- 后续 phase2/phase3 缺口
- 与插件系统、clock projection 的耦合点

### 预期价值

- 避免误把“还有没切完的 TS”理解成零散技术债；
- 明确哪些是阶段性架构选择，哪些才是真正缺口；
- 为未来是否继续推进 Rust ownership 提供决策底稿。

---

## 工作流 H：退出条件与后续路线

### 目标

给“什么时候可以删 TS 参考实现 / 什么时候可以宣称 world engine 迁移完成”定义可检查条件。

### 需要补齐的退出条件

1. **Scheduler**
   - Rust kernel 稳定性门槛
   - parity diff 长期收敛标准
   - TS fallback 是否可降级为仅测试工具
2. **Memory trigger**
   - Rust evaluator 稳定性门槛
   - context/materialization seam 是否明确长期留 TS
   - TS fallback 是否可退出生产路径
3. **World engine**
   - persistence ownership 是否明确
   - plugin contributor bridge 是否明确
   - query host seam / invocation side-effect seam 是否明确
   - observable clock ownership 是否完成统一

---

## 模块清单摘要

## 1. Scheduler decision kernel

### 已迁移到 Rust
- evaluate 内核
- candidate merge / suppression / 排序 / draft 生成

### 仍在 TS
- runtime ownership
- lease / ownership / cursor / DB 副作用 / run snapshot
- fallback / parity baseline

### 当前判断
- **核心算法已迁移**
- **系统运行权责未迁移**

---

## 2. Memory trigger engine

### 已迁移到 Rust
- trigger evaluation core
- activation/status/runtime state transition

### 仍在 TS
- 输入上下文装配
- block 拉取与持久化回写
- context node materialization
- fallback / parity baseline

### 当前判断
- **规则求值核心已迁移**
- **上下游宿主桥仍在 TS**

---

## 3. World engine

### 已迁移到 Rust
- pack session core
- prepare/commit/abort/query/objective execution 骨架

### 仍在 TS
- host persistence
- observable clock projection
- runtime loop orchestration
- plugin contributor registry
- query host seam
- invocation side effects

### 当前判断
- **迁移最不彻底**
- **目前仍高度依赖 TS host runtime kernel**

---

## 计划里程碑建议

### 里程碑 1：边界与接口
- 固化 runtime kernel 所有权语义
- 引入 clock projection 相关类型与端口

### 里程碑 2：时钟投影接线
- world engine commit → host projection
- active runtime apply projection

### 里程碑 3：读取路径收口
- `/api/clock*`
- `packHostApi.getCurrentTick()`
- 对外展示路径统一

### 里程碑 4：文档与总表
- Rust 模块迁移状态总表
- host seam / fallback / parity / 退出条件文档化

---

## 风险与注意事项

1. **误把当前问题理解成“让 Rust 直接提供时钟即可”**
   - 会制造新的双真相源。
2. **误把 world engine 时钟修复当成全量 Rust ownership 改造入口**
   - 会同时撞上 persistence、plugin bridge、query seam、invocation side effects。
3. **不先 formalize seam 就直接 patch**
   - 很可能修掉一个 route，却保留多个读取分叉点。
4. **忽略 pack-scoped 语义**
   - 后续 multi-pack runtime 场景会重新爆雷。

---

## 完成判据

本计划执行完成后，应满足：

- world engine commit 后，TS host observable clock 明确更新；
- `/api/clock` / `/api/clock/formatted` / `packHostApi.getCurrentTick()` 读同一真相；
- 插件系统仍继续由 TS host 承载，不被时钟修复绕开；
- 形成一份明确的模块迁移状态总表，供后续 phase2/phase3 决策使用。

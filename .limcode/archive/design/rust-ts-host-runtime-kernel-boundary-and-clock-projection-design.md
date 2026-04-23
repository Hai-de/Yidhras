# Rust-TS Host Runtime Kernel 边界与时钟投影接口设计

## 1. 背景

基于 `.limcode/review/rust-module-migration-gap-review.md` 的审查结论，当前项目中的 Rust 迁移并非“TS 只剩零散尾巴”，而是形成了一个明确但尚未正式化的阶段性架构：

- **Rust sidecar**：承载纯计算核心 / pack-scoped session core
- **TS host runtime kernel**：承载运行时编排、持久化桥、插件扩展桥、查询桥、外部 API 投影

其中：

- `scheduler decision kernel`：Rust 已覆盖 evaluate 内核；TS 仍负责 worker/runtime 协调、DB 副作用、fallback/parity 基线。
- `memory trigger engine`：Rust 已覆盖触发求值内核；TS 仍负责输入上下文装配、runtime state 落地、context materialization、fallback/parity 基线。
- `world engine`：Rust 已覆盖 session/query/prepare/commit/abort/objective execution 骨架；但 TS 仍强依赖于 host persistence、宿主时钟、插件 contributor、query host seam、invocation side effects。

当前暴露出来的时钟问题，不应再被视为单点 bug，而应视为：

> **world engine commit 结果没有被正式投影到 TS host runtime kernel 的可见时钟状态中。**

也即：

- Rust 能算出 `committed_tick` / `clock_delta.next_tick`
- TS host 没有把它应用为统一的 observable runtime clock
- `/api/clock`、`/api/clock/formatted`、`packHostApi.getCurrentTick()` 等读取路径因此发生漂移或停滞

---

## 2. 设计目标

### 2.1 主目标

在**插件系统长期保留于 TS host** 的前提下，正式化以下边界：

1. **Rust sidecar 负责产生 runtime state 变更结果**
2. **TS host runtime kernel 负责把结果投影为项目统一可见状态**
3. **外部可见时钟由 TS host runtime kernel 拥有**
4. **所有 API/UI 对时钟的读取路径统一读宿主投影**

### 2.2 次目标

- 为 world engine 提供清晰的 commit → host clock projection 接口
- 为未来是否继续迁移 host seam 到 Rust 留出明确扩展点
- 为 scheduler / memory trigger / world engine 三模块生成清单：
  - 已迁移核心
  - 仍在 TS 的宿主职责
  - TS 为何不能删
  - 若未来要继续 Rust 化，还缺哪些能力

### 2.3 非目标

本设计**不**在此阶段：

- 把插件 contributor 体系整体迁入 Rust
- 把所有查询桥与副作用桥整体迁入 Rust
- 消灭所有 TS fallback/parity 实现
- 在本设计中直接实施代码修改

---

## 3. 核心原则

## 3.1 插件系统长期视为 TS Host Capability

只要项目仍然需要：

- `StepContributor`
- `RuleContributor`
- `QueryContributor`
- Pack-local route / context source / prompt workflow integration

那么 TS host 就不是临时过渡层，而是**运行时能力宿主层**。

### 推论

不能再把 TS 简单视为“将被清空的旧实现”，而应视为：

> **宿主运行时内核（Host Runtime Kernel）**

---

## 3.2 Rust Sidecar 是 Core，不是现阶段唯一 Runtime Owner

当前更准确的描述应为：

- Rust：核心算法、session 内语义、纯计算步骤
- TS：运行时编排、投影、持久化、扩展、外部可见状态

### 推论

当前时钟问题不应通过“让 `/api/clock` 直接问 Rust”来解决，
而应通过“让 TS host 投影成为唯一外部可见真相”来解决。

---

## 3.3 对外只允许一个可见时钟真相

以下对象最终必须读同一个 source of truth：

- `/api/clock`
- `/api/clock/formatted`
- runtime status 中的当前 tick
- `packHostApi.getCurrentTick()`
- 前端 runtime store
- 任何 UI 主时钟呈现

### 推论

禁止继续出现：

- 一部分读取 sidecar session
- 一部分读取 TS local `ChronosEngine`
- 一部分读取 persistence summary

这种多源并存状态。

---

## 4. 建议的分层模型

```mermaid
flowchart TD
  A[Runtime Loop / Invocation / Query API] --> B[TS Host Runtime Kernel]
  B --> C[Rust Sidecar Core]
  C --> D[Commit Result / Delta / Clock Change]
  D --> B
  B --> E[Persistence / Projection / Plugin Contributors / Query Host Seam]
  B --> F[/api/clock / /api/status / Frontend UI]
```

### 解释

#### Rust sidecar core 负责：
- 计算 `prepare` / `commit` 的结果
- 返回 `committed_tick` / `clock_delta`
- 维护 pack-scoped session core（当前阶段）

#### TS host runtime kernel 负责：
- 运行时调用编排
- 接受 sidecar commit 结果
- 应用 persistence bridge
- 应用 clock projection
- 提供统一 query / API / UI 可见状态
- 承接插件系统

---

## 5. 时钟所有权模型

## 5.1 推荐模型：Host-owned Observable Clock

### Rust 负责输出
Rust world engine 输出：

- `committed_tick`
- `committed_revision`
- `clock_delta`

这些是**计算结果**。

### TS 负责投影
TS host runtime kernel 负责将这些结果应用为：

- active runtime current tick
- revision
- formatted calendars
- `/api/clock*` 对外可见值

这些是**宿主可见状态投影**。

---

## 5.2 定义：提交结果 ≠ 对外可见状态

当前最大问题之一，是项目隐含把：

- Rust commit 结果
- TS visible runtime state

当成同一个东西处理。

本设计要求明确区分：

### Commit Result
来自 world engine sidecar 的输出，是“待采纳结果”。

### Runtime Projection
由 TS host 采纳并统一暴露的结果，是“系统真相”。

---

## 6. 接口设计

以下接口设计偏向**先 formalize seam，再决定后续迁移方向**。

---

## 6.1 `RuntimeClockProjectionSnapshot`

```ts
export interface RuntimeClockProjectionSnapshot {
  pack_id: string
  current_tick: string
  current_revision: string
  calendars: Array<{
    calendar_id: string
    calendar_name: string
    display: string
    units: Record<string, string | number | bigint>
  }>
  source: 'host_projection'
  updated_at_ms: number
  generation: number
}
```

### 说明

这是 TS host runtime kernel 内部与外部 API 共用的统一可见时钟快照。

### 关键点

- `pack_id`：明确 clock 是 pack-scoped，而不是全局模糊状态
- `current_tick` / `current_revision`：统一宿主读取语义
- `generation`：便于调试/观测“是否发生过投影更新”
- `source` 固定为 `host_projection`：避免误解为 sidecar 直接真相

---

## 6.2 `WorldEngineCommitProjectionInput`

```ts
export interface WorldEngineCommitProjectionInput {
  pack_id: string
  committed_tick: string | null
  committed_revision: string | null
  clock_delta?: {
    previous_tick: string | null
    next_tick: string | null
    previous_revision: string | null
    next_revision: string | null
  } | null
  correlation_id?: string
  idempotency_key?: string
  source: 'world_engine_commit'
}
```

### 说明

这是从 world engine commit 返回值 / persistence 结果进入宿主投影层的输入结构。

### 设计理由

- 同时兼容：
  - `committed_tick`
  - `clock_delta.next_tick`
- 避免宿主代码分散地自己猜哪个字段优先

### 推荐优先级规则

宿主投影层内部应统一解析：

1. `clock_delta.next_tick`
2. `committed_tick`
3. `clock_delta.next_revision`
4. `committed_revision`

并显式记录选择路径，便于调试。

---

## 6.3 `RuntimeClockProjectionPort`

```ts
export interface RuntimeClockProjectionPort {
  getSnapshot(pack_id: string): RuntimeClockProjectionSnapshot | null

  applyWorldEngineCommitProjection(
    input: WorldEngineCommitProjectionInput
  ): RuntimeClockProjectionSnapshot

  rebuildFromRuntimeSeed(input: {
    pack_id: string
    current_tick: string
    current_revision?: string | null
    calendars: Array<{
      id: string
      name: string
      is_primary?: boolean
      tick_rate: number
      units: Array<{
        name: string
        ratio: number
        irregular_ratios?: number[]
      }>
    }>
  }): RuntimeClockProjectionSnapshot
}
```

### 说明

这是 TS host runtime kernel 中唯一允许维护外部可见时钟状态的接口。

### 三个能力分别对应

#### `getSnapshot`
统一所有 API/UI 查询入口。

#### `applyWorldEngineCommitProjection`
解决当前时钟不更新问题的正式入口。

#### `rebuildFromRuntimeSeed`
用于：

- pack 初始化
- runtime 重载
- 故障恢复
- 从 persistence summary 重建投影

---

## 6.4 `ActivePackRuntimeProjectionPort`

```ts
export interface ActivePackRuntimeProjectionPort {
  getCurrentTick(): bigint
  getCurrentRevision(): bigint
  getAllTimes(): unknown

  applyClockProjection(snapshot: RuntimeClockProjectionSnapshot): void
}
```

### 说明

这是 active runtime facade / simulation manager 应该暴露的投影应用能力。

### 设计目标

不再允许外部直接对 `ChronosEngine` 做随意本地自增，
而是通过 `applyClockProjection(...)` 应用 world engine commit 结果。

### 关键语义

- `getCurrentTick()` 读取的是**宿主投影后的当前值**
- 不是 sidecar session 的私有值
- 不是历史遗留 local tick counter 的孤立值

---

## 6.5 `HostRuntimeClockQueryPort`

```ts
export interface HostRuntimeClockQueryPort {
  readFormattedClock(pack_id: string): {
    absolute_ticks: string
    calendars: unknown[]
  } | null
}
```

### 说明

这是给 `/api/clock` 与 `/api/clock/formatted` 之类路由统一使用的读取口。

### 目的

避免 route 直接散落调用：

- `context.sim.getCurrentTick()`
- `context.sim.getAllTimes()`

而不经过统一投影口。

---

## 7. 推荐数据流

## 7.1 初始化阶段

1. TS 加载 active pack
2. TS 从 pack config + persistence seed 构建初始 tick/revision
3. TS 调用 `rebuildFromRuntimeSeed(...)`
4. TS 将生成的 snapshot 应用到 active runtime
5. `/api/clock*` 只从投影读取

---

## 7.2 runtime loop 提交阶段

1. TS 调 world engine sidecar `prepare`
2. TS host persistence apply delta
3. TS 调 sidecar `commit`
4. TS 组装 `WorldEngineCommitProjectionInput`
5. TS 调 `applyWorldEngineCommitProjection(...)`
6. TS 更新 active runtime observable clock
7. `/api/clock*`、`packHostApi.getCurrentTick()`、前端轮询统一读新投影

---

## 7.3 查询阶段

- 不直接从 sidecar session 拿 clock
- 不直接从本地孤立 `ChronosEngine` 拿 clock
- 统一从 `RuntimeClockProjectionPort.getSnapshot(pack_id)` 读取

---

## 8. 三模块清单

## 8.1 Scheduler Decision Kernel

### 已迁移到 Rust 的核心
- candidate evaluate
- periodic/event-driven merge
- cooldown / recovery suppression
- 排序
- job draft 生成

### 仍在 TS 的宿主职责
- worker lease
- ownership / partition control
- cursor
- idempotency 去重
- DB job materialization
- run snapshot / observability

### TS 当前为什么不能删
- `rust_primary` 失败回退到 TS
- `rust_shadow` 依赖 TS 作为 parity 基线
- scheduler runtime 副作用完全仍在 TS

### 若未来要真正去掉 TS，还缺什么
- 去掉 fallback/parity 对 TS 内核的依赖
- 明确 scheduler runtime ownership 是否也迁到 Rust
- 如果迁，则需要 Rust 拥有 worker/runtime 协调边界

---

## 8.2 Memory Trigger Engine

### 已迁移到 Rust 的核心
- keyword / logic / recent_source trigger evaluation
- activation score
- status resolve
- runtime state transition calculation
- source evaluate result assembly

### 仍在 TS 的宿主职责
- evaluation context 构造
- candidate memory block 拉取
- runtime state 持久化回写
- materialization 成 context node

### TS 当前为什么不能删
- `rust_primary` 失败回退到 TS evaluator
- `rust_shadow` 依赖 TS 作为 parity 基线
- memory source 上下游都仍在 TS host

### 若未来要真正去掉 TS，还缺什么
- evaluator 输入 preparation seam 正式化
- result application seam 正式化
- 替换 fallback/parity 对 TS evaluator 的依赖

---

## 8.3 World Engine

### 已迁移到 Rust 的核心
- pack session load/unload
- status/query session-level handling
- prepare/commit/abort session core
- objective rule matching / template rendering / mutation plan generation

### 仍在 TS 的宿主职责
- host persistence：entity state / rule execution record 落库
- runtime loop orchestration
- observable clock projection
- query host seam（repo-based）
- invocation mutation/event bridge
- plugin contributor registry

### TS 当前为什么不能删
- world engine 的宿主运行时 ownership 根本还在 TS
- 插件系统扩展点仍只存在 TS
- query / invocation side effects 仍只存在 TS
- clock issue 也证明宿主投影层不可缺

### 若未来要继续做可选 Rust 深化，需要单独确认什么
- 当前默认前提应是：`PackHostApi` 作为长期 TS-host-owned host-mediated read contract 保留
- persistence ownership 是否要超出 host-apply delta 继续下沉
- plugin contributor bridge 是否真的值得进入 Rust（默认不进入）
- query host seam 是否需要在 `PackHostApi` 之外继续缩窄为 Rust-facing contract
- invocation side-effect bridge 是否存在明确性能/安全收益，值得进一步下沉
- clock ownership model 继续保持 host projection single-source，不作为再次拆 owner 的入口

---

## 9. 处理当前时钟问题的建议路线

## 9.1 推荐路线

### 路线名
**Host Runtime Projection Consistency Fix**

### 核心思想
不是“让 clock 更 Rust”，而是“让 host runtime 对 clock 的可见投影一致”。

### 目标
- 接受 Rust 提交结果
- 由 TS host 应用 clock projection
- 统一 API/UI 读取路径

---

## 9.2 不推荐路线

### 不推荐 A：`/api/clock/formatted` 直接改为实时问 Rust sidecar
问题：
- 会绕开 TS 插件/持久化/query seam
- 会制造第二个可见真相源
- 重启/恢复语义会更混乱


---

## 10. 推荐实施顺序（清单）

## P0：边界确认
- [ ] 正式确认插件系统长期属于 TS host capability
- [ ] 正式确认外部可见 clock 由 TS host runtime kernel 拥有
- [ ] 正式确认 Rust sidecar 输出的是 commit result，不是唯一 observable truth

## P1：时钟投影接口落地
- [ ] 引入 `WorldEngineCommitProjectionInput`
- [ ] 引入 `RuntimeClockProjectionPort`
- [ ] 引入 `ActivePackRuntimeProjectionPort.applyClockProjection(...)`
- [ ] 明确 `committed_tick` 与 `clock_delta.next_tick` 的优先级规则

## P2：统一读取路径
- [ ] `/api/clock` 改为走统一宿主投影查询口
- [ ] `/api/clock/formatted` 改为走统一宿主投影查询口
- [ ] `packHostApi.getCurrentTick()` 明确依赖宿主投影或单一 summary source
- [ ] 清点所有 `getCurrentTick()` 直接读取点，标记哪些属于内部使用，哪些属于对外暴露路径

## P3：world engine host seam 文档化
- [ ] 列出 persistence seam
- [ ] 列出 plugin contributor seam
- [ ] 列出 query host seam
- [ ] 列出 invocation side-effect seam
- [ ] 明确这些 seam 哪些是长期留 TS，哪些未来可迁 Rust

## P4：fallback / parity 退出条件
- [ ] scheduler Rust 稳定性标准
- [ ] memory trigger Rust 稳定性标准
- [ ] world engine Rust 稳定性标准
- [ ] 定义何时可以停止依赖 TS reference implementation

---

## 11. 设计结论

在插件系统长期存在且仍依赖 TS host 的前提下，
当前最合理的方向不是继续追求“Rust 立刻完全拥有 runtime”，而是：

> **正式承认并设计化 “Rust core + TS host runtime kernel” 的阶段性架构。**

在这个架构里：

- Rust sidecar 负责纯核心与提交结果
- TS host 负责运行时投影、持久化、插件、查询、对外 API
- `PackHostApi` 负责作为长期 host-mediated read contract，承接插件/workflow/route 等上层读面
- 当前时钟问题被归类为：
  - **world engine commit 结果未被投影到 TS host observable clock**

因此，后续最正确的处理方式是：

1. 先 formalize host-owned observable clock 接口
2. 再修复 world engine commit → host clock projection
3. 最后统一所有 clock read path

---

## 12. 后续建议

下一份文档建议直接输出为：

### 《Rust 模块迁移状态总表（按模块）》

按 `scheduler / memory trigger / world engine` 三类统一列出：

- 已迁移 Rust 核心
- 仍在 TS 的宿主能力
- TS 是否因为 fallback/parity 必须保留
- 若要继续 Rust 化，还缺的 phase2/phase3 能力
- 与插件系统的耦合点
- 与 clock / projection 的耦合点

这样后续决策会比继续零散修 bug 更清晰。

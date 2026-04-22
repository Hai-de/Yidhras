# Memory Block / Context Trigger Engine Rust 迁移设计

## 1. 背景与本轮结论

`TODO.md` 当前未完成 Rust 迁移重点只剩：

- `Memory Block / Context Trigger Engine`

当前服务端已经具备一条可运行的 TS 实现链路：

- `apps/server/src/memory/blocks/trigger_engine.ts`
- `apps/server/src/context/sources/memory_blocks.ts`
- `apps/server/src/memory/blocks/store.ts`
- `apps/server/src/context/source_registry.ts`
- `apps/server/src/context/service.ts`

根据 `docs/ARCH.md`，Memory Block Runtime 明确属于 **kernel-side memory subsystem**，不属于 Rust world engine / pack runtime core。因此本轮迁移不应并入现有 `world_engine_sidecar`，而应采用与 scheduler/world engine 一致的 **独立 sidecar** 方案。

### 1.1 本轮已确认的产品/实现决策

本设计以以下已确认决策为前提：

1. **迁移范围**：本轮迁移 `trigger_engine + memory_blocks source`。
2. **sidecar 形态**：新建独立 Rust sidecar，不复用 world/scheduler sidecar。
3. **`trigger_rate` 语义**：当前阶段**明确忽略，不参与触发裁决**，但必须留下可观测记录，等待未来版本实现。
4. **delay 语义**：`delay_rounds_before_insert` 到期后，memory block 应进入 **可激活（active）** 路径；本轮 Rust 侧以该语义为准。
5. **非目标**：未来可能做完整 `Memory Block Runtime` Rust 化，但**不是本轮目标**。

---

## 2. 设计目标

### 2.1 核心目标

本轮迁移要达成：

1. 将 Memory Block 的 **触发求值内核** 迁移到 Rust。
2. 将 `memory_blocks source` 的 **核心 source 执行逻辑** 迁移到 Rust。
3. 保持当前 Context Module 宿主边界不变：
   - TS host 继续负责 Prisma / store / policy / context integration。
4. 建立与现有 Rust sidecar 一致的边界模式，为未来 Memory Runtime 深化 Rust ownership 提供模板。
5. 允许先以 parity / shadow 方式落地，再切换到 Rust primary。

### 2.2 非目标

本轮**不做**：

1. 不把 `MemoryBlockStore / Prisma persistence` 迁入 Rust。
2. 不把 `buildMemoryEvaluationContext(...)` 的权限裁剪与 recent source 组装迁入 Rust。
3. 不把 `context/source_registry.ts`、`context/service.ts`、`ContextNode` 总装配整体迁入 Rust。
4. 不做完整 `Memory Block Runtime` Rust 化。
5. 不实现 `trigger_rate` 的随机/概率行为。
6. 不改变 ARCH 中已明确的 kernel-side memory subsystem 宿主边界。

---

## 3. 当前实现拆解

### 3.1 当前 TS 链路

当前 `memory_blocks` source 的执行链路可概括为：

```text
TS host
  -> buildMemoryEvaluationContext(...)
  -> longMemoryBlockStore.listCandidateBlocks(...)
  -> for each record:
       evaluateMemoryBlockActivation(...)
       applyMemoryActivationToRuntimeState(...)
       updateRuntimeState(...)
       if active/retained:
         materializeMemoryBlockToContextNode(...)
  -> return nodes + evaluations
```

### 3.2 当前链路中的职责类型

可分成四类：

#### A. Host-only 职责

这些职责仍应保留在 TS：

- Prisma 读写
- candidate blocks 查询
- recent trace / intent / event 的权限裁剪
- Context Module 接线
- diagnostics 汇总写入 `context_run`

#### B. Deterministic kernel 职责

这些职责适合迁入 Rust：

- trigger 匹配
- logic DSL 求值
- activation score 计算
- status 裁决
- next runtime state 推导
- source 级筛选结果（哪些 block 进入 active/retained）

#### C. Host-bridge 职责

这些职责仍在 TS，但会改为 thin shell：

- sidecar client 调用
- DTO 转换
- sidecar 失败时 fallback / taint / observability

#### D. Compatibility materialization 职责

这些职责本轮保留 TS：

- `materializeMemoryBlockToContextNode(...)`
- 与现有 `ContextNode` / `PromptFragment` 主线的兼容拼装

---

## 4. 目标边界

## 4.1 新 sidecar 位置

建议新增：

```text
apps/server/rust/memory_trigger_sidecar/
```

建议初始文件结构：

```text
memory_trigger_sidecar/
  Cargo.toml
  src/
    main.rs
    protocol.rs
    models.rs
    engine.rs
    trigger.rs
    logic_dsl.rs
    source.rs
```

### 4.2 目标边界原则

本轮采取：

> **Rust 拥有 Memory Trigger + Source Kernel；TS host 拥有 persistence + policy + context integration。**

即：

- Rust sidecar：计算“这批 memory blocks 在当前 evaluation context 下的 source 结果”。
- TS host：提供输入、消费输出、负责落库、生成 `ContextNode`、写 diagnostics。

### 4.3 迁移后的执行链路

```text
TS host
  -> buildMemoryEvaluationContext(...)
  -> longMemoryBlockStore.listCandidateBlocks(...)
  -> memory_trigger_sidecar.source.evaluate(...)
       -> trigger engine
       -> status resolve
       -> next runtime state derive
       -> source result derive
  -> TS host persist runtime states
  -> TS host materialize active/retained blocks to ContextNode
  -> TS host write context diagnostics
```

---

## 5. “迁 trigger_engine + memory_blocks source”的精确定义

这里的“迁移 source”不是把整个 Context Source Adapter 搬进 Rust，而是把 source 的**业务内核**搬进 Rust。

### 5.1 Rust 拥有的 source kernel 责任

Rust 负责：

1. 依输入候选集合逐条求值。
2. 计算每条 memory block 的：
   - `evaluation`
   - `next_runtime_state`
   - `should_materialize`
3. 返回 source 级结果集合：
   - 哪些 block 进入 active/retained
   - 哪些 block 为 delayed/cooling/inactive
4. 输出可直接用于 diagnostics 的结构化结果。

### 5.2 TS 保留的 adapter shell 责任

TS 侧 `context/sources/memory_blocks.ts` 在迁移后保留为薄壳：

1. 组 evaluation context。
2. 从 store 拉 candidate blocks。
3. 调 Rust sidecar。
4. 将返回的 `next_runtime_state` 写回 store。
5. 对 `should_materialize=true` 的 block 调现有 `materializeMemoryBlockToContextNode(...)`。
6. 组装 `MemoryBlockSourceBuildResult` 返回给 Context Module。

也就是说，**TS 仍保留 source adapter integration，Rust 拥有 source execution kernel**。

---

## 6. RPC 与协议设计

## 6.1 协议版本

建议：

```text
memory_trigger/v1alpha1
```

### 6.2 传输方式

与现有 sidecar 保持一致：

- 本地 `stdio`
- `JSON-RPC 2.0`

### 6.3 初始方法集合

建议最小只暴露三个方法：

1. `memory_trigger.protocol.handshake`
2. `memory_trigger.health.get`
3. `memory_trigger.source.evaluate`

其中核心方法只有一个：

- `memory_trigger.source.evaluate`

---

## 7. `memory_trigger.source.evaluate` 输入/输出

## 7.1 输入结构

```ts
interface MemoryTriggerSourceEvaluateInput {
  protocol_version: 'memory_trigger/v1alpha1';
  request_id?: string | null;
  evaluation_context: MemoryEvaluationContextDto;
  candidates: MemoryBlockRecordDto[];
}
```

### 7.1.1 `evaluation_context`

由 TS host 生成，并已完成权限裁剪：

```ts
interface MemoryEvaluationContextDto {
  actor_ref: unknown;
  resolved_agent_id: string | null;
  pack_id: string | null;
  current_tick: string;
  attributes?: Record<string, unknown>;
  pack_state?: {
    actor_state?: Record<string, unknown> | null;
    world_state?: Record<string, unknown> | null;
    latest_event?: Record<string, unknown> | null;
  } | null;
  recent?: {
    trace?: Array<MemoryRecentSourceRecordDto>;
    intent?: Array<MemoryRecentSourceRecordDto>;
    event?: Array<MemoryRecentSourceRecordDto>;
  };
}
```

### 7.1.2 `candidates`

由 TS store 层查询，保持稳定顺序后送入 Rust：

```ts
interface MemoryBlockRecordDto {
  block: MemoryBlockDto;
  behavior: MemoryBehaviorDto;
  state: MemoryRuntimeStateDto | null;
}
```

Rust 必须按输入顺序处理并按输入顺序返回结果，以保证与当前 TS source 的稳定行为一致。

## 7.2 输出结构

```ts
interface MemoryTriggerSourceEvaluateResult {
  protocol_version: 'memory_trigger/v1alpha1';
  records: MemoryTriggerSourceRecordResult[];
  diagnostics: {
    candidate_count: number;
    materialized_count: number;
    status_counts: {
      active: number;
      retained: number;
      delayed: number;
      cooling: number;
      inactive: number;
    };
    ignored_features: {
      trigger_rate_present_count: number;
      trigger_rate_ignored: true;
    };
  };
}
```

其中：

```ts
interface MemoryTriggerSourceRecordResult {
  memory_id: string;
  evaluation: MemoryActivationEvaluationDto;
  next_runtime_state: MemoryRuntimeStateDto;
  should_materialize: boolean;
  materialize_reason: 'active' | 'retained' | null;
  ignored_features?: {
    trigger_rate_present: boolean;
    trigger_rate_ignored: true;
  };
}
```

---

## 8. 语义规范

## 8.1 `trigger_rate`

当前阶段将 `trigger_rate` 视为：

- **已声明但未实现的保留字段**

规范如下：

1. Rust sidecar **不依据 `trigger_rate` 做概率裁决**。
2. 只要其它触发条件满足，则按确定性逻辑执行。
3. 若某条 memory block 的 `behavior.activation.trigger_rate` 存在且不为默认值，Rust 返回：
   - `trigger_rate_present=true`
   - `trigger_rate_ignored=true`
4. TS host 将该信息纳入 diagnostics / observability。

这样可以保证：

- 行为确定
- replay 友好
- 后续升级不破坏协议

## 8.2 delay 语义

本轮采用以下规范：

1. 若当前存在未到期的 `delayed_until_tick > now`，则状态为 `delayed`。
2. 若 delay 已到期，且当前触发条件满足，则该 block 应进入：
   - `active`（若未被 cooldown 阻断）
3. delay 的作用是“延迟插入”，不是永久阻止激活。

即：

```text
matched -> delayed (until due)
when delayed_until_tick <= now and matched -> active
```

Rust 端必须以此作为正式行为语义。

## 8.3 status 判定顺序

建议 Rust 端遵循以下顺序：

1. `cooling`
   - `cooldown_until_tick > now`
2. `delayed`
   - `delayed_until_tick > now`
3. `retained`
   - `retain_until_tick > now && !matched`
4. `inactive`
   - `!matched`
5. `active`
   - `matched`

其中 `matched` 的含义为：

- `matched_triggers.length > 0`
- 且 `activation_score >= min_score`
- 且 `trigger_rate` 本轮不参与裁决

### 8.4 `should_materialize` 语义

与当前 TS 行为对齐：

- `active` -> `should_materialize = true`
- `retained` -> `should_materialize = true`
- 其它状态 -> `false`

---

## 9. Host / Rust 职责划分

## 9.1 Rust sidecar 职责

Rust sidecar 负责：

1. keyword trigger 评估
2. recent source trigger 评估
3. logic DSL 求值
4. activation score 计算
5. matched trigger label 生成
6. `recent_distance_from_latest_message` 计算
7. status resolve
8. next runtime state derive
9. source 结果计算
10. 忽略能力记录（如 `trigger_rate`）

## 9.2 TS host 职责

TS host 继续负责：

1. `buildMemoryEvaluationContext(...)`
2. recent trace / intent / event 的权限裁剪
3. `listCandidateBlocks(...)`
4. `updateRuntimeState(...)`
5. `materializeMemoryBlockToContextNode(...)`
6. `ContextSourceAdapter` 接线
7. `context_run.diagnostics` 汇总
8. sidecar lifecycle / health / fallback

## 9.3 明确不跨越的边界

Rust sidecar **不得**：

1. 直接连接 Prisma
2. 直接访问 kernel DB
3. 自行构造未授权 recent sources
4. 直接生成完整 `ContextRun`
5. 接管 Context Policy Engine

---

## 10. TS 集成改造方案

## 10.1 `context/sources/memory_blocks.ts`

迁移后建议改造为：

```text
buildContextNodesFromMemoryBlocks(...)
  -> build evaluationContext
  -> listCandidateBlocks
  -> call memoryTriggerSidecar.evaluateSource(...)
  -> persist next_runtime_states
  -> materialize returned active/retained records
  -> map evaluations to diagnostics
  -> return nodes + evaluations
```

这意味着：

- 文件仍保留在 TS
- 但核心 for-loop 与 trigger/status/source 逻辑被外移到 Rust

## 10.2 新增 TS sidecar client

建议新增 host client：

```text
apps/server/src/memory/blocks/rust_sidecar_client.ts
```

职责：

- sidecar 启动/握手
- health 调用
- `source.evaluate(...)` 调用
- 错误封装
- feature flag 路由

## 10.3 新增 feature flag

建议引入：

```text
memory_trigger_engine = ts | rust_shadow | rust_primary
```

### 模式语义

- `ts`
  - 继续走旧 TS 路径
- `rust_shadow`
  - TS 产生产出
  - Rust 跟跑并记录 diff
  - 不影响线上结果
- `rust_primary`
  - Rust 成为正式求值路径
  - TS 仅保留 fallback

---

## 11. Rust sidecar 内部模块建议

## 11.1 `models.rs`

定义协议 DTO：

- request / response
- memory block / behavior / runtime state / evaluation context DTO

## 11.2 `logic_dsl.rs`

迁移 TS `logic_dsl.ts` 对应能力：

- path resolve
- `and/or/not`
- `eq/in/gt/lt/contains/exists`

## 11.3 `trigger.rs`

迁移与封装：

- keyword haystack build
- keyword match
- recent source match
- logic trigger dispatch
- matched trigger summary

## 11.4 `engine.rs`

负责：

- activation score
- status resolve
- next runtime state derive
- ignored feature record
- recent distance derive

## 11.5 `source.rs`

负责：

- candidate iteration
- per-record evaluate
- `should_materialize` 计算
- aggregate diagnostics

---

## 12. 观测与 diagnostics

## 12.1 Rust 返回的聚合统计

sidecar 返回最少聚合字段：

- `candidate_count`
- `materialized_count`
- `status_counts.*`
- `ignored_features.trigger_rate_present_count`

## 12.2 TS host 写入的 context diagnostics

TS host 继续对齐现有结构：

```ts
context_run.diagnostics.memory_blocks = {
  evaluated: [...],
  inserted: [...],
  delayed: [...],
  cooling: [...],
  retained: [...],
  inactive: [...]
}
```

本轮新增建议：

```ts
context_run.diagnostics['memory-block-runtime'] = {
  engine_owner: 'rust_sidecar' | 'ts_host',
  engine_mode: 'ts' | 'rust_shadow' | 'rust_primary',
  ignored_features: {
    trigger_rate_ignored_count: number
  },
  parity_diff?: {
    mismatch_count: number;
    sample_ids: string[];
  }
}
```

这样能够显式观察：

- 当前是 TS 还是 Rust 在主导
- `trigger_rate` 是否被显式忽略
- shadow 模式是否出现结果偏差

---

## 13. 兼容性与 rollout

## 13.1 渐进式切换步骤

### Phase 1：建立 sidecar 与协议

目标：

- sidecar 可启动
- handshake / health 正常
- `source.evaluate` 可接收最小输入并返回结果

### Phase 2：Rust shadow 对跑

目标：

- TS 仍是结果 owner
- Rust 跟跑
- 记录差异：
  - `status`
  - `activation_score`
  - `matched_triggers`
  - `recent_distance_from_latest_message`
  - `next_runtime_state`
  - `should_materialize`

### Phase 3：切换 Rust primary

目标：

- sidecar 成为正式 source kernel
- TS host 仅负责 persistence/materialization/integration

## 13.2 fallback 策略

若 Rust sidecar：

- 启动失败
- handshake 失败
- request 超时
- 返回不可解析结果

则 host 应：

1. 记录 observability
2. 若模式为 `rust_primary` 且允许 fallback，则临时回退 TS
3. 若策略要求严格模式，则显式失败并保留诊断

推荐初期采用：

- `rust_shadow`：永远不影响主结果
- `rust_primary`：允许受控 fallback 到 TS

---

## 14. 测试与验收

## 14.1 单元测试

Rust 端至少覆盖：

1. keyword trigger
2. recent source trigger
3. logic DSL
4. activation score
5. `cooling / delayed / retained / inactive / active`
6. delay 到期后转 active
7. `trigger_rate` 被忽略但被记录
8. `recent_distance_from_latest_message`

## 14.2 协议测试

覆盖：

1. handshake
2. health
3. `source.evaluate` 正常请求
4. 非法参数错误返回
5. 空候选集返回

## 14.3 Host 集成测试

TS 侧至少覆盖：

1. `memory_blocks source` 在 `rust_primary` 下正常工作
2. runtime state 正确写回 store
3. active/retained block 正确 materialize
4. diagnostics 聚合正确
5. sidecar 异常时 fallback 正常

## 14.4 Shadow parity 验收

切主前，至少应通过：

- 样本 world / agent 场景下 `status` 一致率 100%
- `should_materialize` 一致率 100%
- `next_runtime_state` 一致率 100%
- `recent_distance_from_latest_message` 一致率 100%

如存在差异，应先明确：

- 是 TS 现有 bug
- 还是 Rust 偏差
- 再决定是修 TS 对齐 Rust，还是修 Rust 对齐既定语义

---

## 15. 风险与约束

### 风险 1：误把 source adapter 整体迁出 TS

若把 `ContextSourceAdapter` 本体整体搬进 Rust，会扩大边界并牵连 Context Module，超出本轮范围。

**控制方式**：仅迁 source kernel，不迁 adapter shell。

### 风险 2：`trigger_rate` 半实现导致非确定性

若在未设计 replay 语义前引入随机行为，会破坏回放与调试能力。

**控制方式**：本轮明确忽略，但必须记录。

### 风险 3：delay 语义在 TS/Rust/设计之间漂移

若 delay 到期后的状态规则不统一，会导致 shadow 模式长时间 diff。

**控制方式**：以本文定义的规范语义为准，先做统一测试。

### 风险 4：Rust 返回结果过于接近 `ContextNode`

若 Rust 直接返回完整 `ContextNode` 结构，会把 Context Module 类型耦合进 sidecar。

**控制方式**：Rust 只返回 source result / evaluation / next state；ContextNode 仍由 TS materializer 生成。

---

## 16. 最终设计结论

本轮采用如下迁移策略：

> **新增独立 `memory_trigger_sidecar`，将 Memory Block Trigger Engine 与 memory_blocks source 的核心执行内核迁入 Rust；TS host 继续保留 persistence、权限裁剪、Context 接线与 materialization。**

该设计满足：

1. 不破坏 `ARCH.md` 已确认的 kernel-side memory subsystem 边界。
2. 不把 Memory Runtime 错误并入 world engine。
3. 将 deterministic kernel 迁移到 Rust。
4. 保留 TS host 对数据库、权限、上下文系统的控制权。
5. 为未来完整 `Memory Block Runtime` Rust 化保留清晰演进路径。

---

## 17. 后续实现建议（供下一阶段 plan 使用）

进入 implementation plan 时，建议拆成以下工作包：

1. `memory_trigger_sidecar` crate scaffold + JSON-RPC protocol
2. Rust DTO / logic DSL / trigger engine 迁移
3. Rust source kernel 实现
4. TS sidecar client 与 feature flag
5. `context/sources/memory_blocks.ts` 改造成 thin shell
6. shadow parity 测试与 diff 观测
7. `rust_primary` 切换与 fallback 验证

本设计文档到此为止；不在本阶段直接生成 implementation plan 或代码。
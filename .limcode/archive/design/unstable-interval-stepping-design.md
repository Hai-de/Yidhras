# 不稳定区间步进能力设计草案

> 状态: 草案
> 评估时间: 2026-05-22
> 关联: TODO.md — 时钟系统增强
> 约束: 无向后兼容要求，允许破坏性变更

## 1. 问题陈述

当前 Yidhras 模拟时钟系统完全基于**固定步进模式**运行。每次世界引擎循环推进固定 tick 数，壁钟间隔也是统一固定值。具体约束：

| 约束点 | 当前行为 |
|--------|----------|
| `RuntimeSpeedPolicy.mode` | 字面量 `'fixed'`，无其他模式 |
| `PackSimulationLoop.stepTicks` | 硬编码 `'1'`，不读取速度策略 |
| `MultiPackLoopHost.intervalMs` | 全 pack 共享同一值，运行时不可变 |
| `simulation_time.step_ticks` | schema 仅支持单值，无范围/策略字段 |

不支持以下场景：
- 根据系统负载动态调整步进量（高负载减步、低负载增步）
- 不同 pack 以不同步进节奏运行
- 同一 pack 在不同阶段使用不同步进策略（如"夜间慢速、白天正常"）
- 基于事件驱动的非均匀时间推进（如"跳跃到下一个关键事件点"）

## 2. 设计目标

1. **可变步进为唯一模式** — 不保留固定步进，所有 pack 必须声明步进策略
2. **Per-pack 独立调度** — 每个 pack 有独立的壁钟间隔和步进策略，不再共享
3. **运行时可变** — API 覆盖可以在运行时切换策略及参数
4. **直接重构** — 不新增抽象层包装旧逻辑，直接改动原有代码

## 3. 影响的文件和方面

### 3.1 核心 — 运行时速度策略 (3 files)

**`apps/server/src/core/runtime_speed.ts`** — 重写

- 删除 `mode: 'fixed'` 字面量类型，`RuntimeSpeedSnapshot.mode` 改为 `'variable' | 'adaptive'`
- `RuntimeSpeedPolicy` 重构：
  - 删除 `defaultStepTicks`、`configuredStepTicks`、`overrideStepTicks` 三个固定值字段
  - 新增 `strategy: StepStrategy` — 策略配置的单一真相源
  - `getEffectiveStepTicks(ctx: StepContext): bigint` — 每次调用根据上下文动态计算
  - `setStrategy(strategy: StepStrategy): void` — 运行时切换策略
  - `getSnapshot(): RuntimeSpeedSnapshot` — 输出当前策略及参数

```typescript
interface StepStrategy {
  kind: 'variable' | 'adaptive';
  range: { min: bigint; max: bigint };
  // variable: 由调用方传入 step_ticks
  // adaptive: 根据负载指标自动计算
  loadConfig?: { targetLoopMs: number; scaleUpThreshold: number; scaleDownThreshold: number };
}

interface StepContext {
  currentTick: bigint;
  lastLoopDurationMs: number;
  pendingEventCount: number;
}
```

**`apps/server/src/core/pack_runtime_instance.ts`** — 简化

- `step(amount)` — 保留，供手动 tick 使用
- `applyClockProjection` — 无需改动（已基于绝对 tick）
- 删除 `setRuntimeSpeedOverride(stepTicks: bigint)`，替换为 `setStepStrategy(strategy: StepStrategy)`

**`apps/server/src/core/pack_runtime_host.ts`** — 接口更新

- `setRuntimeSpeedOverride(stepTicks: bigint)` → `setStepStrategy(strategy: StepStrategy)`
- 新增 `getStepStrategy(): StepStrategy`

### 3.2 模拟循环 (2 files)

**`apps/server/src/app/runtime/PackSimulationLoop.ts`** — 核心改动

- 第 363 行硬编码 `const stepTicks = '1'` — 删除，替换为：
  ```typescript
  const ctx = buildStepContext(packRuntime, loopMetrics);
  const stepTicks = packRuntime.getEffectiveStepTicks(ctx).toString();
  ```
- `stepPackWorldEngine` 每次循环迭代动态计算 step_ticks
- 循环调度：`intervalMs` 从 pack 策略配置读取，不再从全局 env 读取
- 重叠跳过逻辑保留，但 `overlap_skipped_count` 作为 adaptive 策略的负载指标输入

**`apps/server/src/app/runtime/MultiPackLoopHost.ts`** — 调度重构

- 删除全局共享 `intervalMs`
- 每个 `PackSimulationLoop` 初始化时从 pack 策略配置读取自己的 `intervalMs`
- 提供 `updatePackInterval(packId, newMs)` 支持运行时调整

### 3.3 世界引擎 Sidecar — Rust (3 files)

**`apps/server/rust/world-engine/src/handlers/step.rs`**

- `handle_step_prepare` — `step_ticks.parse::<u64>()` 已支持任意值，无需改动
- **缓存键修复**：cached commit 当前以 `next_tick` 为键。可变步进下，同一步进量到达同一 `next_tick` 的概率降低，缓存命中率会下降。需确认这是可接受的，或改为基于 `(base_tick, step_ticks)` 的复合键。

**`apps/server/rust/world-engine/src/engine/step.rs`**

- `do_prepare_step` — 已用 `step_ticks` 计算 `next_tick = current_tick + step_ticks`，无需改动

**`apps/server/rust/world-engine/src/engine/query.rs`**

- `step_ticks` 仅透传至 observability，无需改动

### 3.4 世界引擎持久化与投影 (3 files)

**`apps/server/src/app/runtime/world_engine_persistence.ts`**

- `applyCommittedClockProjection` — 基于绝对 `committed_tick`，无需改动
- `buildClockProjectionSnapshot` — 新增 `step_ticks_applied: string` 字段记录本次步进量

**`apps/server/src/app/runtime/runtime_clock_projection.ts`**

- `RuntimeClockProjectionSnapshot` 新增 `step_ticks_applied: string`

**`apps/server/src/app/runtime/default_step_contributor.ts`**

- 已从 `input.step_ticks` 动态计算 `next_tick` 和 `next_revision`，无需改动
- `next_revision` 现在是 `currentRevision + stepTicks`，跨度可变。下游需排查对 revision 跨度有固定假设的代码。

### 3.5 配置与 Schema — 破坏性变更 (4 files)

**`apps/server/src/packs/schema/constitution_schema.ts`**

`simulationTimeConfigSchema` 重写：

```typescript
// 删除旧的 step_ticks 单值字段，替换为：
export const simulationTimeConfigSchema = z.object({
  min_tick: tickLikeSchema.optional(),
  max_tick: tickLikeSchema.optional(),
  initial_tick: tickLikeSchema.optional(),
  step: z.object({
    strategy: z.enum(['variable', 'adaptive']),
    range: z.object({
      min: tickLikeSchema,
      max: tickLikeSchema
    }),
    loop_interval_ms: z.number().int().positive().optional(), // 壁钟间隔，默认 1000
    adaptive: z.object({
      target_loop_ms: z.number().int().positive(),
      scale_up_threshold_ms: z.number().int().positive(),
      scale_down_threshold_ms: z.number().int().positive()
    }).optional()
  })
}).strict();
```

**`apps/server/src/packs/manifest/constitution_loader.ts`**

- `SimulationTimeConfig` 类型同步重写
- 旧的 `step_ticks?: string` 字段删除

**`apps/server/src/config/domains/clock.ts`**

- 新增 `max_step_ticks` 上限调整（可变步进下上限需要更大）
- 新增 `adaptive_defaults` 全局 adaptive 策略默认参数

**`apps/server/src/config/tiers.ts`**

- 新配置项 tier 分类

**现有 world pack 配置迁移**：

`data/world_packs/*/config/simulation_time.yaml` 从：
```yaml
step_ticks: 1
```
改为：
```yaml
step:
  strategy: variable
  range:
    min: 1
    max: 10
  loop_interval_ms: 1000
```

### 3.6 Contracts 包 — 破坏性变更 (3 files)

**`packages/contracts/src/clock.ts`**

- `runtimeSpeedResponseDataSchema` — `mode: z.literal('fixed')` 改为 `mode: z.enum(['variable', 'adaptive'])`
- 删除 `configured_step_ticks`、`override_step_ticks`、`effective_step_ticks` 字段
- 新增 `strategy`、`range`、`adaptive_config` 字段
- `runtimeSpeedOverrideRequestSchema` — 从 `override(step_ticks)` / `clear` 改为 `set_strategy(strategy)` / `reset`

**`packages/contracts/src/system.ts`**

- `runtime_speed` 字段同步重写

**`packages/contracts/src/world_engine.ts`**

- `worldStepPrepareRequestSchema.step_ticks` — 已接受任意正整数字符串，无需改动

### 3.7 API 与 HTTP 层 — 破坏性变更 (4 files)

**`apps/server/src/app/http/runtime.ts`**

- `parsePositiveStepTicks` — 删除，替换为 `parseStepStrategy`，验证 strategy 对象结构
- 验证逻辑：range.min > 0, range.max >= range.min, adaptive 配置完整性检查

**`apps/server/src/app/routes/clock.ts`**

- `POST /clock/speed` — 接口重写：
  ```typescript
  // 旧: { action: 'override', step_ticks: '5' }
  // 新: { action: 'set_strategy', strategy: { kind: 'variable', range: { min: 1, max: 10 } } }
  ```

**`apps/server/src/app/services/runtime/runtime_control.ts`**

- `overrideRuntimeSpeed` — 删除，替换为 `setPackStepStrategy(context, packId, strategy)`

**`apps/server/src/app/services/runtime/experimental_runtime_control_plane_service.ts`**

- 控制平面服务同步更新

### 3.8 时钟引擎 (1 file)

**`apps/server/src/clock/engine.ts`**

- `tick(amount)` — 已支持任意 bigint，无需改动
- `setTicks(next)` — 已支持任意绝对值，无需改动
- `maxStepTicks` 保护 — 值从 `100000` 上调至合理范围，或改为按 pack 配置

### 3.9 投影管道 (2 files)

**`apps/server/src/domain/projection/projection_evaluator.ts`**

- `tick_interval` 节流 `tickNum % when.tick_interval !== 0` — 可变步进下此逻辑有缺陷。
- 改为累计计数器：记录上次执行 tick，判断 `tickNum - lastExecutionTick >= when.tick_interval`

**`apps/server/src/domain/projection/types.ts`**

- `ProjectionWhen.tick_interval` 语义从"每隔 N tick 的取模判断"改为"距离上次执行至少 N tick"

### 3.10 系统诊断 (1 file)

**`apps/server/src/app/services/system/system.ts`**

- 系统状态快照中 `runtime_speed` 序列化结构同步更新

### 3.11 World Pack 运行时配置 (2 files)

**`apps/server/src/core/world_pack_runtime.ts`**

- `getWorldPackRuntimeConfig` — 解析新 `step` 配置块，删除 `configuredStepTicks` 解析

**`apps/server/src/core/runtime_activation.ts`**

- Pack 激活验证 — 验证 `step.strategy`、`step.range` 合法性
- 删除旧的 `step_ticks > 0` 验证

### 3.12 World Pack 插件 — 直接适配 (2个现有插件)

**`data/world_packs/closed_space_simulator/plugins/game-loop/server.ts`**
**`data/world_packs/snowbound_mansion/plugins/game-loop/server.ts`**

- 两个日/夜循环插件硬编码 `DAY_TICK_INTERVAL = 86_400_000n` 等常量
- 需评估：可变步进下，步进量最大不超过 `step.range.max`（配置中声明），如果 max 远小于一天对应的 tick 数，插件的状态切换逻辑不受影响
- 如果需要大步进跨越，插件应改为监听 tick 变化量累加而非依赖固定步进

### 3.13 CLI 与脚手架 (2 files)

**`apps/server/src/cli/validate_pack_cli.ts`**

- 验证逻辑识别新 schema 字段

**`apps/server/src/init/world_pack_project_scaffold.ts`**

- `section.simulation_time.yaml.template` 模板更新为新格式

### 3.14 Stub 与测试 (2 files)

**`apps/server/src/core/pack_runtime_stub.ts`**

- `PackRuntimeStub` 的 `runtime_speed` 快照更新为新结构

**`apps/server/src/app/services/runtime/experimental_multi_pack_runtime.ts`**

- 实验性多 pack 运行时需同步适配

### 3.15 新增文件（预计）

- `apps/server/src/core/step_strategy.ts` — `StepStrategy` 类型、`buildStepContext`、adaptive 策略计算逻辑
- `apps/server/src/core/step_strategy.test.ts` — 单元测试

## 4. 影响汇总

| 层级 | 文件数 | 改动性质 |
|------|--------|----------|
| 核心速度策略 | 3 | **重写** |
| 模拟循环 | 2 | **解除硬编码 + 调度重构** |
| 世界引擎 Rust | 3 | 缓存键评估 |
| 持久化与投影 | 3 | 字段新增 |
| 配置与 Schema | 4 + 2 pack yaml | **破坏性 schema 变更** |
| Contracts | 3 | **破坏性 schema 变更** |
| API/HTTP | 4 | **接口重写** |
| 时钟引擎 | 1 | maxStepTicks 调参 |
| 投影管道 | 2 | tick_interval 语义修复 |
| 系统诊断 | 1 | 序列化适配 |
| 运行时配置 | 2 | 解析重写 |
| World Pack 插件 | 2 | 兼容性评估 + 适配 |
| CLI/脚手架 | 2 | 模板 + 验证更新 |
| Stub/测试 | 2 | 同步适配 |
| 新增 | 2 | step_strategy 模块 |
| **合计** | **~36 files** | |

## 5. 关键设计决策

1. **可变步进的计算责任** — 步进量由 TS 侧（`RuntimeSpeedPolicy`）计算后传入世界引擎。世界引擎保持无状态，只执行被告知的步进量。

2. **`tick_interval` 语义变更** — 取模判断改为累计距离判断（`tickNum - lastExecutionTick >= tick_interval`），消除可变步进导致的跳过问题。

3. **壁钟调度与模拟步进的关系** — 壁钟间隔（`loop_interval_ms`）和 tick 步进量（`step_ticks`）各自独立配置。壁钟控制循环频率，步进量控制每次推进的时间跨度。两者不需要耦合。

4. **revision 跨度** — 改为可变 revision 跨度（`nextRevision = currentRevision + stepTicks`）。排查下游对 revision 步长为 1 的假设，直接修复。

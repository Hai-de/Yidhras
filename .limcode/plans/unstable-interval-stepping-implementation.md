<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/unstable-interval-stepping-design.md","contentHash":"sha256:placeholder"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 阶段一：新类型、接口、Schema 定义，旧字段标记废弃  `#uis-1`
- [ ] 阶段二：step_strategy 模块 + RuntimeSpeedPolicy 重写  `#uis-2`
- [ ] 阶段三：PackRuntime 层适配，删除旧接口  `#uis-3`
- [ ] 阶段四：模拟循环解除硬编码 + MultiPackLoopHost 重构  `#uis-4`
- [ ] 阶段五：投影管道 tick_interval 语义修复  `#uis-5`
- [ ] 阶段六：API/HTTP 层 + Contracts 重写  `#uis-6`
- [ ] 阶段七：World pack 配置迁移 + 插件适配  `#uis-7`
- [ ] 阶段八：清理旧代码残留 + 全量 typecheck/lint/test  `#uis-8`
<!-- LIMCODE_TODO_LIST_END -->

# 不稳定区间步进实现计划

> 基于: `.limcode/design/unstable-interval-stepping-design.md`
> 原则: 测试先行，接口先行。每个阶段先写测试定义契约，再写实现满足契约。不允许向后兼容。

---

## 阶段一：新类型、接口、Schema 定义

此阶段不包含实现逻辑。仅定义类型、接口、Zod schema。旧字段加 `@deprecated` 注释但不删除（等阶段八统一清理）。所有后续阶段依赖此阶段的输出。

### 1.1 新建：步进策略类型模块

**文件**: `apps/server/src/core/step_strategy.ts`

```typescript
export type StepStrategyKind = 'variable' | 'adaptive';

export interface StepStrategyRange {
  min: bigint;
  max: bigint;
}

export interface AdaptiveConfig {
  targetLoopMs: number;
  scaleUpThresholdMs: number;
  scaleDownThresholdMs: number;
}

export interface StepStrategy {
  kind: StepStrategyKind;
  range: StepStrategyRange;
  loopIntervalMs: number; // 默认 1000
  adaptive?: AdaptiveConfig; // kind === 'adaptive' 时必填
}

export interface StepContext {
  currentTick: bigint;
  lastLoopDurationMs: number;
  overlapSkippedCount: number;
  pendingEventCount: number;
}
```

### 1.2 更新：PackRuntimeHost 接口

**文件**: `apps/server/src/core/pack_runtime_host.ts`

```typescript
// 新增
getStepStrategy(): StepStrategy;
setStepStrategy(strategy: StepStrategy): void;
getEffectiveStepTicks(ctx: StepContext): bigint;

// 标记废弃（阶段八删除）
/** @deprecated 替换为 setStepStrategy */
setRuntimeSpeedOverride(stepTicks: bigint): void;
```

### 1.3 更新：RuntimeSpeedSnapshot 类型

**文件**: `apps/server/src/core/runtime_speed.ts`

```typescript
// 旧（保留至阶段八）
export interface RuntimeSpeedSnapshot {
  mode: 'fixed';
  // ...
}

// 新
export interface RuntimeSpeedSnapshotV2 {
  mode: 'variable' | 'adaptive';
  strategy: StepStrategy;
  effective_step_ticks: string; // 最近一次计算值，仅 observability
}
```

### 1.4 更新：Contracts Zod Schema

**文件**: `packages/contracts/src/clock.ts`

新增 schema（旧 schema 保留，加 `@deprecated` 注释）：

```typescript
export const stepStrategyRangeSchema = z.object({
  min: positiveBigIntStringSchema,
  max: positiveBigIntStringSchema
});

export const adaptiveConfigSchema = z.object({
  target_loop_ms: z.number().int().positive(),
  scale_up_threshold_ms: z.number().int().positive(),
  scale_down_threshold_ms: z.number().int().positive()
});

export const stepStrategySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('variable'),
    range: stepStrategyRangeSchema,
    loop_interval_ms: z.number().int().positive().optional()
  }),
  z.object({
    kind: z.literal('adaptive'),
    range: stepStrategyRangeSchema,
    loop_interval_ms: z.number().int().positive().optional(),
    adaptive: adaptiveConfigSchema
  })
]);

export const runtimeSpeedResponseDataSchemaV2 = z.object({
  runtime_speed: z.object({
    mode: z.enum(['variable', 'adaptive']),
    strategy: stepStrategySchema,
    effective_step_ticks: positiveBigIntStringSchema
  })
});

export const runtimeSpeedOverrideRequestSchemaV2 = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_strategy'),
    strategy: stepStrategySchema
  }),
  z.object({
    action: z.literal('reset')
  })
]);
```

**文件**: `packages/contracts/src/system.ts`

`runtime_speed` 字段切换到 V2 schema。

### 1.5 更新：Constitution Schema

**文件**: `apps/server/src/packs/schema/constitution_schema.ts`

```typescript
// simulationTimeConfigSchema — 旧 step_ticks 字段标记废弃，新增 step 对象
export const simulationTimeConfigSchema = z.object({
  min_tick: tickLikeSchema.optional(),
  max_tick: tickLikeSchema.optional(),
  initial_tick: tickLikeSchema.optional(),
  /** @deprecated 替换为 step.strategy */
  step_ticks: tickLikeSchema.optional(),
  step: z.object({
    strategy: z.enum(['variable', 'adaptive']),
    range: z.object({
      min: tickLikeSchema,
      max: tickLikeSchema
    }),
    loop_interval_ms: z.number().int().positive().optional(),
    adaptive: z.object({
      target_loop_ms: z.number().int().positive(),
      scale_up_threshold_ms: z.number().int().positive(),
      scale_down_threshold_ms: z.number().int().positive()
    }).optional()
  }).optional()
}).strict();
```

### 1.6 测试文件（仅类型校验，无运行逻辑）

**文件**: `apps/server/tests/unit/step_strategy.test.ts`

```typescript
// 阶段一仅验证类型可导入、schema 可解析
describe('StepStrategy types', () => {
  it('StepStrategyKind 仅接受 variable 和 adaptive', () => {
    // 类型检查：编译期约束
  });

  it('stepStrategySchema 解析合法 variable 策略', () => {
    const result = stepStrategySchema.parse({
      kind: 'variable',
      range: { min: '1', max: '10' }
    });
    expect(result.kind).toBe('variable');
  });

  it('stepStrategySchema 解析合法 adaptive 策略', () => {
    const result = stepStrategySchema.parse({
      kind: 'adaptive',
      range: { min: '1', max: '100' },
      adaptive: { target_loop_ms: 500, scale_up_threshold_ms: 300, scale_down_threshold_ms: 800 }
    });
    expect(result.kind).toBe('adaptive');
  });

  it('stepStrategySchema 拒绝 kind=adaptive 但缺少 adaptive 配置', () => {
    expect(() => stepStrategySchema.parse({
      kind: 'adaptive',
      range: { min: '1', max: '100' }
    })).toThrow();
  });

  it('stepStrategySchema 拒绝 range.min > range.max', () => {
    // 自定义 refine
  });
});
```

---

## 阶段二：step_strategy 模块 + RuntimeSpeedPolicy 重写

### 2.1 测试先行：RuntimeSpeedPolicy 行为测试

**文件**: `apps/server/tests/unit/runtime_speed.test.ts`

```typescript
describe('RuntimeSpeedPolicy (V2)', () => {
  describe('variable 模式', () => {
    it('getEffectiveStepTicks 返回 context 中指定的步进量（由上层传入）', () => {});
    it('返回的步进量受 range.max 上限约束', () => {});
    it('返回的步进量受 range.min 下限约束', () => {});
  });

  describe('adaptive 模式', () => {
    it('lastLoopDurationMs < scaleUpThreshold 时增大步进', () => {});
    it('lastLoopDurationMs > scaleDownThreshold 时减小步进', () => {});
    it('步进量不超过 range.max', () => {});
    it('步进量不低于 range.min', () => {});
    it('连续多次 scaleUp 不会溢出', () => {});
    it('连续多次 scaleDown 不会归零', () => {});
    it('overlapSkippedCount > 0 时优先减步', () => {});
  });

  describe('setStrategy', () => {
    it('运行时切换策略后 getEffectiveStepTicks 使用新策略', () => {});
    it('从 adaptive 切换到 variable 后清除 adaptive 状态', () => {});
  });
});
```

### 2.2 实现：step_strategy.ts 模块

**文件**: `apps/server/src/core/step_strategy.ts`（在阶段一的类型定义上扩展）

```typescript
export function buildStepContext(params: {
  currentTick: bigint;
  lastLoopDurationMs: number;
  overlapSkippedCount: number;
  pendingEventCount: number;
}): StepContext { /* ... */ }

export function computeVariableStep(
  strategy: StepStrategy,
  ctx: StepContext,
  requestedStep?: bigint
): bigint {
  const step = requestedStep ?? strategy.range.min;
  return clampStep(step, strategy.range);
}

export function computeAdaptiveStep(
  strategy: StepStrategy,
  ctx: StepContext,
  previousStep: bigint
): bigint {
  // 基于 lastLoopDurationMs 决定 scaleUp/scaleDown
  // 返回 clampStep(result, strategy.range)
}

function clampStep(step: bigint, range: StepStrategyRange): bigint {
  if (step < range.min) return range.min;
  if (step > range.max) return range.max;
  return step;
}
```

### 2.3 实现：RuntimeSpeedPolicy 重写

**文件**: `apps/server/src/core/runtime_speed.ts`

- 类主体重写，保留旧 `RuntimeSpeedSnapshot` 类型（标记 `@deprecated`）供阶段三过渡
- `getEffectiveStepTicks(ctx: StepContext, requestedStep?: bigint): bigint` — 根据 strategy.kind 分发到 `computeVariableStep` 或 `computeAdaptiveStep`
- adaptive 模式内部维护 `previousStep` 状态用于连续调优

---

## 阶段三：PackRuntime 层适配

### 3.1 测试先行：PackRuntimeInstance 行为测试

**文件**: `apps/server/tests/unit/pack_runtime_instance.test.ts`

```typescript
describe('PackRuntimeInstance (V2 step strategy)', () => {
  it('getStepStrategy 返回 world pack 配置的策略', () => {});
  it('setStepStrategy 更新策略并影响 getEffectiveStepTicks', () => {});
  it('getEffectiveStepTicks 委托给 RuntimeSpeedPolicy', () => {});
  it('applyClockProjection 仍正常工作（基于绝对 tick）', () => {});
  // 旧接口存在但标为废弃
  it('setRuntimeSpeedOverride 已废弃但调用仍转发到 setStepStrategy', () => {});
});
```

### 3.2 实现

**文件**: `apps/server/src/core/pack_runtime_instance.ts`

- 新增 `getStepStrategy()`、`setStepStrategy()`、`getEffectiveStepTicks()`
- `setRuntimeSpeedOverride` 改为转发到 `setStepStrategy`，加 `@deprecated` 注释
- `configureRuntimeSpeedFromPack` — 解析新 `step` 配置块，fallback 到 `step_ticks`（若有）

**文件**: `apps/server/src/core/pack_runtime_host.ts`

- 接口新增方法签名

**文件**: `apps/server/src/core/pack_runtime_stub.ts`

- Stub 实现新增方法

**文件**: `apps/server/src/core/world_pack_runtime.ts`

- `getWorldPackRuntimeConfig` 解析新 `step` 字段，若不存在则从旧 `step_ticks` 构建默认 variable 策略

---

## 阶段四：模拟循环解除硬编码

### 4.1 测试先行：PackSimulationLoop 步进计算测试

**文件**: `apps/server/tests/unit/pack_simulation_loop.test.ts`

```typescript
describe('PackSimulationLoop step tick computation', () => {
  it('stepPackWorldEngine 使用 packRuntime.getEffectiveStepTicks 而非硬编码 1', () => {});
  it('每次循环迭代重新计算 stepTicks（不缓存）', () => {});
  it('overlapSkippedCount 传递给 StepContext', () => {});
  it('intervalMs 从 pack StepStrategy.loopIntervalMs 读取', () => {});
  it('adaptive 模式下 lastLoopDurationMs 反映实际循环耗时', () => {});
});
```

### 4.2 测试先行：MultiPackLoopHost 独立调度测试

**文件**: `apps/server/tests/unit/multi_pack_loop_host.test.ts`

```typescript
describe('MultiPackLoopHost per-pack scheduling', () => {
  it('每个 pack 用自己的 intervalMs 而非全局共享', () => {});
  it('updatePackInterval 运行时调整单个 pack 的间隔', () => {});
  it('不同 pack 的循环互不阻塞', () => {});
});
```

### 4.3 实现

**文件**: `apps/server/src/app/runtime/PackSimulationLoop.ts`

- 第 363 行 `const stepTicks = '1'` → 替换为 `packRuntime.getEffectiveStepTicks(ctx).toString()`
- `intervalMs` 从 `packRuntime.getStepStrategy().loopIntervalMs` 读取
- 新增 `measureLoopDuration()` 辅助，在每次迭代结束时记录耗时

**文件**: `apps/server/src/app/runtime/MultiPackLoopHost.ts`

- 删除构造函数中的全局 `intervalMs` 参数
- 每个 `PackSimulationLoop` 创建时注入独立的 `intervalMs`
- 新增 `updatePackInterval(packId: string, newMs: number)` 方法

---

## 阶段五：投影管道 tick_interval 语义修复

### 5.1 测试先行

**文件**: `apps/server/tests/unit/projection_evaluator.test.ts`

```typescript
describe('ProjectionEvaluator tick_interval (V2)', () => {
  it('可变步进下 tick_interval 基于累计距离而非取模', () => {
    // tick=5, lastExecutionTick=2, tick_interval=4
    // 旧逻辑: 5 % 4 !== 0 → skip（错误！已过 3 tick 但还未满 4）
    // 新逻辑: 5 - 2 >= 4 → false → skip（正确）
  });
  it('累计距离正好等于 tick_interval 时触发', () => {
    // tick=6, lastExecutionTick=2, tick_interval=4 → 触发
  });
  it('累计距离超过 tick_interval 时触发', () => {
    // tick=10, lastExecutionTick=2, tick_interval=4 → 触发
  });
  it('首次执行无 lastExecutionTick 时立即触发', () => {});
  it('触发后更新 lastExecutionTick', () => {});
});
```

### 5.2 实现

**文件**: `apps/server/src/domain/projection/projection_evaluator.ts`

- 取模判断 `tickNum % when.tick_interval !== 0` → 改为 `tickNum - lastExecutionTick >= when.tick_interval`
- 需要维护 per-rule 的 `lastExecutionTick` 状态

**文件**: `apps/server/src/domain/projection/types.ts`

- `ProjectionWhen.tick_interval` 注释更新

---

## 阶段六：API/HTTP 层 + Contracts 重写

### 6.1 测试先行：API 测试

**文件**: `apps/server/tests/integration/clock_routes.test.ts`

```typescript
describe('POST /api/clock/speed (V2)', () => {
  it('set_strategy 更新 variable 策略', async () => {});
  it('set_strategy 更新 adaptive 策略', async () => {});
  it('set_strategy 拒绝 range.min > range.max', async () => {});
  it('set_strategy 拒绝 adaptive 缺 adaptive 配置', async () => {});
  it('reset 恢复为 world pack 默认策略', async () => {});
  it('GET /api/clock/speed 返回 V2 结构', async () => {});
});
```

### 6.2 实现

**文件**: `apps/server/src/app/http/runtime.ts`

- 删除 `parsePositiveStepTicks`
- 新增 `parseStepStrategy(body: unknown): StepStrategy`

**文件**: `apps/server/src/app/routes/clock.ts`

- `POST /clock/speed` — action 支持 `set_strategy` / `reset`
- `GET /clock/speed` — 返回 V2 schema

**文件**: `apps/server/src/app/services/runtime/runtime_control.ts`

- 删除 `overrideRuntimeSpeed`
- 新增 `setPackStepStrategy(context, packId, strategy)`

**文件**: `apps/server/src/app/services/runtime/experimental_runtime_control_plane_service.ts`

- 同步适配 V2 结构

**文件**: `apps/server/src/app/services/system/system.ts`

- `runtime_speed` 快照切换到 V2 格式

---

## 阶段七：World Pack 配置迁移 + 插件适配

### 7.1 World Pack YAML 迁移

**文件**: `data/world_packs/closed_space_simulator/config/simulation_time.yaml`

```yaml
# 旧
# step_ticks: 1

# 新
step:
  strategy: variable
  range:
    min: 1
    max: 10
  loop_interval_ms: 1000
```

**文件**: `data/world_packs/snowbound_mansion/config/simulation_time.yaml`

同上。

### 7.2 日/夜循环插件评估

**文件**: `data/world_packs/closed_space_simulator/plugins/game-loop/server.ts`
**文件**: `data/world_packs/snowbound_mansion/plugins/game-loop/server.ts`

- 确认 `DAY_TICK_INTERVAL = 86_400_000n` 等常量在 step_ticks max=10 时不受影响（步进量远小于一天对应的 tick 数）
- 无需改动

### 7.3 脚手架模板更新

**文件**: `apps/server/src/init/world_pack_project_scaffold.ts`

- `section.simulation_time.yaml.template` 更新为新格式

---

## 阶段八：清理旧代码残留

### 8.1 删除列表

| 文件 | 删除内容 |
|------|----------|
| `apps/server/src/core/runtime_speed.ts` | 旧 `RuntimeSpeedSnapshot` 类型（`mode: 'fixed'` 版本） |
| `apps/server/src/core/pack_runtime_instance.ts` | `setRuntimeSpeedOverride` 方法 |
| `apps/server/src/core/pack_runtime_host.ts` | 接口中 `setRuntimeSpeedOverride` 签名 |
| `apps/server/src/core/pack_runtime_stub.ts` | Stub 中旧方法 |
| `packages/contracts/src/clock.ts` | 旧 `runtimeSpeedResponseDataSchema`（`mode: z.literal('fixed')`） |
| `packages/contracts/src/clock.ts` | 旧 `runtimeSpeedOverrideRequestSchema` |
| `apps/server/src/packs/schema/constitution_schema.ts` | `step_ticks` 字段 |
| `apps/server/src/app/http/runtime.ts` | `parsePositiveStepTicks` |
| `apps/server/src/app/services/runtime/runtime_control.ts` | `overrideRuntimeSpeed` |
| `apps/server/src/core/world_pack_runtime.ts` | 旧 `step_ticks` 解析 |
| `data/world_packs/*/config/simulation_time.yaml` | 注释掉的 `step_ticks` 行（若保留） |

### 8.2 全局验证

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter yidhras-server test:integration
pnpm --filter yidhras-server test:e2e
```

---

## 执行顺序与依赖关系

```
阶段一 (类型/Schema) ─────────────────────────────┐
  │                                                │
  ├── 阶段二 (step_strategy + RuntimeSpeedPolicy)  │
  │     │                                          │
  │     └── 阶段三 (PackRuntime)                   │
  │           │                                    │
  │           └── 阶段四 (模拟循环)                 │
  │                 │                              │
  │                 ├── 阶段五 (投影管道) ──────────┤
  │                 │                              │
  │                 └── 阶段六 (API/HTTP) ─────────┤
  │                                                │
  └── 阶段七 (World Pack 迁移) ────────────────────┤
                                                    │
                              阶段八 (清理 + 全量验证)
```

阶段二到六均依赖阶段一的类型定义，但二到六之间除了三→四→六的依赖外，其余可部分并行。五（投影管道）与四/六无依赖，可独立进行。七（World Pack 迁移）依赖阶段一的 schema 确定后即可执行。

## 非目标

- 不引入除 `variable` 和 `adaptive` 之外的第三种策略
- 不改造 Rust 世界引擎 sidecar（已支持任意 step_ticks 值）
- 不修改 `ChronosEngine` 时钟引擎核心逻辑
- 不改变世界引擎 prepare/commit 协议

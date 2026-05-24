# RuntimeSpeedSnapshot 模型清理与旧结构暴露修复计划

## 背景与真实问题

当前诊断来自：

`apps/server/tests/integration/world_pack_projection_flow.spec.ts:361`

```text
不能将类型“\"fixed\"”分配给类型“\"variable\" | \"adaptive\"”。
```

直接触发点是 `getPackRuntimeHandle(...)` 的 mock 近期从强制断言：

```ts
}) as PackRuntimeHandle
```

改成了结构校验：

```ts
}) satisfies PackRuntimeHandle
```

这让 TypeScript 开始真实检查 `PackRuntimeHandle.getRuntimeSpeedSnapshot()` 的返回类型。

当前真实接口定义为：

`apps/server/src/core/runtime_speed.ts`

```ts
export interface RuntimeSpeedSnapshot {
  mode: 'variable' | 'adaptive';
  source: RuntimeSpeedSource;
  strategy: StepStrategy;
  effective_step_ticks: string;
  override_since: number | null;
}
```

而多个测试和少量旧展示结构仍在使用旧模型：

```ts
{
  mode: 'fixed',
  source: 'default',
  configured_step_ticks: null,
  override_step_ticks: null,
  override_since: null,
  effective_step_ticks: '1'
}
```

这不是单行拼写问题，而是项目内存在两套 RuntimeSpeedSnapshot 形状：

1. 当前源码模型：`variable | adaptive` + `strategy`
2. 旧测试/展示模型：`fixed` + `configured_step_ticks` + `override_step_ticks`

由于很多位置使用 `as any`、`as unknown as ...`、不完整 mock 或未被 `satisfies` 精确约束，旧模型长期被遮蔽。现在只是 `world_pack_projection_flow.spec.ts` 先暴露出来。

## 用户约束

- 项目未上线。
- 只有单人开发。
- 开发数据不重要。
- 不允许向后兼容。
- 不做旧字段兼容层。
- 不保留 `fixed` 模式。
- 不保留 `configured_step_ticks` / `override_step_ticks` 旧快照字段。
- 目标是暴露并修掉真实问题，而不是用 `as unknown as` 压掉诊断。

## 已知受影响文件范围

根据现有搜索结果，旧结构至少出现在以下文件。

### Objective sidecar 相关测试

- `apps/server/tests/unit/objective_enforcement_sidecar_parity.spec.ts`
- `apps/server/tests/unit/objective_enforcement_sidecar_fallback_policy.spec.ts`
- `apps/server/tests/unit/objective_enforcement_sidecar_diagnostics.spec.ts`
- `apps/server/tests/unit/objective_enforcement_engine_sidecar.spec.ts`

这些测试中的 `PackRuntimeHost` mock 仍返回旧结构：

```ts
mode: 'fixed' as const,
configured_step_ticks: null,
override_step_ticks: null,
```

部分 mock 目前通过 `as unknown as PackRuntimeHost` 遮蔽。

### Projection / runtime 相关测试

- `apps/server/tests/integration/world_pack_projection_flow.spec.ts`
- `apps/server/tests/integration/world_engine_pack_host_api_read_surface.spec.ts`
- `apps/server/tests/unit/runtime/world_engine_snapshot.spec.ts`
- `apps/server/tests/unit/services/overview_projection.spec.ts`
- `apps/server/tests/unit/routes/clock_routes_projection.spec.ts`
- `apps/server/tests/unit/ai_tool_executor.spec.ts`

这些位置包含旧 `RuntimeSpeedSnapshot` 形状或旧断言结构。

### 可能仍有旧展示 DTO / CLI 类型

- `apps/server/src/cli/sim_cli.ts`

该文件中存在：

```ts
configured_step_ticks: string | null;
override_step_ticks: string | null;
```

需要判断这是独立 CLI 输出类型还是 RuntimeSpeedSnapshot 遗留投影。如果它表达的是运行时速度快照，则应迁移到当前 `RuntimeSpeedSnapshot` 形状；不做兼容字段。

### 当前正确模型参考点

- `apps/server/src/core/runtime_speed.ts`
- `apps/server/src/core/pack_runtime_stub.ts`
- `apps/server/tests/fixtures/app-context.ts`
- `apps/server/tests/unit/pack_runtime_registry.spec.ts`
- `apps/server/src/app/services/system/system.ts`

这些位置已经使用或接近当前结构：

```ts
{
  mode: 'variable',
  source: 'default',
  strategy: {
    kind: 'variable',
    range: { min: 1n, max: 1n },
    loopIntervalMs: 1000
  },
  effective_step_ticks: '1',
  override_since: null
}
```

## 目标状态

### RuntimeSpeedSnapshot 单一模型

全项目只允许使用当前模型：

```ts
{
  mode: 'variable' | 'adaptive',
  source: 'default' | 'world_pack' | 'override',
  strategy: StepStrategy,
  effective_step_ticks: string,
  override_since: number | null
}
```

### 删除旧模型

禁止继续出现：

```ts
mode: 'fixed'
configured_step_ticks
override_step_ticks
```

除非这些字段出现在历史文档、迁移说明或明确与 RuntimeSpeedSnapshot 无关的外部协议文本中。源码和测试 mock 中不保留。

### 减少强转遮蔽

涉及 runtime speed / pack runtime handle / pack runtime host 的测试 mock，优先使用：

```ts
satisfies PackRuntimeHandle
satisfies RuntimeSpeedSnapshot
```

对于 `PackRuntimeHost` 这种接口较大、测试只需要部分方法的场景，可以引入 typed fixture/helper，而不是在每个测试里散落 `as unknown as PackRuntimeHost`。

## 实施步骤

### 1. 建立统一测试 helper

新增或扩展测试 helper，例如：

`apps/server/tests/helpers/runtime_speed.ts`

提供：

```ts
export const createVariableRuntimeSpeedSnapshot = (
  overrides?: Partial<RuntimeSpeedSnapshot>
): RuntimeSpeedSnapshot => ({
  mode: 'variable',
  source: 'default',
  strategy: {
    kind: 'variable',
    range: { min: 1n, max: 1n },
    loopIntervalMs: 1000
  },
  effective_step_ticks: '1',
  override_since: null,
  ...overrides
});
```

注意：`strategy` 是嵌套对象，若允许覆盖 `strategy.range`，需要显式合并，不能让浅合并产生半结构对象。

可选再提供：

```ts
export const createPackRuntimeHandleMock(...): PackRuntimeHandle
export const createPackRuntimeHostMock(...): Pick<PackRuntimeHost, ...>
```

但不要过度抽象。优先先统一 RuntimeSpeedSnapshot。

### 2. 修复 `world_pack_projection_flow.spec.ts`

将所有旧 runtime speed mock 改为 helper 或当前结构。

当前旧点至少包括：

- `sim.getRuntimeSpeedSnapshot()` 附近
- `packRuntime.getRuntimeSpeedSnapshot()` 附近
- `getPackRuntimeHost(...).getRuntimeSpeedSnapshot()` 附近
- `getPackRuntimeHandle(...).getRuntimeSpeedSnapshot()` 附近

其中 `getPackRuntimeHandle` 已使用 `satisfies PackRuntimeHandle`，必须返回完整当前结构。

### 3. 修复 objective sidecar 测试

逐个替换：

- `objective_enforcement_sidecar_parity.spec.ts`
- `objective_enforcement_sidecar_fallback_policy.spec.ts`
- `objective_enforcement_sidecar_diagnostics.spec.ts`
- `objective_enforcement_engine_sidecar.spec.ts`

把旧结构：

```ts
mode: 'fixed' as const,
configured_step_ticks: null,
override_step_ticks: null,
```

替换为当前结构。

如果这些 mock 仍然整体 `as unknown as PackRuntimeHost`，至少让 `getRuntimeSpeedSnapshot` 的返回值显式 `satisfies RuntimeSpeedSnapshot`，避免旧模型再次混入。

### 4. 修复其他测试中的旧 runtime speed mock

逐个处理：

- `apps/server/tests/integration/world_engine_pack_host_api_read_surface.spec.ts`
- `apps/server/tests/unit/runtime/world_engine_snapshot.spec.ts`
- `apps/server/tests/unit/services/overview_projection.spec.ts`
- `apps/server/tests/unit/routes/clock_routes_projection.spec.ts`
- `apps/server/tests/unit/ai_tool_executor.spec.ts`

原则：

- 不把 `fixed` 改成 `variable as any`。
- 不用 `as unknown as RuntimeSpeedSnapshot` 遮蔽。
- 如果测试断言旧字段，需要改断言到当前字段。

### 5. 排查源码旧字段

重点检查：

- `apps/server/src/cli/sim_cli.ts`
- `apps/server/src/app/services/overview/overview.ts`
- `apps/server/src/app/services/runtime/experimental_runtime_control_plane_service.ts`
- `apps/server/src/app/services/system/system.ts`
- `apps/server/src/app/routes/experimental_runtime.ts`

处理规则：

- 如果字段属于 RuntimeSpeedSnapshot 输出，统一改为当前模型。
- 删除 `configured_step_ticks` / `override_step_ticks` 输出。
- 如果 API 测试依赖旧字段，改测试，不保留兼容。
- 如果前端或 CLI 消费旧字段，直接同步改消费方。

### 6. 全量搜索硬性收敛

实施后运行搜索，源码和测试中不应再出现：

```bash
rg "mode: 'fixed'|configured_step_ticks|override_step_ticks" apps/server/src apps/server/tests packages/contracts/src
```

预期：

- `mode: 'fixed'`：0 个源码/测试命中
- `configured_step_ticks`：0 个源码/测试命中，除非文档中刻意说明旧字段已删除
- `override_step_ticks`：0 个源码/测试命中，除非文档中刻意说明旧字段已删除

### 7. 类型验证

运行：

```bash
pnpm --filter yidhras-server typecheck
```

如果出现更多 `RuntimeSpeedSnapshot` 结构错误，不绕过，继续修真实结构。

### 8. 单元测试验证

运行：

```bash
pnpm --filter yidhras-server test:unit
```

关注点：

- runtime speed 相关测试
- overview projection 测试
- route clock projection 测试
- objective sidecar 测试
- AI tool executor 测试

### 9. 目标集成测试验证

运行：

```bash
pnpm exec vitest run --config vitest.integration.config.ts \
  tests/integration/world_pack_projection_flow.spec.ts \
  tests/integration/world_engine_pack_host_api_read_surface.spec.ts \
  tests/integration/workflow-engine.spec.ts \
  tests/integration/agent-scheduler.spec.ts \
  --reporter=verbose
```

如果 `world_engine_pack_host_api_read_surface` 暴露 API 输出字段断言旧结构，应直接迁移断言到当前结构，不做旧字段兼容。

### 10. Lint 验证

运行：

```bash
pnpm --filter yidhras-server lint
```

目标：0 errors。现有 warning 可记录但不作为本任务阻塞，除非本次新增。

## 风险与代价

### 1. API 输出会破坏旧消费者

因为用户明确要求不向后兼容，所以如果 runtime speed 输出从旧字段变为当前字段，旧前端/CLI/测试消费者会被破坏。这是预期结果，不应保留适配层。

### 2. 强转减少会暴露更多 mock 不完整问题

把 `as PackRuntimeHandle` 改成 `satisfies PackRuntimeHandle` 后，类似 `instance_id` / `metadata_id` / `strategy` 缺失的问题会继续浮出。这不是坏事，是之前被强转遮蔽的问题。

### 3. `PackRuntimeHost` 接口较大，全面 `satisfies PackRuntimeHost` 成本高

短期可只保证关键返回对象使用 `satisfies RuntimeSpeedSnapshot`。长期可以建立 `createMockPackRuntimeHost` helper，集中维护大接口 mock。

### 4. BigInt in StepStrategy

`strategy.range.min/max` 是 `bigint`。测试 helper、JSON 序列化路径和 API 输出路径需要注意。如果某条 HTTP/API 输出不能返回 BigInt，需要确认现有序列化逻辑是否已经处理 `strategy`。如果没有，这会暴露真实 API 设计问题：当前 `RuntimeSpeedSnapshot` 直接包含 BigInt 的 `StepStrategy`，可能不适合直接作为 JSON DTO 输出。

这点需要重点排查：

- 内部 `RuntimeSpeedSnapshot` 可以包含 `bigint`
- 外部 API DTO 不应直接泄露不可 JSON 序列化的 BigInt

如果发现 API route 直接返回 `RuntimeSpeedSnapshot.strategy.range.min/max`，应设计专门 DTO，将 bigint 转 string。由于不允许向后兼容，DTO 可直接改为新结构字符串化版本，而不是保留旧字段。

## 不做事项

- 不新增 `fixed` 到 `RuntimeSpeedSnapshot.mode`。
- 不把 `fixed` 映射为兼容别名。
- 不保留 `configured_step_ticks` / `override_step_ticks`。
- 不用 `as any` 或 `as unknown as RuntimeSpeedSnapshot` 压掉类型错误。
- 不做旧 API 字段兼容。

## TODO

- [ ] 建立统一 RuntimeSpeedSnapshot 测试 helper，表达当前 variable/adaptive + strategy 模型。
- [ ] 迁移 `world_pack_projection_flow` 中所有旧 fixed/configured_step_ticks/override_step_ticks mock。
- [ ] 迁移 objective sidecar 测试中的旧 runtime speed mock，并补充类型校验。
- [ ] 迁移其他 runtime/overview/clock/AI/tool 测试中的旧 runtime speed mock 和断言。
- [ ] 排查并清理源码/CLI/API 中旧 runtime speed 字段，不保留兼容输出。
- [ ] 运行搜索收敛、typecheck、unit、目标 integration、lint 验证。

## 验收标准

1. `rg "mode: 'fixed'|configured_step_ticks|override_step_ticks" apps/server/src apps/server/tests packages/contracts/src` 无有效命中。
2. `pnpm --filter yidhras-server typecheck` 通过。
3. `pnpm --filter yidhras-server test:unit` 通过。
4. 指定 integration 测试通过：
   - `world_pack_projection_flow.spec.ts`
   - `world_engine_pack_host_api_read_surface.spec.ts`
   - `workflow-engine.spec.ts`
   - `agent-scheduler.spec.ts`
5. `pnpm --filter yidhras-server lint` 0 errors。
6. 没有新增 `as any` / `as unknown as RuntimeSpeedSnapshot` 类型绕过。

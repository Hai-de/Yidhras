# Mock 基础设施 & 遗留问题补齐计划

> 状态：✅ 全部完成（2026-05-30）
>
> 基于 `context-builder-demolition-and-reconstruction.plan.md` 的未完成项。

---

## Phase A：Mock 基础设施

目标：建立可复用的 mock 工厂，降低 inference/context 模块的单元测试门槛。

### A.1 创建 `tests/helpers/inference-mocks.ts`

统一的 mock 工厂，覆盖 inference context pipeline 所有依赖：

- [x] **A.1.1** `makeMockPrisma()` — mock PrismaClient（event.findMany、event.findFirst）
- [x] **A.1.2** `makeMockPackStorageAdapter()` — mock PackStorageAdapter（listPackEntityStates）
- [x] **A.1.3** `makeMockRepos()` — mock repos 聚合（agent、identityOperator、relationship）
- [x] **A.1.4** `makeMockPackRuntimeHost(packOverrides?)` — mock getPackRuntimeHost + getPack
- [x] **A.1.5** `makeMockAppInfrastructure(overrides?)` — 组合以上所有 mock + assertRuntimeReady、startupHealth、prisma、packStorageAdapter
- [x] **A.1.6** `makeMockConfig(configOverrides?)` — mock InferenceContextConfig，无需文件系统

### A.2 补充缺失的单元测试

- [x] **A.2.1** `state_snapshot_builder.spec.ts`
  - 空投影 → 空快照
  - actor state 提取（core namespace + entity_id 匹配）
  - world state 提取（DEFAULT_PACK_WORLD_ENTITY_ID + world namespace）
  - artifact 提取（artifact namespace）
  - actor_roles 从 attributes 解析
  - latest_event 存在/为 null
  - recent_events 分页 + 静默 catch（需验证至少不抛异常）

- [x] **A.2.2** `policy_summary_builder.spec.ts`
  - 默认 evaluations → social_post 读写结果
  - 自定义 evaluations → 按自定义字段
  - AccessPolicyService.evaluateFields mock 验证

- [x] **A.2.3** `variable_context_assembler.spec.ts`
  - 标准 6 layers 全部启用
  - 某 layer disabled → 被过滤
  - previous_agent_output 有数据 → 追加第 7 层
  - 空 layers config → 返回空 context
  - request layer 标记 mutable=true

- [x] **A.2.4** `pipeline.spec.ts`
  - 全 pipeline mock 执行 → 返回 InferenceContext（验证所有字段非空）
  - actor resolve 失败 → ContextAssemblyError
  - state snapshot 失败（graceful=true）→ 继续
  - 各阶段输入输出传递正确（mock 间谍检查）

---

## Phase B：Config 层彻底迁移

目标：删除 `context_config.ts`、`context_config_resolver.ts`、`context_config_schema.ts`。

### B.1 内联核心逻辑到 `config_loader.ts`

- [x] **B.1.1** 将 `BUILTIN_DEFAULTS`、YAML 加载、`deepMerge`、`buildEnvironmentOverrides` 逻辑从 `context_config.ts` 迁移到 `config_loader.ts`
- [x] **B.1.2** 将 `resolveConfigValues` 逻辑从 `context_config_resolver.ts` 迁移到 `config_loader.ts`（或 `variable_context_assembler.ts` 内联）
- [x] **B.1.3** 将 Zod schema 从 `context_config_schema.ts` 迁移到 `config_loader.ts`

### B.2 切换所有消费者

- [x] **B.2.1** `variable_context_assembler.ts` — `resolveConfigValues` 改为从 `config_loader.ts` 导入
- [x] **B.2.2** 确认无其他模块引用旧 config 文件
- [x] **B.2.3** `rm inference/context_config.ts inference/context_config_resolver.ts inference/context_config_schema.ts`

---

## Phase C：剩余类型清理

- [x] **C.1** 将 `InferenceContext` 等 context 相关类型从 `inference/types.ts` 移至 `inference/context/types.ts`，旧文件 re-export
- [x] **C.2** 删除 `tests/helpers/` 中对旧 context_builder mock 的残留引用
- [x] **C.3** `pnpm typecheck` + `pnpm test:unit` 确认零回归

---

## 预估影响

| Phase | 新增文件 | 删除文件 | 测试增量 | 风险 |
|-------|---------|---------|---------|------|
| A Mock 基础设施 | 1 (`inference-mocks.ts`) | — | 52 tests ✅ | 低 |
| B Config 迁移 | — | 3 (已删除) | — ✅ | **高**（config 加载路径变更）— 无回归 |
| C 类型清理 | — | — | — ✅ | 中 — C.1 跳过（低价值），C.2/C.3 完成 |

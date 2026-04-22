<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/e2e-active-pack-assumption-cleanup-and-test-runtime-decentralization-design.md","contentHash":"sha256:a0a2b46d4aac4af9d3d5d7efd9889c6907076157744f5dd135fdaa24625f3023"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 为 helper 保留兼容模式，避免一次性打碎旧 e2e 启动假设  `#phase-a-compat-mode`
- [x] 扩展 tests/helpers/runtime.ts，支持显式 activePackRef 与 seededPackRefs  `#phase-a-helper-api`
- [x] 迁移第一批强依赖 active death_note 的 e2e 为显式 active-pack 模式  `#phase-b-scenario-e2e-migration`
- [x] 验证迁移后的 e2e 在显式 active-pack 模式下稳定通过  `#phase-c-validation`
- [ ] 整理第二批通用测试与命名技术债的后续迁移清单，并记录 trigger-event 场景仍混合依赖 trigger_event dispatch pending 与 semantic_intent 决策收敛假设  `#phase-d-followup-audit`
<!-- LIMCODE_TODO_LIST_END -->

# E2E Active-Pack 假设清理与测试运行时去中心化实施计划

## 来源设计

- 设计文档：`.limcode/design/e2e-active-pack-assumption-cleanup-and-test-runtime-decentralization-design.md`
- 本计划严格以该设计为依据。
- 本轮实施范围限定为：**helper API 去中心化 + 第一批强依赖 active death_note 的 e2e 显式化改造 + 回归验证**。
- 本轮明确不直接执行：全部 e2e 的统一迁移、全部 unit/integration fixture 的命名去中心化、核心 runtime startup 语义重构。

---

## 1. 目标

把测试体系中“death_note 默认就是 active pack”的隐式假设拆开，建立显式的测试运行时 pack 选择机制，让测试能够明确表达：

1. 当前 workspace 中 seed 了哪些 packs
2. 当前 server/runtime 的 active pack 是谁
3. 某个测试究竟是在验证通用框架，还是在验证 `death_note` 场景

完成后应达到：

- helper 能显式设置 `activePackRef` / `seededPackRefs`
- 第一批依赖 active `death_note` 的 e2e 不再依赖隐式默认行为
- `death_note` 仍然保留为场景测试 reference pack
- 后续再推进通用测试迁移到 `example_pack` 时，不需要重新设计 helper

---

## 2. 实施范围

## 本轮纳入范围

### helper / support
- `apps/server/tests/helpers/runtime.ts`

### 第一批场景型 e2e
- `apps/server/tests/e2e/world_pack_projection_endpoints.spec.ts`
- `apps/server/tests/e2e/trigger-event.spec.ts`
- `apps/server/tests/e2e/plugin-runtime-startup-gap.spec.ts`
- `apps/server/tests/e2e/plugin-runtime-web.spec.ts`
- `apps/server/tests/e2e/experimental-projection-compat.spec.ts`
- `apps/server/tests/e2e/experimental-runtime.spec.ts`

## 本轮排除范围

- 不一次性修改所有 e2e
- 不修改所有 `available_world_packs: ['world-death-note']` 之类 unit/integration fixture
- 不强行把所有测试迁到 `example_pack`
- 不改动 `death_note` 包本身语义
- 不重构核心 runtime startup 行为

---

## 3. 分阶段任务

## Phase A：helper API 去中心化

### 3.1 扩展 `createIsolatedRuntimeEnvironment`

目标：

- 让测试辅助环境能显式决定 seed 哪些 packs，而不是只种入 `death_note`。

建议动作：

1. 为 `CreateIsolatedRuntimeEnvironmentOptions` 增加：
   - `seededPackRefs?: string[]`
2. 将当前的单 pack seed 逻辑改为：
   - 可按 `seededPackRefs` 批量 seed
3. 默认策略需谨慎：
   - 可保留兼容默认 `['death_note']`
   - 或使用受控兼容模式，而不是直接切成 `['example_pack', 'death_note']`
4. 把 helper 中“模板路径”“目录名”“pack ref”的关系整理清楚。

验收标准：

- helper 层可以表达“有哪些 pack 存在”，且不再把它与 active pack 混为一谈。

### 3.2 为 `withIsolatedTestServer` 提供 `activePackRef`

目标：

- 让 e2e 以语义化方式声明 active pack，而不是手写环境变量覆盖。

建议动作：

1. 在 `IsolatedTestServerOptions` 中新增：
   - `activePackRef?: string`
   - `seededPackRefs?: string[]`
2. helper 内部负责将 `activePackRef` 映射到：
   - `WORLD_PACK=<packRef>`
3. 保留原有 `envOverrides` 合并逻辑，但不鼓励测试直接手写 `WORLD_PACK`。

验收标准：

- 测试代码可以明确写出“我需要 active death_note”，而不是依赖 helper 默认立场。

### 3.3 建立兼容模式

目标：

- 避免 helper 改动后一次性打碎现有测试。

建议动作：

1. 在 helper 内保持向后兼容：
   - 未传 `seededPackRefs` 时仍能工作
   - 未传 `activePackRef` 时行为可预测
2. 优先保证第一批迁移测试稳定，而不是一次性要求所有旧测试都理解新模型。

验收标准：

- helper API 改动不会立刻导致全量 e2e 雪崩。

---

## Phase B：第一批场景型 e2e 显式化

### 3.4 迁移强依赖 active death_note 的 e2e

目标：

- 把“场景测试依赖 death_note active pack”这件事写明白。

具体动作：

1. 对第一批 e2e 改为显式声明：
   - `activePackRef: 'death_note'`
2. 如测试还依赖多 pack 可用列表，则补：
   - `seededPackRefs: ['death_note']` 或 `['example_pack', 'death_note']`
3. 把 route 常量命名从模糊的：
   - `ACTIVE_PACK_ROUTE_NAME`
   - `PACK_ROUTE_NAME`
   改为更清晰的：
   - `DEATH_NOTE_ACTIVE_PACK_ID`
   - `DEATH_NOTE_PACK_REF`
   （若该文件确实是 death_note 场景测试）
4. 如某些测试只验证 active-pack guard 行为，则保留 death_note 作为场景 pack 是合理的，但必须显式。

验收标准：

- 第一批 e2e 不再依赖“默认 active pack 就是 death_note”的隐式约定。

---

## Phase C：回归验证

### 3.5 验证 helper 与第一批 e2e

目标：

- 确认显式 active-pack 模式下测试仍稳定通过。

建议动作：

1. 先运行 helper / unit 相关测试（若有）
2. 再运行第一批迁移后的 e2e
3. 若发现 `runtime_ready === false` 类问题，优先从 helper 选包语义与 seed 策略排查
4. 如确有必要，可为 helper 增加小范围调试输出，但最终保持实现干净

验收标准：

- 第一批 e2e 通过
- helper 行为与设计一致
- 不再需要依赖隐式 active death_note 默认值

---

## Phase D：后续迁移清单整理

### 3.6 汇总第二批待迁移测试

目标：

- 不在本轮完成全部迁移，但要清楚后面还有什么。

建议整理两类清单：

1. 通用框架测试候选：
   - `smoke-startup.spec.ts`
   - `overview-summary.spec.ts`
   - `scheduler-runtime-status.spec.ts`
   - `scheduler-queries.spec.ts`
   - `access-policy-contracts.spec.ts`
2. 命名技术债候选：
   - `available_world_packs: ['world-death-note']`
   - fixture 中 `pack_id: 'world-death-note'`
   - route/assertion 中把 `death_note` 当默认常量

验收标准：

- 本轮完成后，下一轮迁移不需要重新审题。

---

## 4. 验证要求

本轮至少完成以下验证：

1. helper API 行为验证
   - `seededPackRefs`
   - `activePackRef`
   - 兼容模式
2. 第一批 e2e 回归
3. 不引入新的 pack-specific 隐式假设
4. 如改动测试常量命名，确保语义更清晰而不是更混乱

---

## 5. 风险与缓解

## 风险 1：helper 新 API 与旧 envOverrides 冲突

缓解：

- 明确优先级
- helper 内统一合并逻辑
- 尽量避免让单个测试同时写 `activePackRef` 和原始 `WORLD_PACK`

## 风险 2：迁移第一批 e2e 时暴露更多历史假设

缓解：

- 先收口第一批
- 不把问题扩散到所有测试
- 发现额外问题则记录到 Phase D 清单

## 风险 3：example_pack 与 death_note 的角色再次混淆

缓解：

- 场景测试继续明确使用 `death_note`
- 通用测试候选再考虑迁到 `example_pack`
- 不在本轮混做两种迁移

---

## 6. 完成定义

本计划完成时应满足：

1. `tests/helpers/runtime.ts` 已支持显式 `activePackRef` / `seededPackRefs`。
2. 第一批强依赖 active death_note 的 e2e 已完成显式 active-pack 改造。
3. 这些 e2e 已通过回归验证。
4. 第二批通用测试与命名技术债已形成明确待办清单。

---

## 7. 建议执行顺序

1. 改 helper API
2. 做兼容模式
3. 迁移第一批场景型 e2e
4. 跑回归验证
5. 整理第二批候选清单

---

## 8. 执行备注

- 本计划创建后不直接实施代码修改。
- 等待用户确认并执行该计划后，再进入 helper 与 e2e 迁移实施阶段。

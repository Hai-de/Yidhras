# 提示词权限过滤 — 实施计划

> 来源: `.limcode/design/prompt-permission-filtering-gap-analysis.md`
> 创建: 2026-05-13
> 状态: ✅ 全部完成（Phase 0-3）
> 背景: 项目未上线，无重要数据，不要求向后兼容

---

## 执行摘要

**实际修改 14 个文件，0 个新建文件。** Phase 2（条件渲染）发现基础设施已完整存在，无需新增代码。

```
Phase 0 (接通管线) ──► Phase 1 (分层世界观 + capability) ──► Phase 3 (收尾)
                          │
                          └── Phase 2 (条件渲染) — 确认已有，跳过
```

---

## Phase 0 — 接通已有管线 ✅

### 改动

| 文件 | 变更 |
|---|---|
| `prompt_slots.default.yaml` | `system_policy`: 删除空 allowlist，只保留 `visible: true`；`world_context`: 添加 `permissions.visible: true` |
| `features.ts` | `prompt_slot_permissions: false` → `true` |
| `data/configw/default.yaml` | 同上 |

### 验证

```
pnpm typecheck  → 通过
pnpm test:unit  → 1014 passed, 1 skipped
```

---

## Phase 1 — 分层世界观 + capability 接入 ✅

### Step 1.1-1.2 — `template_key` 字段

| 文件 | 变更 |
|---|---|
| `prompt_slot_config.ts` | 添加 `template_key?: string \| null` |
| `template_track.ts` | `config.template_key ?? 'global_prefix'` 替代硬编码 |

### Step 1.3-1.4 — 槽位注册

| 文件 | 变更 |
|---|---|
| `prompt_slots.default.yaml` | 新增 `world_context_mastermind` 槽位（`template_key: "global_prefix_mastermind"`, `visible_to: ["capability:perceive.mastermind"]`）；`role_core` 改为 `template_context: world_prompts` + `template_key: "agent_persona"` |
| `registry.ts` (ai) | Zod schema 添加 `template_key` 字段 |

### Step 1.5 — snowbound_mansion config 重构

| 文件 | 变更 |
|---|---|
| `config.yaml` (snowbound) | 拆分 `global_prefix` → `global_prefix` + `global_prefix_mastermind`；`agent_persona` 使用 `{{#if actor.state.is_mastermind}}`；新增 `perceive.mastermind` capability；补全 4 个 authority grants；使用 `conditions_json` 条件授权 |

### Step 1.6 — `agent_capabilities` 字段

| 文件 | 变更 |
|---|---|
| `types.ts` (inference) | `InferenceContext` 添加 `agent_capabilities: string[]` |
| `context_builder.ts` | 引入 `resolveAuthorityForSubject` → 查询 authority → 填充 `agentCapabilities` → 传入 context service 和返回对象 |

### Step 1.7 — `capability:<key>` token

| 文件 | 变更 |
|---|---|
| `prompt_permissions.ts` | 新增 `CAPABILITY_TOKEN_PREFIX` / `expandCapabilityTokens()`；`PermissionCheckInput` 添加 `agent_capabilities`；`resolveSlotPermission` 调用 `expandCapabilityTokens`；`applyFragmentPermissions` 传入 `agent_capabilities` |

### Step 1.8-1.9 — 运行态 visibility 过滤

| 文件 | 变更 |
|---|---|
| `runtime_state.ts` | `buildRuntimeStateContextNodes` 添加 `agent_capabilities` 参数；`pack_world_state_snapshot` 按 `perceive.mastermind` 动态设置 `read_access` / `policy_gate` |
| `source_registry.ts` | `ContextSourceAdapterInput` 添加 `agent_capabilities`；传入 `runtime_state` adapter |
| `service.ts` (context) | `BuildContextRunInput` 添加 `agent_capabilities`；传入 `buildContextNodesFromSources` |

### Step 1.10 — 测试修复

| 文件 | 变更 |
|---|---|
| `context_module.spec.ts` | `runContextBuild` 添加 `agent_capabilities: ['perceive.mastermind']` |

### 验证

```
pnpm typecheck  → 通过
pnpm test:unit  → 1014 passed, 1 skipped
snowbound pack load → passes schema validation
```

---

## Phase 2 — 模板引擎条件渲染 ✅（无需修改）

### 发现

核心引擎（`template_engine/core/`）和叙事前端（`frontends/narrative/`）已有完整的 `{{#if}}` / `{{else}}` / `{{/if}}` 实现：

| 层 | 文件 | 已有实现 |
|---|---|---|
| 词法 | `core/lexer.ts` | `{{#` → `BLOCK_OPEN`, `{{/` → `BLOCK_CLOSE` |
| 语法 | `defaults.ts:18-22` | `keywords: ['if', 'each', 'with']`, `elseKeyword: 'else'` |
| 解析 | `core/parser.ts:471-548` | 完整 block 解析（嵌套 + else + 关闭关键字匹配） |
| 渲染 | `core/renderer.ts:97-114` | block handler 查找 → 调用 → 递归渲染 |
| 内置 handler | `defaults.ts:176-186` | `if` handler: resolve variable → truthy check → render body/elseBody |
| 叙事 handler | `frontends/narrative/blocks.ts:53-63` | `if` handler: resolve via narrative variable context → truthy check |
| 叙事 AST | `frontends/narrative/resolver.ts:133-151` | `case 'block'` → narrative handler dispatch |

### 验证

snowbound 的 `agent_persona` 使用 `{{#if actor.state.is_mastermind}}...{{else}}...{{/if}}` — pack schema validation 通过。

---

## Phase 3 — 收尾 ✅

### Step 3.1 — `fragment_assembly.ts` 确认

Q4 决议确认 slot config 为权威入口，`permissions: null` 行为正确。Context node 的 visibility 过滤在 policy engine 阶段（`evaluateContextPolicies`）已完成——被 `policy_gate: 'deny'` 的 node 不会进入 fragment assembly。无需改动。

### Step 3.2 — 端到端验证

```
pnpm typecheck  → 通过
pnpm test:unit  → 97 passed, 1 skipped, 1014 tests passed
pnpm lint       → 我修改的文件零 lint 错误，已有 lint 错误均在未修改文件中
```

---

## 全量文件变更汇总

| 文件 | Phase | 操作 |
|---|---|---|
| `apps/server/src/ai/schemas/prompt_slots.default.yaml` | 0/1 | 修改 |
| `apps/server/src/config/domains/features.ts` | 0 | 修改 |
| `data/configw/default.yaml` | 0 | 修改 |
| `apps/server/src/inference/prompt_slot_config.ts` | 1 | 修改 |
| `apps/server/src/context/workflow/tracks/template_track.ts` | 1 | 修改 |
| `apps/server/src/ai/registry.ts` | 1 | 修改 |
| `apps/server/src/inference/types.ts` | 1 | 修改 |
| `apps/server/src/inference/context_builder.ts` | 1 | 修改 |
| `apps/server/src/inference/prompt_permissions.ts` | 1 | 修改 |
| `apps/server/src/context/sources/runtime_state.ts` | 1 | 修改 |
| `apps/server/src/context/source_registry.ts` | 1 | 修改 |
| `apps/server/src/context/service.ts` | 1 | 修改 |
| `data/world_packs/snowbound_mansion/config.yaml` | 1/2 | 修改 |
| `apps/server/tests/unit/context_module.spec.ts` | 修复 | 修改 |

---

## 设计决策记录

### 防御深度：双槽位 + `{{#if}}`

`global_prefix`（公共世界观）和 `global_prefix_mastermind`（黑幕特权）采用双槽位方案，而非单一模板内用 `{{#if}}` 分支。理由：

- **Slot 权限是独立于模板的第二道防线：** 即使包作者写错 `{{#if}}` 条件或忘记写分支，slot 的 `capability:perceive.mastermind` 检查仍会拦截
- **`{{#if}}` 用于角色内差异：** 在 `agent_persona` 中用 `{{#if}}` 区分"黑幕目标"和"平民目标"——这种同一身份模板、不同角色目标的分支适合模板层
- **Slot 用于跨角色隔离：** `global_prefix` 级别的信息一旦泄露摧毁叙事，走 slot 权限更安全
- **Context node 走 visibility：** `pack_world_state_snapshot` 是系统注入的，不走模板，必须走 visibility/capability

### 权限权威来源

slot config 为权威入口（集中管理在 `prompt_slots.default.yaml`），context node visibility 为补充（仅在 slot config 未定义 permissions 时回退）。`fragment_assembly.ts` 的 `permissions: null` 行为正确——被 denied 的 context node 在 policy engine 阶段已过滤，不会进入 fragment assembly。

### 无需向后兼容

项目未上线，无重要数据。直接修改默认值（feature flag、slot config、schema），无需迁移脚本。

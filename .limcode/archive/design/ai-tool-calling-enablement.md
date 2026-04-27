# AI 网关 Tool Calling 启用设计

## 概述

AI 网关模块（`ai/`）的 Tool Calling 底层基础设施已完备。本文档记录三阶段设计及实施结果。

**实施日期**：2026-04-28
**实施状态**：Phase 1–3 全部完成，165 个单元测试通过。

---

## 前置审计

### 实施前已就绪的底层能力

| 层次 | 文件 | 内容 |
|------|------|------|
| 类型 | `ai/types.ts` | `AiToolSpec`、`AiToolPolicy`、`AiResponseMode.tool_call`、`finish_reason.tool_call`、`ModelGatewayResponse.output.tool_calls[]`、`AiRouteConstraints.require_tool_calling`、`AiModelCapabilities.tool_calling`、`AiMessageRole` 含 `'tool'` |
| Gateway | `ai/gateway.ts` | `ModelGatewayRequest.tools?: AiToolSpec[]`、`ModelGatewayRequest.tool_policy?: AiToolPolicy` |
| OpenAI 适配器 | `ai/providers/openai.ts` | `buildOpenAiTools()`、`buildResponsesToolChoice()`、`extractResponsesToolCalls()`、`normalizeChatCompletionsResponse()` |
| 输出解码 | `ai/task_decoder.ts` | `case 'tool_call'` → 返回 `tool_calls[]` |
| 注册表 | `ai/registry.ts` | 内置模型已有 `tool_calling: true`（gpt-4.1-mini, gpt-4.1） |
| Contracts | `packages/contracts/src/inference.ts` | `inferenceStrategySchema` 已含 `'model_routed'` |

### 实施前唯一断点

`task_service.ts:70-71`：`tools: []` 和 `tool_policy: { mode: 'disabled' }` 硬编码。

---

## Phase 1：打通管道（已完成）

**目标**：数据可从请求层透传至网关层，注册表驱动工具定义，配置链支持覆盖。

### P1.1 — AiTaskRequest 透传 tools/tool_policy

`ai/types.ts`：`AiTaskRequest` 增加 `tools?: AiToolSpec[]`、`tool_policy?: AiToolPolicy | null`。
`ai/task_service.ts`：`buildGatewayRequest()` 从 `request.tools ?? []` / `request.tool_policy ?? { mode: 'disabled' }` 读取。

测试：`tests/unit/ai_task_service.spec.ts`（7 tests）

### P1.2 — Tool Executor 基础实现

新增 `ai/tool_executor.ts`：
- `ToolExecutionContext` — AppContext + pack_id + agent_role + capabilities + tool_sandbox
- `ToolHandler` — `execute(args, ctx) → Promise<unknown>`
- `ToolRegistry` — `register(name, handler, schema?)` / `execute(name, args, ctx) → ToolExecutionResult` / `has(name)` / `listNames()`
- `validateToolArgs(schema, args)` — JSON Schema 校验，复用 `validateSchemaNode` 逻辑
- `createToolRegistry(toolEntries?, permissionPolicies?)` — 工厂函数，自动从 toolEntries 装配 schema 和 sandbox

5 个系统内置工具：`query_memory_blocks`、`get_entity`、`list_active_agents`、`get_relationship`、`get_clock_state`。所有工具通过 `AppContext`（prisma/clock/activePackRuntime）直接访问数据，未创建外部 service 包装函数。

测试：`tests/unit/ai_tool_executor.spec.ts`（40 tests）

### P1.3 — 注册表增加 tools 段

`ai/types.ts`：新增 `AiToolRegistryEntry`（tool_id、name、description、input_schema、strict、kind、pack_id、enabled、sandbox、metadata）。`AiRegistryConfig` 增加 `tools?: AiToolRegistryEntry[]`。

`ai/registry.ts`：
- Zod schema 含 `aiToolRegistryEntrySchema`
- `BUILTIN_AI_TOOLS` 常量（5 个系统工具，含完整 input_schema）
- `mergeToolEntries()` 合并逻辑
- 查询 API：`listAiToolEntries()`、`getAiToolEntry()`、`findAiToolEntryByName()`、`resolveToolsFromRegistry()`、`resolveToolSpecsFromRegistry()`
- `loadAiRegistryConfig()` 自动合并 builtin tools

测试：`tests/unit/ai_registry.spec.ts`（37 tests）

### P1.4 — gateway_backed 兼容处理

**无代码变更**。Phase 1 不触发 tool_call 模式，`gateway_backed.ts` 维持 `agent_decision` + `json_schema` 路径。`ProviderDecisionRaw`（全字段 `unknown`）为 Phase 2 预留空间。透传验证已在 P1.1 测试中覆盖。

### P1.5 — 配置链 tools 字段

`AiTaskDefinition` 增加 `default_tools?: string[]`、`default_tool_policy?: AiToolPolicy`。
`AiTaskOverride` 增加 `tools?: string[]`、`tool_policy?: AiToolPolicy`。
`AiResolvedTaskConfig` 增加 `tools: string[]`、`tool_policy: AiToolPolicy`。
`resolveAiTaskConfig()` 合并链路：`inline override → pack override → definition default → []` / `{ mode: 'disabled' }`。

测试：`tests/unit/ai_task_definitions.spec.ts`（8 tests）

### P1.6 — 安全白名单

- `input_schema` 校验：已在 P1.3 的 `ToolRegistry.execute()` 中集成（`TOOL_ARGS_INVALID` 错误码）
- Route 约束：`AiRouteConstraints` 增加 `allow_tool_calling?: boolean`、`allowed_tool_ids?: string[]`
- `default.agent_decision` 路由设置 `allow_tool_calling: true`，其余路由默认不启用

---

## Phase 2：注册表驱动 + Tool Loop（已完成）

**目标**：工具选择从请求级裸传迁移至注册表+配置链，引入 ToolLoopRunner，建立权限模型。

### P2.1 — 配置驱动工具选择

`task_service.ts` 的 `buildGatewayRequest()` 改为优先从 `taskConfig.tools` 读取（经 `resolveToolSpecsFromRegistry()` 转换 `tool_id[]` → `AiToolSpec[]`），`request.tools` 保留为 fallback。`AiTaskRequest.tools/tool_policy` 未删除，降级为 fallback 字段。

### P2.2 — ToolLoopRunner

新增 `ai/tool_loop_runner.ts`：
- `ToolLoopConfig` — `max_rounds`、`total_timeout_ms`、`per_tool_timeout_ms`、`termination_tools: string[]`、`termination_finish_reasons: string[]`、`fallback_on_exhaustion: 'return_last' | 'error'`
- `ToolLoopRunner.run(gateway, input, executor, ctx, options?)` — 接受 `ModelGatewayExecutionInput`（含 request + task_request + task_config），执行多轮 loop
- Loop 流程：gateway 请求 → 检查响应 mode → 执行 tools → 组装 `role: 'tool'` 消息 → 拼接到 messages → 下一轮（最多 max_rounds 轮）
- 超时处理：total_timeout_ms 总超时 + per_tool_timeout_ms 单工具超时
- 终止条件：termination_tools 匹配 / termination_finish_reasons 匹配
- 耗尽策略：return_last（返回最后一轮响应）或 error（返回失败）

测试：`tests/unit/ai_tool_loop_runner.spec.ts`（13 tests）

### P2.3 — Tool 权限模型

新增 `ai/tool_permissions.ts`：
- `ToolPermissionPolicy` — `tool_id`、`allowed_roles`、`allowed_pack_ids?`、`require_capability?`、`rate_limit?`
- `checkToolPermission(policy, input)` — 单项权限检查
- `resolveToolPermissions(policies, toolId, input)` — 批量查找+检查

集成到 `ToolRegistry.execute()`：查找 tool → sandbox 检查 → permission 检查 → schema 校验 → 执行 handler。权限检查在 schema 校验之前执行。无匹配策略的工具默认允许。

测试：`tests/unit/ai_tool_permissions.spec.ts`（9 tests）

---

## Phase 3：动态工具 + 可观测 + 跨 Agent（已完成）

### P3.1 — 运行时动态工具 + Sandbox

`AiToolRegistryEntry` 增加 `sandbox?: AiToolSandboxLevel`（`'strict'` | `'readonly_world'` | `'mutation'`）。
`ToolExecutionContext` 增加 `tool_sandbox?: AiToolSandboxLevel`。
`ToolRegistry.execute()` 在权限检查前执行 sandbox 约束：工具所需 sandbox 级别 > 上下文允许级别 → `TOOL_SANDBOX_DENIED`。
`registerPackTools(registry, toolEntries, handlers)` — 批量注册 pack 声明的动态工具。

sandbox 级别排序：`strict(0) < readonly_world(1) < mutation(2)`。

### P3.2 — Loop 策略可配置 + 可观测

`ToolLoopConfig` 完整配置（见 P2.2）。
`AiInvocationTrace` 增加 `tool_loop?: AiToolLoopTrace`：
```typescript
interface AiToolLoopTrace {
  rounds: Array<{
    round: number;
    tool_calls: Array<{ name: string; latency_ms: number; success: boolean }>;
    total_latency_ms: number;
  }>;
  total_rounds: number;
  exhausted: boolean;
}
```
ToolLoopRunner 每轮收集 tool call 延迟和成功/失败状态，附加到响应的 `trace.tool_loop`。

### P3.3 — 跨 Agent 工具协作（同步）

新增 `ai/cross_agent_tool.ts`：
- `CrossAgentQuery` — 跨 Agent 查询结构（target_agent_id、task_type、query、timeout_ms）
- `CrossAgentBridge` — `queryAgent(query, ctx) → Promise<CrossAgentResult>`
- `createCrossAgentBridge(aiTaskService)` — 通过 `AiTaskService.runTask()` 发起同步跨 Agent 推理
- `createCrossAgentToolHandler(bridge)` — 生成 `query_agent` 工具的 handler
- `registerCrossAgentTool(registry, bridge)` — 注册 `query_agent` 工具（含 input_schema）

Phase 3 初期限制为同步协作（双方同 tick 在线）。ToolLoopRunner 已原生支持异步等待工具结果。

测试：`tests/unit/ai_cross_agent_tool.spec.ts`（5 tests）

---

## 实施产物清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `ai/types.ts` | 修改 | `AiTaskRequest.tools/tool_policy`、`AiToolRegistryEntry`、`AiToolSandboxLevel`、`AiTaskDefinition.default_tools/default_tool_policy`、`AiTaskOverride.tools/tool_policy`、`AiResolvedTaskConfig.tools/tool_policy`、`AiRouteConstraints.allow_tool_calling/allowed_tool_ids`、`AiToolLoopTrace` |
| `ai/task_service.ts` | 修改 | 透传 → 配置优先 + `resolveToolSpecsFromRegistry()` |
| `ai/task_definitions.ts` | 修改 | tools/tool_policy 配置链合并 |
| `ai/registry.ts` | 修改 | `BUILTIN_AI_TOOLS`、merge、`resolveToolSpecsFromRegistry()`、查询 API |
| `ai/tool_executor.ts` | **新增** | Tool 注册/执行/schema 校验/sandbox/权限、`registerPackTools()` |
| `ai/tool_loop_runner.ts` | **新增** | 多轮 tool call loop、超时/终止/耗尽策略、trace 收集 |
| `ai/tool_permissions.ts` | **新增** | 角色/包/能力权限策略模型 |
| `ai/cross_agent_tool.ts` | **新增** | 跨 Agent 同步查询 bridge + query_agent 工具 |

### 测试文件

| 文件 | 测试数 |
|------|--------|
| `tests/unit/ai_task_service.spec.ts` | 12 |
| `tests/unit/ai_tool_executor.spec.ts` | 40 |
| `tests/unit/ai_registry.spec.ts` | 37 |
| `tests/unit/ai_task_definitions.spec.ts` | 8 |
| `tests/unit/ai_tool_loop_runner.spec.ts` | 13 |
| `tests/unit/ai_tool_permissions.spec.ts` | 9 |
| `tests/unit/ai_cross_agent_tool.spec.ts` | 5 |
| `tests/unit/ai_task_decoder.spec.ts` | 27 (pre-existing) |
| `tests/unit/ai_observability.spec.ts` | 14 (pre-existing) |
| **合计** | **165** |

---

## 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Tool 透传方式 | `AiTaskRequest` 临时字段 → P2 配置优先，request 降级为 fallback | 最小改动快速打通，然后迁移 |
| Tool 选择归属 | 注册表+配置链决定 | 安全可控 |
| Loop 位置 | ToolLoopRunner 独立模块 | 复用性强，可测试 |
| Tool Executor | 独立 `tool_executor.ts`，handler map 注册 | 最小可用的执行抽象 |
| gateway_backed 契约 | Phase 1 不触发 tool_call | 避免 P1 范围膨胀 |
| 系统工具实现 | 通过 AppContext (prisma/clock) 直接访问 | 无需额外包装层，Phase 1 最小化 |
| Sandbox 模型 | executor 内联 enforcement | 与权限检查统一入口 |
| 跨 Agent 协作 | Phase 3 同步模式 | ToolLoopRunner 原生支持异步等待 |

---

## 盲点状态

| # | 盲点 | 状态 |
|---|------|------|
| B1 | Tool Executor 缺失 | ✅ P1.2 已实现 |
| B2 | gateway_backed 响应契约断裂 | ✅ 已决策 Phase 1 不触发，Phase 2 预留 |
| B3 | AiTaskDefinition 无 tools 字段 | ✅ P1.5 已补齐 |
| B4 | 注册表缺 tools 段 | ✅ P1.3 已补齐 |
| B5 | Observability 对 tool loop 的支持 | ✅ P3.2 已实现 `AiToolLoopTrace` |
| B6 | Phase 1/2 工具选择逻辑重叠 | ✅ P2.1 已迁移（配置优先，request fallback） |
| B7 | `model_routed` contract 缺口 | ✅ 实施前已存在 |
| B8 | task_type 白名单 | ✅ P1.6 `allow_tool_calling` 已实现 |
| B9 | 单 tool 执行超时 | ✅ P3.2 `per_tool_timeout_ms` 已实现 |
| B10 | `allow_tool_calling` vs `require_tool_calling` 语义 | ✅ 已区分（模型能力 vs 路由策略） |
| B11 | 系统工具依赖函数不存在 | ✅ 改为通过 AppContext 直接访问 |

---

## 风险回顾

| 风险 | 实际处理 |
|------|---------|
| Tool Executor 与 service 层耦合 | 通过 AppContext 注入，handlers 访问 prisma/clock/activePackRuntime，未直接 import service 模块 |
| gateway_backed 契约断裂 | Phase 1 不触发 tool_call，风险解除 |
| Tool Loop token/cost 消耗 | `max_rounds` + `total_timeout_ms` + `per_tool_timeout_ms` 三重限制 |
| Pack 工具与系统工具命名冲突 | `tool_id` 命名约定：`sys.*` vs `pack.<pack_id>.*` |

---

## 未包含（非本设计范围）

- Streaming/SSE 支持
- 熔断器/速率限制/指数退避（gateway 已有）
- 注册表 File Watcher 热加载
- tool_permissions 的 rate_limit 实际执行（类型已定义，未接入 tick 计数器）
- gateway_backed.ts 集成 ToolLoopRunner（Phase 2 设计预留，待实际需要时接入）
- 三层 AI 目录重构（独立设计文档）

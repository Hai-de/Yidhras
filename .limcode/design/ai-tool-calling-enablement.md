# AI 网关 Tool Calling 启用设计

## 概述

AI 网关模块（`ai/`）的 Tool Calling **底层基础设施已几乎完备**：类型系统（`AiToolSpec`、`AiToolPolicy`、`AiResponseMode.tool_call`）、OpenAI adapter（Responses/Chat Completions 两种端点的 tool 构建与解析）、路由约束（`require_tool_calling`）、模型能力（`tool_calling: boolean`）、输出解码（`decodeAiTaskOutput → case 'tool_call'`）均已就绪。

**唯一断点**在 `task_service.ts:70-71`：

```typescript
tools: [],                          // 硬编码空数组
tool_policy: { mode: 'disabled' },  // 硬编码禁用
```

本文档规划如何分三阶段打通此断点并构建完整的 Tool Calling 能力。

---

## 前置审计

### 已就绪的底层能力

| 层次 | 文件 | 内容 |
|------|------|------|
| 类型 | `ai/types.ts` | `AiToolSpec`、`AiToolPolicy`、`AiResponseMode.tool_call`、`finish_reason.tool_call`、`ModelGatewayResponse.output.tool_calls[]`、`AiRouteConstraints.require_tool_calling`、`AiModelCapabilities.tool_calling` |
| Gateway | `ai/gateway.ts` | `ModelGatewayRequest.tools?: AiToolSpec[]`、`ModelGatewayRequest.tool_policy?: AiToolPolicy` |
| OpenAI 适配器 | `ai/providers/openai.ts` | `buildOpenAiTools()`、`buildResponsesToolChoice()`、`extractResponsesToolCalls()`（Responses API）、`normalizeChatCompletionsResponse()`（Chat Completions API tool_calls 解析）、`buildResponsesRequestBody()` / `buildChatCompletionsRequestBody()`（tool_choice 逻辑） |
| 输出解码 | `ai/task_decoder.ts` | `case 'tool_call'` → 返回 `tool_calls[]` |
| 注册表 | `ai/registry.ts` | 内置模型已有 `tool_calling: true`（gpt-4.1-mini, gpt-4.1） |
| 路由约束 | `ai/types.ts` + `ai/registry.ts` | `AiRouteConstraints.require_tool_calling` 已在 schema 支持 |

### 当前缺失的关键组件

| 组件 | 说明 |
|------|------|
| **Tool Executor** | 不存在 — 工具定义后由谁执行、如何注册 handler、结果如何格式化均未实现 |
| **Tool 注册表段** | `AiRegistryConfig` = `{ providers, models, routes }`，无 `tools` |
| **配置链 tools 字段** | `AiTaskDefinition`、`AiTaskOverride`、`AiResolvedTaskConfig` 均无 tools 相关字段 |
| **gateway_backed 响应契约** | `InferenceProvider.run()` 返回 `ProviderDecisionRaw`，与 `tool_calls[]` 不兼容 |
| **Tool Loop** | 不存在 — tool_call 多轮交互循环未实现 |
| **Tool 权限模型** | 不存在 — Agent 角色与工具访问控制无关联 |
| **Observability for tool rounds** | `AiInvocationTrace` 不追踪 tool call roundtrip |

---

## Phase 1：打通管道（最小可用）

### 目标

单次 tool_call 可被 LLM 返回并经 `gateway_backed` 处理，配合系统内置工具 + Pack 配置声明的静态工具集。

### P1.1 — `AiTaskRequest` 增加 tools + tool_policy 透传（Q2-方案A）

**文件**：`ai/types.ts`

```typescript
// AiTaskRequest 增加字段：
export interface AiTaskRequest {
  // ... existing
  tools?: AiToolSpec[];           // 新增
  tool_policy?: AiToolPolicy | null; // 新增
}
```

**文件**：`ai/task_service.ts`

`buildGatewayRequest()` 改为从 request 读取（不再硬编码空数组）：

```typescript
tools: request.tools ?? [],
tool_policy: request.tool_policy ?? { mode: 'disabled' },
```

### P1.2 — Tool Executor 基础实现（B1 补充）

**关键盲点**：没有 Tool Executor，Phase 1 不可用。

**新增文件**：`ai/tool_executor.ts`

```typescript
export interface ToolExecutionContext {
  context: AppContext;
  pack_id?: string | null;
}

export interface ToolHandler {
  execute(args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown>;
}

export interface ToolRegistry {
  register(name: string, handler: ToolHandler): void;
  execute(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<unknown>;
  has(name: string): boolean;
}
```

**系统内置工具（首批）**：

| 工具名 | 功能 | 参数 | 实现依赖 |
|--------|------|------|---------|
| `query_memory_blocks` | 查询记忆块 | `pack_id`, `query_text?`, `limit?` | `memory/blocks/store.ts` |
| `get_entity` | 获取实体 | `pack_id`, `entity_id` | `packs/storage/entity_repo.ts` |
| `list_active_agents` | 列出活跃 Agent | `pack_id` | `app/runtime/agent_scheduler.ts` |
| `get_relationship` | 获取关系 | `source_id`, `target_id` | `app/services/relational/queries.ts` |
| `get_clock_state` | 获取时钟状态 | — | `clock/engine.ts` 通过 `context.sim` |

**执行结果格式**：
```typescript
interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}
```

### P1.3 — 注册表增加 tools 段（B4 补充）

**文件**：`ai/types.ts` — 新增类型

```typescript
export interface AiToolRegistryEntry {
  tool_id: string;              // 全局唯一 ID
  name: string;                 // LLM 可见函数名
  description: string;
  input_schema: Record<string, unknown>;
  strict?: boolean;
  kind: 'system' | 'pack';     // 区分来源
  pack_id?: string | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}
```

`AiRegistryConfig` 增加：
```typescript
tools?: AiToolRegistryEntry[];
```

**文件**：`ai/registry.ts` — 增加 Zod schema + 合并逻辑 + 查询 API

```typescript
// 内置系统工具默认注册
const BUILTIN_AI_TOOLS: AiToolRegistryEntry[] = [
  {
    tool_id: 'sys.query_memory_blocks',
    name: 'query_memory_blocks',
    description: 'Query memory blocks for a pack by text or filter',
    input_schema: { /* ... */ },
    kind: 'system',
    enabled: true,
  },
  // ... 其余系统工具
];
```

### P1.4 — 修复 gateway_backed 契约断裂（B2 补充）

**文件**：`ai/providers/gateway_backed.ts`（注：B4 已从 `inference/providers/` 移入）

**问题**：`aiTaskService.runTask()` 返回 `AiTaskResult`，其 `output` 在 `tool_call` 模式下是 `tool_calls[]`，但 `InferenceProvider.run()` 要求返回 `ProviderDecisionRaw`。

**策略**：Phase 1 采用**区分路由**方式 — 为 tool-calling 场景新增独立策略 `model_routed_tool`，与纯结构化输出的 `model_routed` 分离：

```typescript
// gateway_backed.ts
strategies: ['model_routed', 'model_routed_tool'],

async run(context, prompt) {
  const request = await buildAiTaskRequestFromInferenceContextV2(context, {
    task_type: 'agent_decision',
    tools: context.pack_tools ?? [],              // 来自 pack 配置
    tool_policy: { mode: 'allowed' },
  });
  const result = await aiTaskService.runTask(request, { packAiConfig: context.world_ai });
  
  // 如果是 tool_call，执行 tools 并再发起一轮（简化版 loop）
  if (result.invocation.output.mode === 'tool_call') {
    // Phase 1：直接返回 tool_calls 作为 meta，让上层感知
    // 完整 loop 留给 Phase 2
    return {
      action_type: 'tool_call',
      payload: { tool_calls: result.output },
      meta: { ai_invocation_id: result.invocation.invocation_id },
    };
  }
  return result.output as ProviderDecisionRaw;
}
```

> **决策点**：这要求 `ProviderDecisionRaw` 支持 `action_type: 'tool_call'` 并通过 `invocation_dispatcher` 被正确处理。如不可行，则 Phase 1 仅做 `agent_decision` 非 tool 模式，tool 功能入口在 Phase 2 一并解决。

### P1.5 — `AiTaskDefinition` 增加 tools 字段（B3 补充）

**文件**：`ai/types.ts`

```typescript
export interface AiTaskDefinition {
  // ... existing
  default_tools?: string[];           // 引用 tool_id 列表
  default_tool_policy?: AiToolPolicy;
}

export interface AiTaskOverride {
  // ... existing
  tools?: string[];                   // 覆盖工具列表
  tool_policy?: AiToolPolicy;
}
```

**文件**：`ai/task_definitions.ts` — `resolveAiTaskConfig()` 合并逻辑

```typescript
// resolved 增加：
tools: mergedOverride?.tools ?? definition.default_tools ?? [],
tool_policy: mergedOverride?.tool_policy ?? definition.default_tool_policy ?? { mode: 'disabled' },
```

### P1.6 — 安全：input_schema 校验 + task_type 白名单

**input_schema 校验**：`tool_executor.ts` 在 execute 前执行

```typescript
const validateToolArgs = (schema: Record<string, unknown>, args: Record<string, unknown>): string[] => {
  // 复用 task_decoder.ts 中已有的 validateSchemaNode 逻辑
};
```

**task_type 白名单**：在 `AiRoutePolicy.constraints` 扩展

```typescript
// ai/types.ts - AiRouteConstraints 增加：
allow_tool_calling?: boolean;  // 默认 false
allowed_tool_ids?: string[];   // 可选细粒度控制
```

Phase 1 默认仅 `agent_decision` 的 route 启用 `allow_tool_calling: true`。

### Phase 1 产物清单

| 产物 | 类型 | 说明 |
|------|------|------|
| `ai/tool_executor.ts` | 新增 | Tool 注册 + 执行 + 校验 |
| `ai/types.ts` | 修改 | `AiTaskRequest.tools/tool_policy`、`AiToolRegistryEntry`、`AiTaskDefinition.default_tools/default_tool_policy`、`AiTaskOverride.tools/tool_policy`、`AiRouteConstraints.allow_tool_calling` |
| `ai/task_service.ts` | 修改 | 透传 tools/tool_policy |
| `ai/task_definitions.ts` | 修改 | `resolveAiTaskConfig` 合并 tools 配置 |
| `ai/registry.ts` | 修改 | `AiRegistryConfig.tools`、schema、merge、BUILTIN_AI_TOOLS |
| `ai/providers/gateway_backed.ts` | 修改 | 处理 tool_call 响应 |

---

## Phase 2：注册表驱动 + Tool Loop

### 目标

工具选择由注册表/配置在服务端决定（移除请求级裸传），引入标准 ToolLoopRunner，建立 Agent 角色关联的权限模型。

### P2.1 — 工具选择从请求级移至注册表+配置（Q2-B/C）

**文件**：`ai/types.ts` — 移除 `AiTaskRequest.tools/tool_policy`（或标记 deprecated）

工具选择链路变为：
```
AiTaskDefinition.default_tools
  → AiPackConfig.tasks[task_type].tools（pack 覆盖）
    → AiTaskOverride.tools（内联覆盖）
      → resolveAiTaskConfig() 最终决议
```

**文件**：`ai/task_service.ts` — `buildGatewayRequest()` 改为从 `taskConfig` 读取：

```typescript
tools: resolveToolsFromRegistry(taskConfig.tools),  // tool_id[] → AiToolSpec[]
tool_policy: taskConfig.tool_policy,
```

其中 `resolveToolsFromRegistry()` 从 `AiRegistryConfig.tools` 查找匹配 `tool_id` 的条目并转为 `AiToolSpec`。

### P2.2 — ToolLoopRunner（Q3-B）

**新增文件**：`ai/tool_loop_runner.ts`

```typescript
export interface ToolLoopOptions {
  max_rounds: number;             // 默认 5
  timeout_ms: number;             // 默认 60000
  termination_tool?: string;      // 调用此工具后终止 loop（如 'finalize_decision'）
}

export interface ToolLoopRunner {
  run(
    gateway: ModelGateway,
    initialRequest: ModelGatewayRequest,
    executor: ToolExecutor,
    options: ToolLoopOptions,
  ): Promise<ModelGatewayResponse>;
}
```

**Loop 流程**：
```
1. gateway.execute(request) → response
2. if response.output.mode !== 'tool_call' → return response（终止）
3. for each tool_call in response.output.tool_calls:
     executor.execute(name, args) → result
4. 将 tool results 组装为 AiMessage(role='tool')
5. 拼接到 messages 末尾，构建新的 ModelGatewayRequest
6. goto 1（最多 max_rounds 轮）
```

**Tool result 消息格式**（B2 细节）：
```typescript
// AiMessage 中 tool result 的表示（已有 role: 'tool'）
const toolResultMessage: AiMessage = {
  role: 'tool',
  parts: [{ type: 'text', text: JSON.stringify(result) }],
  name: tool_name,       // 对应 tool call 的 name
  metadata: { call_id }, // 对应 tool call 的 call_id
};
```

### P2.3 — Tool 权限模型（Q4-1）

**新增文件**：`ai/tool_permissions.ts`

```typescript
export interface ToolPermissionPolicy {
  tool_id: string;
  allowed_roles: string[];         // 允许的 Agent 角色
  allowed_pack_ids?: string[];     // 限制的 pack
  require_capability?: string;     // 需要的 capability（如 'invoke.memory_query'）
  rate_limit?: { max_per_tick: number; cooldown_ticks: number };
}
```

权限检查在 `tool_executor.ts` 的 `execute()` 入口：

```typescript
execute(name, args, ctx) {
  // 1. 查找 tool registry entry
  // 2. 校验 input_schema
  // 3. 校验 tool_permission_policy（agent_role, pack_id, capability）
  // 4. 执行 handler
  // 5. 记录执行审计
}
```

### Phase 2 产物清单

| 产物 | 类型 | 说明 |
|------|------|------|
| `ai/tool_loop_runner.ts` | 新增 | 标准 Tool Loop 执行器 |
| `ai/tool_permissions.ts` | 新增 | Tool 权限策略模型 |
| `ai/tool_executor.ts` | 修改 | 集成权限检查 + 审计 |
| `ai/task_service.ts` | 修改 | 集成 ToolLoopRunner（可选） |
| `ai/types.ts` | 修改 | 移除 `AiTaskRequest.tools` 裸传、增加权限类型 |
| `ai/providers/gateway_backed.ts` | 修改 | 使用 ToolLoopRunner 驱动多轮 |

---

## Phase 3：动态工具 + 跨 Agent 协作

### 目标

支持有限的运行时动态工具（sandbox 执行），loop 策略可配置化并接入可观测性，支持跨 Agent 工具协作。

### P3.1 — 运行时动态工具（Q1-C）

**新增/扩展**：允许 Pack 在 `bootstrap` 或 `rules` 中声明动态工具，在 runtime activation 时注册。

```yaml
# world-pack config.yaml
tools:
  - tool_id: death_note.check_ownership
    name: check_notebook_ownership
    description: Check current Death Note ownership status
    input_schema:
      type: object
      properties: {}
    kind: pack
    sandbox: strict  # strict: 仅读取 pack state + kernel projection
```

**Sandbox 执行约束**：
- `strict`：仅允许读 pack-local entity state + kernel projection
- `readonly_world`：可读跨 pack entity（通过 projection bridge）
- `mutation`：可写 pack-local entity state（需 capability）

### P3.2 — Loop 策略可配置 + 可观测

**文件**：`ai/tool_loop_runner.ts` — 增强

```typescript
export interface ToolLoopConfig {
  max_rounds: number;              // 最大轮数
  total_timeout_ms: number;        // 总超时
  per_tool_timeout_ms: number;     // 单个 tool 执行超时（B9）
  termination_tools: string[];     // 终止工具列表
  termination_finish_reasons: string[]; // 'stop', 'tool_call', etc.
  fallback_on_exhaustion: 'return_last' | 'error';
}
```

**可观测**：`AiInvocationTrace` 扩展

```typescript
interface AiInvocationTrace {
  // ... existing
  tool_loop?: {
    rounds: Array<{
      round: number;
      tool_calls: Array<{ name: string; latency_ms: number; success: boolean }>;
      total_latency_ms: number;
    }>;
    total_rounds: number;
    exhausted: boolean;
  };
}
```

### P3.3 — 跨 Agent 工具协作

允许一个 Agent 的 tool call 触发另一个 Agent 的 inference（通过 scheduler）：

```
Agent A → tool_call("query_agent_b_knowledge") 
       → scheduler submits Agent B inference
       → Agent B 的 tool response 回传给 Agent A 的 loop
```

这要求 ToolLoopRunner 支持**异步等待**（Agent B 可能多 tick 后才响应），Phase 3 初期可以限制为同步协作（Agent B 在线且同 tick 可用）。

---

## 关键决策

| 决策 | Phase | 选择 | 理由 |
|------|-------|------|------|
| Tool 透传方式 | P1 | `AiTaskRequest` 临时字段（Q2-A） | 最小改动，快速打通 |
| Tool 选择归属 | P2 | 注册表+配置链决定（Q2-B/C） | 安全可控，消除请求级裸传风险 |
| Loop 位置 | P1 | gateway_backed 内简化版（Q3-C） | 无 loop 基础设施时期的最小处理 |
| Loop 位置 | P2 | ToolLoopRunner 独立模块 + gateway_backed 驱动（Q3-B） | 复用性强，可测试 |
| Tool Executor | P1 | 独立 `tool_executor.ts`，handler map 注册 | 最小可用的执行抽象 |
| Tool 来源 | P1 | 系统内置硬编码 + Pack 配置 YAML 声明（Q1-A+B） | 覆盖首批需求 |
| `model_routed` contract | P1 | contracts 包同步增加 `'model_routed'`（B7） | 与 gateway_backed.strategies 保持一致 |
| gateway_backed 契约 | P1 | Phase 1 暂不处理 tool_call 模式的完整 loop；`action_type: 'tool_call'` 或仅限于 `agent_decision` 非 tool 模式先打通 | 避免 P1 范围膨胀 |

---

## 盲点清单（需在设计实施中持续关注）

| # | 盲点 | 阶段 | 应对 |
|---|------|------|------|
| B1 | Tool Executor 缺失 | P1 | P1.2 新增 `ai/tool_executor.ts` |
| B2 | gateway_backed 响应契约断裂 | P1 | P1.4 区分路由或限制 P1 不触发 tool_call |
| B3 | AiTaskDefinition 无 tools 字段 | P1 | P1.5 补齐 |
| B4 | 注册表缺 tools 段 | P1 | P1.3 补齐 |
| B5 | Observability 对 tool loop 的支持 | P2/P3 | P3.2 扩展 `AiInvocationTrace` |
| B6 | Phase 1/2 工具选择逻辑重叠 | P2 | P2.1 明确迁移路径（请求级→配置级） |
| B7 | `model_routed` contract 缺口 | P1 | P1 同步修复 `packages/contracts/src/inference.ts` |
| B8 | task_type 白名单细粒度 | P1 | P1.6 `allow_tool_calling` 默认仅 `agent_decision` |
| B9 | 单 tool 执行超时 | P2/P3 | P3.2 `per_tool_timeout_ms` |

---

## 风险

| 风险 | 级别 | 缓解 |
|------|------|------|
| Tool Executor 与现有 service 层的耦合过深 | 中 | Tool Executor 通过 `ToolExecutionContext` 注入依赖，不直接 import service 模块 |
| gateway_backed 契约断裂导致 P1 不可交付 | 中 | P1 限制 `agent_decision` 非 tool 模式，完整契约在 P2 解决 |
| Tool Loop 的 token/cost 消耗不可控 | 中 | `max_rounds` 限制 + 每轮 usage 聚合到 trace |
| 注册表 hot-reload 不支持导致工具变更需重启 | 低 | 全局问题（`resetAiRegistryCache` 无 watcher），非本设计范围 |
| Pack 工具与系统工具命名冲突 | 低 | `tool_id` 命名约定：`sys.*` vs `pack.<pack_id>.*` |

---

## 未包含（非本设计范围）

- Streaming/SSE 支持（全局问题）
- 熔断器/速率限制/指数退避（全局问题）
- 注册表 File Watcher 热加载（全局问题）
- Observability 写入降级策略（全局问题）
- `token_budget_trimmer` 删除（非死代码）
- 三层 AI 目录重构（独立设计文档 `.limcode/design/ai-three-layer-directory-refactoring.md`）

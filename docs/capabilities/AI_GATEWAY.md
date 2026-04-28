# AI Gateway / Invocation Observability

When the system sends a prompt to an AI model, the request doesn't go straight to the provider. It passes through a layered internal pipeline: a task-level service decides what kind of AI call is needed, a route resolver picks the right model and provider, and a gateway handles the actual dispatch and response handling. This layered design gives the system control over routing, fallback, rate limits, and observability without exposing those concerns to the caller.

The other side of this subsystem is **knowing what happened after the fact**: every AI invocation leaves a record — which model was used, how long it took, whether it fell back to a different provider, what the token usage was. This observability surface is exposed through `AiInvocationRecord`, a kernel-side persistence model that serves as evidence of what the AI layer did, independent of any specific inference result.

Key concepts:

- **AiTaskService** — the task-aware entry point that accepts a task type and context, then delegates to the appropriate route
- **RouteResolver** — decides which model and provider to use based on task type, configuration, and route hints from the world pack
- **ModelGateway** — the dispatch layer that actually calls the provider adapter and handles the request/response lifecycle
- **AiInvocationRecord** — a kernel-side persistence record of each AI call, capturing provider, model, usage, latency, and audit data; it is evidence, not a public execution contract
- **Elasticity layer** — circuit breaker, rate limiter, and exponential backoff mounted at the gateway level, transparent to adapters
- **Tool Calling** — cross-agent tool bridge, tool executor, tool loop runner, and tool permission system for controlled multi-step model interactions

本文档集中说明内部 AI task / gateway 执行层，以及 `AiInvocationRecord` 相关观测能力。

## 1. 文档定位

本文件回答：

- 内部 AI gateway 的分层是什么
- world pack 能如何影响 AI task 路由
- `model_routed` 在系统中的位置
- `AiInvocationRecord` 暴露了什么观测能力
- 弹性层 (circuit breaker / rate limiter / backoff) 如何工作
- Tool Calling 系统 (cross_agent_tool / tool_executor / tool_loop_runner / tool_permissions) 的架构与边界
- 注册表热加载的工作机制

本文件不负责：

- 公共 `/api/inference/*` 的完整 contract：看 `docs/API.md`
- 整体系统模块边界：看 `docs/ARCH.md`
- 推理与世界执行的业务语义：看 `docs/LOGIC.md`

## 2. 内部执行层概览

服务端当前已形成内部 AI 执行层，主要组件包括：

- `AiTaskService`
- `RouteResolver`
- `ModelGateway`
- provider adapters
- elasticity layer (circuit breaker / rate limiter / backoff)
- tool calling system (cross_agent_tool / tool_executor / tool_loop_runner / tool_permissions)
- registry watcher (hot-reload)

相关实现主要位于：

- `apps/server/src/ai/task_service.ts`
- `apps/server/src/ai/task_definitions.ts`
- `apps/server/src/ai/task_decoder.ts`
- `apps/server/src/ai/route_resolver.ts`
- `apps/server/src/ai/gateway.ts`
- `apps/server/src/ai/registry.ts`
- `apps/server/src/ai/registry_watcher.ts`
- `apps/server/src/ai/providers/mock.ts`
- `apps/server/src/ai/providers/openai.ts`
- `apps/server/src/ai/providers/gateway_backed.ts`
- `apps/server/src/ai/elasticity/circuit_breaker.ts`
- `apps/server/src/ai/elasticity/rate_limiter.ts`
- `apps/server/src/ai/elasticity/backoff.ts`
- `apps/server/src/ai/elasticity/config_resolver.ts`
- `apps/server/src/ai/cross_agent_tool.ts`
- `apps/server/src/ai/tool_executor.ts`
- `apps/server/src/ai/tool_loop_runner.ts`
- `apps/server/src/ai/tool_permissions.ts`

## 3. 分层关系

当前可概括为：

```text
AiTaskService
  -> RouteResolver
  -> ModelGateway (+ elasticity: circuit_breaker / rate_limiter / backoff)
  -> provider adapters
```

作用分别是：

- `AiTaskService`：面向 task type 的内部统一入口，负责组装 task config、解析 tools/tool_policy、构建 gateway request
- `RouteResolver`：按任务、配置、路由提示决定走哪条 route
- `ModelGateway`：承接模型调用与 provider adapter 调度，弹性层在此挂载
- provider adapters：落到具体 provider 协议
- elasticity layer：circuit breaker（per-provider 熔断）、rate limiter（per-provider 并发控制）、exponential backoff（指数退避 + jitter）

## 4. world pack 的影响范围

world pack 当前只能通过声明式 `pack.ai` 影响：

- prompt organization
- output schema
- parse / decoder behavior
- route hints
- tool definitions（通过注册表的 `tools` 字段声明可用工具）

world pack **不能**：

- 直接操纵 raw provider payload
- 注入任意可执行 parser / composer 代码
- 绕过 server-side registered extension 模式

## 5. public boundary 与 internal boundary

当前公开 HTTP inference contract 仍然只稳定承诺：

- `mock`
- `rule_based`

内部虽然已经存在：

- `model_routed`
- `gateway_backed` inference provider
- OpenAI-first rollout
- tool calling loop
- cross-agent tool bridge

但这些目前仍属于内部 / 受控能力，不应被当成正式 public execution contract。

换言之：

- 对外 API 的稳定说明仍是 `mock | rule_based`
- gateway path 是服务端内部的执行底座
- 其 public 化程度目前主要停留在**只读观测面**

## 6. Workflow metadata 透传

当前 workflow metadata 已透传到：

- `PromptBundleV2.metadata`
- AI messages metadata
- `AiTaskRequest.metadata`
- `ModelGatewayRequest.metadata`
- `AiInvocationTrace`

这意味着 gateway path 的观测不只是"最终 prompt 文本是什么"，还能够回答：

- 当前任务类型是什么
- 命中了哪个 workflow profile
- 使用了哪些 step
- section / placement 结果是什么

## 7. AiInvocationRecord

kernel-side Prisma 当前包含 `AiInvocationRecord`，记录例如：

- provider / model / route
- fallback / attempted models
- usage / safety / latency
- request / response audit payload（受 audit level 控制）
- 与 `InferenceTrace.source_inference_id` 的关联

它的职责更接近：

- AI 调用证据
- provider 观测记录
- workflow 与模型执行之间的桥接证据

而不是 public execution contract 本身。

## 8. Public read-only observability surface

当前已经公开的只读接口：

- `GET /api/inference/ai-invocations`
- `GET /api/inference/ai-invocations/:id`

这些接口的语义是：

- 暴露观测证据
- 支持列表 / 详情查询
- 不改变 `/api/inference/*` 的外部执行契约

当 inference 通过内部 gateway path 执行时，trace metadata 还可能包含：

- `ai_invocation_id`

该字段用于把 workflow-side `InferenceTrace` 关联到 kernel-side `AiInvocationRecord`。

## 9. 弹性层 (Elasticity Layer)

弹性层挂载在 gateway 层，对 provider adapter 透明。三个组件独立工作，按以下顺序执行：

```text
rate_limiter.acquire() → circuit_breaker.allowRequest() → adapter.invoke()
  → circuit_breaker.recordSuccess() / recordFailure()
  → rate_limiter.release()
  → on failure: backoff.wait(attempt) → retry
```

### 9.1 Circuit Breaker（熔断器）

Per-provider 状态机，防止对已失败 provider 的持续调用：

| 状态 | 行为 |
|------|------|
| `closed` | 正常放行，连续失败计数达到阈值 → `open` |
| `open` | 拒绝所有请求，等待 recovery_timeout → `half_open` |
| `half_open` | 允许有限探测请求，成功 → `closed`，失败 → `open` |

默认配置：5 次连续失败进入 open，30s 后半开探测，探测窗口 60s。

错误码：`AI_CIRCUIT_OPEN`

### 9.2 Rate Limiter（并发限流器）

Per-provider 并发计数器 + Promise 等待队列：

- `maxConcurrent`：最大在途并发请求数（默认 10）
- `queueMaxSize`：等待队列最大长度（默认 50）
- `queueTimeoutMs`：排队最大等待时间（默认 30s）

超出入队上限返回 `AI_RATE_LIMIT_QUEUE_FULL`，排队超时返回 `AI_RATE_LIMIT_QUEUE_TIMEOUT`。

### 9.3 Exponential Backoff（指数退避）

指数退避 + 随机抖动，用于重试间隔计算：

- `baseDelayMs`：基础延迟（默认 1s）
- `maxDelayMs`：最大延迟上限（默认 30s）
- `jitterRatio`：抖动比例（默认 0.25）

第 n 次重试延迟 = `min(baseDelay * 2^(n-1), maxDelay) * (1 + random(-jitter, +jitter))`

## 10. Tool Calling 系统

Tool Calling 系统使 AI 模型能够在单次推理中发起多轮工具调用，包括调用其他 agent（cross-agent tool）。

### 10.1 组件架构

```text
AiTaskService (task_config.tools / task_config.tool_policy)
  → resolveToolSpecsFromRegistry() → AiToolSpec[]
  → ModelGateway (tools / tool_policy 透传)
  → provider adapter (tool call 发起)
  → ToolLoopRunner (多轮 tool loop)
    → ToolRegistry.execute()
      → ToolPermissionPolicy 校验
      → ToolHandler / CrossAgentBridge 执行
```

### 10.2 核心组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `AiToolSpec` | `types.ts` | 工具声明类型：name、description、input_schema、strict |
| `AiToolPolicy` | `types.ts` | 工具策略：mode (disabled/allowed/required)、allowed_tool_names、max_tool_calls |
| `ToolRegistry` | `tool_executor.ts` | 工具注册与执行：register / execute / has / listNames |
| `ToolHandler` | `tool_executor.ts` | 单个工具的执行处理器接口 |
| `ToolLoopRunner` | `tool_loop_runner.ts` | 多轮 tool loop：发送 → 接收 tool_calls → 执行 → 回传结果 → 循环 |
| `ToolPermissionPolicy` | `tool_permissions.ts` | 工具权限策略：allowed_roles、allowed_pack_ids、require_capability、rate_limit |
| `CrossAgentBridge` | `cross_agent_tool.ts` | 跨 agent 查询桥：将 tool call 转为对另一 agent 的 AiTaskService.runTask() 调用 |

### 10.3 Tool Loop 执行流程

```text
1. AiTaskService 根据 task_config.tools 解析工具列表
2. 若 tool_policy.mode != 'disabled'，将 tools/tool_policy 传入 ModelGatewayRequest
3. provider adapter 将 tools 转为 provider 原生格式
4. 模型返回 finish_reason='tool_call' + tool_calls[]
5. ToolLoopRunner 接管：
   a. 对每个 tool_call：ToolRegistry.execute(name, args)
   b. 执行前校验 ToolPermissionPolicy
   c. 将 tool result 以 role='tool' 消息追加到对话历史
   d. 重新调用 gateway（携带完整消息历史）
6. 循环直到 finish_reason='stop' 或达到 max_rounds / timeout
```

### 10.4 Tool Loop 配置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `max_rounds` | 5 | 最大 tool call 往返次数 |
| `total_timeout_ms` | 60000 | 整个 loop 的总超时 |
| `per_tool_timeout_ms` | 15000 | 单个 tool 执行超时 |
| `termination_tools` | [] | 调用后立即终止 loop 的工具名列表 |
| `termination_finish_reasons` | ['stop'] | 触发终止的 finish_reason |
| `fallback_on_exhaustion` | 'return_last' | loop 耗尽时的行为：return_last / error |

### 10.5 Tool Permissions

每个工具的权限策略定义：

- `allowed_roles`：允许使用该工具的 agent role 列表
- `allowed_pack_ids`：允许使用该工具的 pack ID 列表（可选）
- `require_capability`：使用该工具需要具备的 capability（可选）
- `rate_limit`：per-tick 速率限制（max_per_tick / cooldown_ticks，可选）

### 10.6 Cross-Agent Tool Bridge

`CrossAgentBridge` 允许一个 agent 在 tool loop 中查询另一个 agent：

1. Tool handler 构造 `CrossAgentQuery`（target_agent_id + task_type + query）
2. Bridge 将查询转为 `AiTaskRequest`，调用 `aiTaskService.runTask()`
3. 目标 agent 的推理结果作为 tool result 返回给调用方

这使系统支持结构化的 agent-to-agent 信息交换，而非仅通过社交层广播。

## 11. 注册表热加载 (Registry Hot-Reload)

`registry_watcher.ts` 通过 `fs.watch` 监听配置文件变更，实现零停机配置更新。

### 11.1 工作机制

1. 启动时注册对 `ai_models.yaml` 和 `prompt_slots.yaml` 的文件监听
2. 文件变更后 300ms 防抖窗口
3. 先 parse + deep-merge 新配置
4. Zod schema 校验：通过 → 更新缓存；失败 → 保留旧缓存 + 打印错误日志
5. SIGINT/SIGTERM 时优雅关闭 watcher

### 11.2 监听文件

| 文件 | 内容 |
|------|------|
| `ai_models.yaml` | provider 配置、模型注册表、route policy |
| `prompt_slots.yaml` | Prompt Slot 声明式配置 |

### 11.3 安全保证

- 校验失败不更新缓存 — 运行中系统不受损坏配置影响
- 零外部依赖，纯 Node.js `fs.watch`
- 防抖避免编辑器保存触发多次重载

## 12. 当前边界

当前已成立的边界：

- `model_routed` 仍是 internal / controlled capability
- public `/api/inference/*` 不以 provider-specific contract 对外承诺
- world pack 的 AI 定制能力是 declarative 的，不是任意执行能力
- 更复杂的 AI 行为扩展应继续走 server-side registered extension
- 弹性层对 adapter 透明，adapter 无需感知 circuit breaker / rate limiter / backoff
- tool calling 属于 host-side 受控执行能力，tool 注册与权限校验均在 host 侧完成
- 注册表热加载保证配置变更不中断运行中服务

## 13. 相关文档

- 公共接口契约：`../API.md`
- 架构边界：`../ARCH.md`
- 业务语义：`../LOGIC.md`
- Prompt Workflow：`./PROMPT_WORKFLOW.md`
- 共享类型契约：`packages/contracts/src/ai_shared.ts`（PromptBundleMetadata、PromptWorkflowSnapshot 等 AI/inference 桥接类型）
- 相关设计资产：`.limcode/archive/historical/design/multi-model-gateway-and-unified-ai-task-contract-design.md`
- 重构设计：`.limcode/design/ai-three-layer-directory-refactoring.md`
- Tool Calling 设计：`.limcode/archive/design/ai-tool-calling-enablement.md`
- 弹性层设计：`.limcode/archive/design/ai-elasticity-circuit-breaker-rate-limiter-backoff.md`
- 热加载设计：`.limcode/archive/design/ai-registry-hot-reload.md`

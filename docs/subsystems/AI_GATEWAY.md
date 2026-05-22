# AI Gateway / Invocation Observability

When the system sends a prompt to an AI model, the request doesn't go straight to the provider. It passes through a layered internal pipeline: a task-level service decides what kind of AI call is needed, a route resolver picks the model, and a gateway handles the actual dispatch and response handling. This layered design gives the system control over routing, rate limits, and observability without exposing those concerns to the caller.

**Provider 生态**：系统内置 4 个真实 AI provider adapter：OpenAI、Anthropic、DeepSeek、Ollama。路由默认以 OpenAI 为主，Anthropic/DeepSeek 为 fallback，Ollama 为本地部署路径。弹性层（circuit breaker、rate limiter、backoff）在多 provider 下实现 provider 级故障转移——当 OpenAI 不可用时，系统自动切换到 Anthropic → DeepSeek 链。Circuit breaker 状态跨请求保持，rate limiter 按 provider 独立计速。

The other side of this subsystem is **knowing what happened after the fact**: every AI invocation leaves a record — which model was used, how long it took, what the token usage was. This observability surface is exposed through `AiInvocationRecord`, a kernel-side persistence model that serves as evidence of what the AI layer did, independent of any specific inference result.

Key concepts:

- **AiTaskService** — the task-aware entry point that accepts a task type and context, then delegates to the appropriate route
- **RouteResolver** — decides which model and provider to use based on task type, configuration, and route hints from the world-pack
- **ModelGateway** — the dispatch layer that actually calls the provider adapter and handles the request/response lifecycle
- **AiInvocationRecord** — a kernel-side persistence record of each AI call, capturing provider, model, usage, latency, and audit data; it is evidence, not a public execution contract
- **Elasticity layer** — circuit breaker, rate limiter (with dynamic 429 calibration), and exponential backoff mounted at the gateway level, transparent to adapters
- **Tool Calling** — cross-agent tool bridge, tool executor, tool loop runner (with token budget management), and tool permission system for controlled multi-step model interactions
- **Token Counter** — unified token counting with tiktoken (OpenAI-compatible) and char-based estimation (Anthropic)
- **Response Caching** — LRU in-memory cache with per-task-type TTL, reducing redundant deterministic inference costs
- **Streaming** — provider adapter executeStream() with gateway-level SSE pass-through for real-time text/tool_call/thinking deltas
- **Pluggable Provider Templates** — `provider_templates` YAML section for zero-code addition of OpenAI-compatible channels (OpenRouter, SiliconFlow, Groq, etc.) via configuration alone, loaded dynamically by `adapter_registry.ts`

本文档集中说明内部 AI task / gateway 执行层，以及 `AiInvocationRecord` 相关观测能力。

## 1. 文档定位

本文件回答：

- 内部 AI gateway 的分层是什么
- world-pack 能如何影响 AI task 路由
- `model_routed` 在系统中的位置
- `AiInvocationRecord` 暴露了什么观测能力
- 弹性层 (circuit breaker / rate limiter / backoff) 如何工作
- Tool Calling 系统 (cross_agent_tool / tool_executor / tool_loop_runner / tool_permissions) 的架构与边界
- 注册表热加载的工作机制

本文件不负责：

- 公共 `/api/inference/*` 的完整 contract：看 `../specs/API.md`
- 整体系统模块边界：看 `../ARCH.md`
- 推理与世界执行的业务语义：看 `../LOGIC.md`
- `behavior_tree` provider 的内部注册和求值语义：看 `BEHAVIOR_TREE.md`

## 2. 内部执行层概览

服务端已形成内部 AI 执行层，主要组件包括：

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
- `apps/server/src/ai/providers/openai_compatible.ts`
- `apps/server/src/ai/providers/anthropic.ts`
- `apps/server/src/ai/providers/deepseek.ts`
- `apps/server/src/ai/providers/ollama.ts`
- `apps/server/src/ai/providers/gateway_backed.ts`
- `apps/server/src/ai/elasticity/circuit_breaker.ts`
- `apps/server/src/ai/elasticity/rate_limiter.ts`
- `apps/server/src/ai/elasticity/backoff.ts`
- `apps/server/src/ai/elasticity/config_resolver.ts`
- `apps/server/src/ai/elasticity/types.ts`
- `apps/server/src/ai/elasticity/index.ts`
- `apps/server/src/ai/providers/adapter_registry.ts`
- `apps/server/src/ai/token_counter.ts`
- `apps/server/src/ai/cache.ts`
- `apps/server/src/ai/cross_agent_tool.ts`
- `apps/server/src/ai/tool_executor.ts`
- `apps/server/src/ai/tool_loop_runner.ts`
- `apps/server/src/ai/tool_permissions.ts`

## 3. 分层关系

```text
AiTaskService
  -> RouteResolver
  -> ModelGateway (+ elasticity: circuit breaker / rate limiter / backoff)
  -> provider adapters
```

作用分别是：

- `AiTaskService`：面向 task type 的内部统一入口，负责组装 task config、解析 tools/tool_policy、构建 gateway request
- `RouteResolver`：按任务、配置、路由提示决定走哪条 route
- `ModelGateway`：承接模型调用与 provider adapter 调度，弹性层在此挂载
- provider adapters：落到具体 provider 协议
- elasticity layer：circuit breaker（per-provider 熔断）、rate limiter（per-provider 并发控制）、exponential backoff（指数退避 + jitter）

## 4. world-pack 的影响范围

world-pack 只能通过声明式 `pack.ai` 影响：

- prompt organization
- output schema
- parse / decoder behavior
- route hints
- tool definitions（通过注册表的 `tools` 字段声明可用工具）

world-pack **不能**：

- 直接操纵 raw provider payload
- 注入任意可执行 parser / composer 代码
- 绕过 server-side registered extension 模式

## 5. public boundary 与 internal boundary

公开 HTTP inference contract 稳定承诺：

- `mock`
- `behavior_tree`

内部虽然已经存在：

- `model_routed`
- `gateway_backed` inference provider
- OpenAI-first rollout
- tool calling loop
- cross-agent tool bridge

但这些仍属于 internal / 受控能力，不应被当成正式 public execution contract。

换言之：

- 对外 API 的稳定说明仍是 `mock | behavior_tree`
- gateway path 是服务端内部的执行底座
- 其 public 化程度主要停留在**只读观测面**
- `model_routed` 路径有 4 个真实 provider adapter：OpenAI、Anthropic、DeepSeek、Ollama

## 6. Workflow metadata 透传

workflow metadata 透传到：

- `PromptBundleV2.metadata`
- AI messages metadata
- `AiTaskRequest.metadata`
- `ModelGatewayRequest.metadata`
- `AiInvocationTrace`

这意味着 gateway path 的观测不只是"最终 prompt 文本是什么"，还能够回答：

- 任务类型是什么
- 命中了哪个 workflow profile
- 使用了哪些 step
- section / placement 结果是什么

## 7. AiInvocationRecord

kernel-side Prisma 包含 `AiInvocationRecord`，记录例如：

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

已公开的只读接口：

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

Per-provider 并发计数器 + Promise 等待队列 + 动态校准：

- `maxConcurrent`：最大在途并发请求数（默认 10，可通过 `adjustFromHints()` 动态调整）
- `queueMaxSize`：等待队列最大长度（默认 50）
- `queueTimeoutMs`：排队最大等待时间（默认 30s）

超出入队上限返回 `AI_RATE_LIMIT_QUEUE_FULL`，排队超时返回 `AI_RATE_LIMIT_QUEUE_TIMEOUT`。

**动态校准**（`adjustFromHints`）：provider adapter 在收到 HTTP 429 响应时解析 `Retry-After` / `x-ratelimit-remaining` / `x-ratelimit-limit` 头，通过 `rate_limit_hints` 字段传递给 gateway。gateway 调用 `RateLimiter.adjustFromHints()`：
- 立即：`maxConcurrent` 降至 `max(1, active)`
- 冷却期（`retry-after` 秒后）：恢复到原始值的 50%
- 逐步升压：每 60s +1，恢复到原始值

未返回 rate limit 头的 provider 保持静态配置。

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
- `allowed_pack_ids`：允许使用该工具的 pack instance_id 列表（可选）
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

## 12. 边界

已成立的边界：

- `model_routed` 仍是 internal / controlled capability，有 4 个真实 provider adapter（OpenAI、Anthropic、DeepSeek、Ollama）
- public `/api/inference/*` 不以 provider-specific contract 对外承诺
- 多 provider fallback 链默认：OpenAI → Anthropic → DeepSeek（可通过 `ai_models.yaml` 配置路由）
- world-pack 的 AI 定制能力是 declarative 的，不是任意执行能力
- 更复杂的 AI 行为扩展应继续走 server-side registered extension
- 弹性层对 adapter 透明，adapter 无需感知 circuit breaker / rate limiter / backoff
- tool calling 属于 host-side 受控执行能力，tool 注册与权限校验均在 host 侧完成
- 注册表热加载保证配置变更不中断运行中服务
- Streaming 为内部能力，后端 adapter + gateway 已实现
- Response caching 为 gateway 层内部优化，对 adapter 透明；缓存命中写入审计记录（`provider: 'cache'`）
- Provider templates 支持通过 `ai_models.yaml` 零代码添加 OpenAI-compatible 渠道，由 `adapter_registry.ts` 动态构建 adapter 列表；热加载即时生效

## 13. Token Counter (Token 计数)

`token_counter.ts` 提供统一的 token 计数抽象，供 tool loop token 预算等子系统使用。

- **`TokenCounter` 接口**：`countTokens(text, provider, model)` / `countMessagesTokens(messages, provider, model)`
- **OpenAI 兼容 provider**（openai / deepseek / ollama）：使用 `tiktoken`（`o200k_base` / `cl100k_base encoding`），精确计数
- **Anthropic**：字符数 / 3.5 粗略估算（Anthropic tokenizer 无 JS 原生库，误差 ±15%）
- **其他 provider**：字符数 / 4 fallback 估算
- **`tiktoken` 加载**：惰性加载（`require('tiktoken')`），首次使用时初始化 encoding 缓存

## 14. Response Caching (响应缓存)

`cache.ts` 提供基于 LRU 的内存缓存，减少确定性推理的重复 API 调用。

- **`InMemoryPromptCache`**：LRU 淘汰策略，max 500 entries
- **Cache key**：`SHA-256(provider, model, messages[], temperature, response_mode, structured_output_schema, tools, tool_policy, pack_id, task_type)`
- **TTL 策略**：per-task-type TTL（`agent_decision`: 60s, `context_summary`: 300s, `embedding`: 3600s, 默认 120s）
- **缓存条件**：仅对 `temperature=0` + `response_mode` 为 `json_schema`/`json_object` + 非 `tool_call` 模式 + 非 streaming 请求
- **缓存命中**：跳过 adapter 调用，直接返回缓存结果（`cached: true`），写入 `AiInvocationRecord`（`provider: 'cache'`, `cost_usd: 0`）

## 15. Streaming / SSE (流式响应)

Provider adapter 支持流式响应，gateway 透传 SSE。前端 SSE 消费待后续实现。

- **`AiProviderAdapter.executeStream()`**：可选方法，返回 `AsyncIterable<AiProviderAdapterChunk>`。不支持的 adapter（如 mock）不实现此方法，gateway 退化到非流式调用
- **Chunk 类型**：`start` / `text_delta` / `thinking_delta` / `tool_call_start` / `tool_call_delta` / `finish` / `error`
- **已实现 streaming**：`openai_compatible.ts`（Chat Completions SSE）、`anthropic.ts`（Messages SSE with typed events）
- **Streaming 绕行**：`ModelGateway.executeStream()` 绕过 AiTaskService（task 层逻辑对增量流式场景过重），直接由 SSE endpoint 调用
- **Tool call 流式累积**：adapter 内部维护 tool call buffer（增量到达 → 累积 → finish 时组装完整 tool_calls），tool loop 不使用流式模式
- **流式 observability**：流开始前写 pending 记录 → 流结束后 upsert 完整记录

## 16. Provider Templates (可插拔 Provider 配置)

`ai_models.yaml` 的 `provider_templates` 段允许零代码添加 OpenAI-compatible 渠道，利用现有注册表热加载即时生效。

### 16.1 模板类型

| kind | 说明 | 示例 |
|------|------|------|
| `openai_compatible` | OpenAI Chat Completions API 兼容的渠道，配置驱动 | OpenRouter、SiliconFlow、Groq、Together、Fireworks、Moonshot、通义千问、本地 vLLM |
| `builtin` | 引用已有内置 adapter（可 alias 为不同名称） | `name: claude, builtin_name: anthropic` |

### 16.2 配置示例

```yaml
provider_templates:
  - name: openrouter
    kind: openai_compatible
    base_url: https://openrouter.ai/api/v1
    api_key_env: OPENROUTER_API_KEY
    capability_overrides:
      maxTokensField: max_tokens
      supportsSeed: true
      maxStructuredOutput: json_schema
    default_headers:
      HTTP-Referer: https://yidhras.local
```

### 16.3 动态构建

`adapter_registry.ts` 的 `buildAdaptersFromRegistry()` 在 gateway 初始化时执行：

1. 加载所有内置 adapter（mock / openai / anthropic / deepseek / ollama）
2. 遍历 `provider_templates`，为每个 template 构建对应的 adapter
3. `kind: openai_compatible` → `createOpenAiCompatibleAdapterFromTemplate()`（自动继承流式能力）
4. `kind: builtin` + `builtin_name` → 从 `builtinFactories` 查找并以 `template.name` 覆盖 provider 标识

**覆盖行为**：template 可按 `name` 覆盖内置 adapter。覆盖 `openai` 会丧失 Responses API 和 Embeddings 能力（需在文档/注释中显式警告）。

## 17. 相关文档

- 公共接口契约：`../API.md`
- 架构边界：`../ARCH.md`
- 业务语义：`../LOGIC.md`
- Prompt Workflow：`./PROMPT_WORKFLOW.md`
- 共享类型契约：`packages/contracts/src/ai_shared.ts`（PromptBundleMetadata、PromptWorkflowSnapshot 等 AI/inference 桥接类型）

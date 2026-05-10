# AI Gateway 完整性补全实施草案

> 来源：`.limcode/design/skeptical-comprehensive-audit-report.md` §4.3
> 状态：设计完成
> 日期：2026-05-10
> 实施计划：`.limcode/plans/ai-gateway-completion-plan.md`

---

## 0. 当前状态总结

AI Gateway 架构分层（task → route → gateway → adapter → elasticity）在概念上正确，但存在以下结构性缺陷：

- **Provider 单一性**：唯一真实 adapter 是 OpenAI（599 行）。当 OpenAI 不可用时，系统退化为 mock/rule_based，这不是"优雅降级"而是功能丧失
- **弹性层空转**：circuit breaker / rate limiter / backoff 在单 provider 下无法展现真正的 fallback 价值
- **Tool loop 无 token 预算**：递归 tool call 可能撑爆上下文窗口，无任何防护
- **Rate limiter 静态配置**：`maxConcurrent=10` 是写死的默认值，不根据 provider 实际限流响应动态调整
- **无 streaming**：前端是只读轮询控制台，实时交互需要 streaming
- **无缓存**：相同 prompt 重复调用无缓存，AI 成本无法控制
- **Circuit breaker 实例生命周期 bug**：`gateway.ts:282-283`，`cbMap` 和 `rlMap` 在 `execute()` 内部创建，每次调用 new 空 Map。熔断器失败计数在请求间不保留，当前 circuit breaker 实际上不工作。单 provider 下未暴露（无 fallback 可切），多 provider 下必须修复

## 1. 实施范围与优先级

### P0 — 阻塞性（MVP 必须）

| # | 工作项 | 工作量估算 | 说明 |
|---|--------|-----------|------|
| 0 | **Circuit breaker / rate limiter 生命周期修复** | 0.5 天 | 前置修复：cbMap/rlMap 提升到闭包作用域。不修的话多 provider fallback 不工作 |
| 1 | OpenAI 兼容通用 adapter 重构 (`openai_compatible.ts`) | 0.5 天 | 从 `openai.ts` 提取通用 Chat Completions 逻辑，含 `capabilityOverrides` 处理 provider 差异 |
| 2 | Anthropic provider adapter | 2-3 天 | 独立实现 Messages API，折中 structured output，system prompt 提取到顶层参数 |
| 3 | DeepSeek provider adapter | 0.5 天 | 基于 `openai_compatible.ts` 的 ~40 行工厂函数 + capabilityOverrides |
| 4 | Ollama/local provider adapter | 0.5 天 | 同上，无 API key 认证；embedding 模型注册为 fallback |
| 5 | Provider-level fallback 验证 | 1 天 | 集成测试验证多 provider fallback 链：OpenAI → Anthropic → DeepSeek，含 circuit breaker 状态保持 |

### P1 — 高优先级（生产必须）

| # | 工作项 | 工作量估算 | 说明 |
|---|--------|-----------|------|
| 6 | Rate limit 动态校准 | 1-2 天 | 解析 429 响应的 `retry-after` / `x-ratelimit-*` 头，自动调整并发上限 |
| 7 | Tool loop token 预算管理 | 1-2 天 | 追踪 tool loop 每轮的 token 消耗，到达阈值时终止并压缩 |
| 8 | Response caching (KV-store) | 2-3 天 | 基于 prompt hash 的确定性缓存，减少重复推理成本 |

### P2 — 中优先级（增强能力）

| # | 工作项 | 工作量估算 | 说明 |
|---|--------|-----------|------|
| 9 | Streaming / SSE 支持 | 3-5 天 | provider adapter 流式接口 + gateway SSE 透传 + 前端消费 |

## 2. 详细设计

### 2.0 前置修复：Circuit breaker / Rate limiter 实例生命周期

**Bug 现状**：`gateway.ts:282-283`，`cbMap` 和 `rlMap` 在 `execute()` 方法内部创建，每次 AI 调用初始化一个全新的空 Map。熔断器的连续失败计数、open/closed/half-open 状态在请求间完全不保留。

```typescript
// gateway.ts createModelGateway 的 execute() 内部 — 当前代码
const cbMap = new Map<string, CircuitBreaker>();  // 每次调用 new！
const rlMap = new Map<string, RateLimiter>();      // 每次调用 new！
```

**影响**：circuit breaker 完全无效。OpenAI 连续失败 100 次，熔断器永远不会打开（因为每次 execute 都是全新实例，failure count = 0）。fallback 链条（OpenAI → Anthropic → DeepSeek）永远不会触发，除非第一个 provider 连 adapter 都不存在。

**修复**：将 `cbMap` 和 `rlMap` 提升到 `createModelGateway` 的闭包作用域，与 `adapterByProvider` 同级。

```typescript
export const createModelGateway = ({ adapters, context, registryConfig }): ModelGateway => {
  const adapterByProvider = new Map(adapters.map(a => [a.provider, a]));
  const cbMap = new Map<string, CircuitBreaker>();  // 修复：提升到闭包
  const rlMap = new Map<string, RateLimiter>();      // 修复：提升到闭包
  // ...
  return {
    async execute(input) {
      // cbMap / rlMap 现在在请求间保持状态
      const cb = getOrCreate(cbMap, candidate.provider, ...);
      // ...
    }
  };
};
```

**工作量**：0.5 天，Phase 1 最优先执行（所有多 provider 验证依赖此修复）。

### 2.1 Anthropic Provider Adapter

**目标**：实现 `AiProviderAdapter` 接口，覆盖 Anthropic Messages API。

**关键差异处理**：
- **System prompt 结构差异**（重要）：Anthropic Messages API 的 system prompt 是**顶层参数**，不是 messages 数组中的消息。Adapter 必须从 `input.request.messages[]` 中提取 `role='system'` 和 `role='developer'` 的消息，合并后放入 Anthropic 的顶层 `system` 参数（字符串或数组）。这些消息**不能**留在 messages 数组中（Anthropic API 不认识 system role message）。
- Anthropic 没有 `developer` role → 与 `system` 合并处理，都映射到顶层 `system` 参数
- Tool calling → Anthropic 原生 `tool_use` 支持，与 OpenAI function calling 语义相近
- Vision → Anthropic 原生支持 `image` content block

**Structured output 折中方案**：`json_schema` 和 `json_object` 走不同路径。

```
adapter.execute(input):
  if input.request.response_mode == 'json_schema':
    → 方案 A: tool_use 强制 JSON
  else if input.request.response_mode == 'json_object':
    → 方案 B: 提示词注入 schema
  else:
    → 原生 text 输出
```

**方案 A — `json_schema` 走 tool_use**：
- 把 `structured_output.json_schema` 包装成一个内部 tool（如 `__structured_output`），设置 `tool_choice: { type: "tool", name: "__structured_output" }`
- 模型被迫调用该 tool，其 `input` 必然是合法 JSON 且符合 schema
- 优势：可靠性高，API 层面约束，不依赖模型"听话"
- 代价：额外 token 开销（tool schema 定义 + tool_use JSON 包装），输出解析路径不同（从 `content[1].tool_use.input` 取而非 `content[0].text`）
- 与真实 tool calling 冲突时的处理：将 `__structured_output` 合并到 tools 列表末尾，`tool_choice` 设为 `any`（允许模型同时调用功能 tool 和输出格式 tool）。如果任务同时需要 structured output 和 tool calling，模型可以并行调用多个 tool

**方案 B — `json_object` 走提示词注入**：
- 在 system prompt 末尾追加 "Respond with a valid JSON object only, without markdown fences or surrounding text."
- 从 `content[0].text` 直接读取，尝试 `JSON.parse`
- 解析失败 → 重试一次（带更强的约束提示），第二次仍失败 → 返回 `AI_PROVIDER_DECODE_FAIL` 错误
- 优势：无侵入，无额外 token 开销，与 tool calling 无冲突
- 代价：不可靠，复杂输出时模型可能包裹 markdown 或遗漏括号，需要 post-validation + 重试

**选择逻辑**：`json_schema` 有明确 schema 定义且失败代价高（agent decision 丢失），用 tool_use；`json_object` 只要求合法 JSON，失败后重试成本可控，用提示词注入。

**实现文件**：`apps/server/src/ai/providers/anthropic.ts`

**配置注册**（`registry.ts` 内置默认）：
```yaml
providers:
  - provider: anthropic
    api_key_env: ANTHROPIC_API_KEY
    base_url: https://api.anthropic.com/v1
    enabled: true
models:
  - provider: anthropic
    model: claude-sonnet-4-6
    endpoint_kind: chat_completions  # 复用现有枚举，内部映射到 Messages API
    capabilities:
      text_generation: true
      structured_output: json_schema  # json_schema 走 tool_use，json_object 走提示词
      tool_calling: true
      vision_input: true
      embeddings: false
      rerank: false
      max_context_tokens: 200000
      max_output_tokens: 8192
    tags: [default, structured, anthropic-first]
    availability: active
```

**开放问题**：
- Anthropic API 版本头（`anthropic-version: 2023-06-01`）是否需要可配置？→ 是，通过 `provider_config.default_headers` 或新增 `api_version` 字段
- `thinking` 能力是否暴露为可选参数？→ 暴露。通过 `sampling.extensions.thinking` 透传，默认关闭，route 级别可选启用

### 2.2 OpenAI 兼容 Provider 通用 Adapter

**目标**：构建一个通用的 OpenAI Chat Completions API 兼容 adapter，所有 OpenAI 协议兼容的 provider 通过配置实例化，无需逐一编写代码。

**背景**：当前 `openai.ts`（599 行）包含三个职责：
1. OpenAI 特定的 API 认证（Bearer token、Organization、Project header）
2. OpenAI 特定的 endpoint 调度（`/chat/completions`、`/responses`、`/embeddings`）
3. 通用 Chat Completions API 的 request/response 构建

其中职责 3 对 DeepSeek、Ollama、vLLM、Moonshot、通义千问等大量 provider 都是相同的。当前 `openai.ts` 将三个职责耦合在一个文件里，无法复用。

**方案 B — 分层重构**：

```text
apps/server/src/ai/providers/
├── openai_compatible.ts    # NEW: 通用 Chat Completions API adapter
├── openai.ts               # REFACTOR: 继承 openai_compatible，仅覆盖认证 + endpoint 调度
├── deepseek.ts             # NEW: 一行配置 + 调用 openai_compatible 工厂
├── ollama.ts               # NEW: 同上（P2 实施）
├── anthropic.ts            # NEW: 独立实现（非 OpenAI 兼容）
└── types.ts                # 不变
```

**`openai_compatible.ts` 接口**：

```typescript
// 从 openai.ts 提取的通用 Chat Completions 逻辑：
// - buildChatCompletionsRequestBody()
// - normalizeChatCompletionsResponse()
// - performChatCompletionsRequest()
// 不包含: buildResponsesRequestBody, buildEmbeddingsRequestBody, 认证逻辑

interface OpenAiCompatibleConfig {
  provider: string;
  resolveApiKey(input: AiProviderAdapterRequest): string | null;
  resolveBaseUrl(input: AiProviderAdapterRequest): string;
  buildHeaders?(input: AiProviderAdapterRequest): Record<string, string>;
  supportsResponsesApi?: boolean;    // 仅 OpenAI 有
  supportsEmbeddings?: boolean;      // 仅 OpenAI 有
  capabilityOverrides?: {
    /** DeepSeek: temperature 和 top_p 不允许同时设置，需要二选一 */
    disallowTempWithTopP?: boolean;
    /** DeepSeek/Ollama 使用 max_tokens 而非 max_completion_tokens */
    maxTokensField?: 'max_completion_tokens' | 'max_tokens';
    /** 部分 provider 不支持 seed 参数 */
    supportsSeed?: boolean;
    /** 部分 provider 的 response_format 仅支持 json_object，不支持 json_schema */
    maxStructuredOutput?: 'json_object' | 'json_schema' | 'none';
  };
}

createOpenAiCompatibleAdapter(config: OpenAiCompatibleConfig): AiProviderAdapter
```

**OpenAI adapter 重构后**（`openai.ts`，预计 350→400 行）：
- 调用 `createOpenAiCompatibleAdapter()` 作为 Chat Completions 基础
- 覆盖 `execute()` 以支持 Responses API 和 Embeddings endpoint（OpenAI 专有）
- 认证逻辑（Organization header、Project header）通过 `buildHeaders` 注入

**DeepSeek adapter**（`deepseek.ts`，预计 ~40 行）：

```typescript
export const createDeepSeekProviderAdapter = (): AiProviderAdapter => {
  return createOpenAiCompatibleAdapter({
    provider: 'deepseek',
    resolveApiKey(input) {
      return getEnv(input.provider_config.api_key_env);
    },
    resolveBaseUrl(input) {
      return input.model_entry.base_url
        ?? input.provider_config.base_url
        ?? 'https://api.deepseek.com/v1';
    },
    capabilityOverrides: {
      disallowTempWithTopP: true,       // DeepSeek: temp 和 top_p 互斥
      maxTokensField: 'max_tokens',     // DeepSeek 使用 max_tokens
      maxStructuredOutput: 'json_object', // DeepSeek 不支持 json_schema
    }
  });
};
```

**Ollama adapter**（`ollama.ts`，预计 ~25 行，P2 实施时创建）：
- 与 DeepSeek 结构相同，仅 `base_url` 默认值不同（`http://localhost:11434/v1`）
- `api_key_env` 为 null（本地模型无需认证）

**方案 B 的优势**：
- 新增 OpenAI 兼容 provider 只需 25-30 行配置代码 + YAML 注册
- OpenAI 自身的 Responses API / Embeddings 逻辑不受影响，在其自己的 adapter 中覆盖
- 回归风险可控：重构 OpenAI adapter 时有完整测试覆盖，Chat Completions 路径行为不变
- 未来 3+ 个兼容 provider（DeepSeek + Ollama + Moonshot + ...）时不用反复复制粘贴
- `capabilityOverrides` 处理不同 provider 的 API 微妙差异，无需 fork adapter 代码

**方案 B 的成本**：
- 需要从 `openai.ts` 中拆出通用函数，有一定的重构工作量（约 0.5 天）
- 增加了 `openai_compatible.ts` 作为新的抽象层，对可读性有一定影响

**各 provider 的 quirk 配置**：

| 差异点 | OpenAI | DeepSeek | Ollama |
|--------|--------|----------|--------|
| temperature + top_p 同时设置 | OK | 报错（互斥） | OK |
| max_tokens 字段名 | `max_completion_tokens` | `max_tokens` | `max_tokens` |
| seed 参数 | OK | OK | 不支持 |
| structured_output | `json_schema` + `json_object` | `json_object` only | 大多不支持 |
| response_format 格式 | `{type: "json_object"}` | 同 OpenAI | 可能不支持 |
| tool_choice: "required" | OK | OK | 部分模型不支持 |

**配置注册**（`registry.ts` 内置默认，DeepSeek 示例）：
```yaml
providers:
  - provider: deepseek
    api_key_env: DEEPSEEK_API_KEY
    base_url: https://api.deepseek.com/v1
    enabled: true
models:
  - provider: deepseek
    model: deepseek-chat
    endpoint_kind: chat_completions
    capabilities:
      text_generation: true
      structured_output: json_object
      tool_calling: true
      vision_input: false
      embeddings: false
      rerank: false
      max_context_tokens: 131072
      max_output_tokens: 8192
    tags: [default, structured, deepseek-first]
    availability: active
```

**实施步骤**：
1. 从 `openai.ts` 提取 `openai_compatible.ts`（纯 Chat Completions，~350 行）
2. 重构 `openai.ts`：委托给 `openai_compatible`，覆盖认证 + Responses + Embeddings
3. 验证：现有 OpenAI 测试全部通过
4. 创建 `deepseek.ts`：~40 行工厂调用
5. 注册表添加 DeepSeek 提供者和模型定义

#### 2.2.1 Embedding Fallback 盲点

**现状**：`route_id: default.embedding` 的 primary 只有 `text-embedding-3-small`（OpenAI），fallback 为空。Anthropic 和 DeepSeek 都不提供 embedding API。

**修复**：在注册表中添加 Ollama embedding 模型作为 fallback。

```yaml
# 内置注册表新增
models:
  - provider: ollama
    model: nomic-embed-text
    endpoint_kind: embeddings
    capabilities:
      text_generation: false
      structured_output: none
      tool_calling: false
      vision_input: false
      embeddings: true
      rerank: false
      max_context_tokens: 8192
    tags: [local, embedding, self_hosted]
    availability: active

routes:
  - route_id: default.embedding
    # 在现有 fallback_models 数组中追加：
    fallback_models: [{ provider: ollama, model: nomic-embed-text }]
```

注意：Ollama embedding 模型产生的向量维度通常不同于 OpenAI（如 nomic-embed-text 是 768 维，text-embedding-3-small 是 1536 维）。VectorStore 的余弦相似度比对需要在维度一致的前提下进行。因此 embedding fallback 只在全部使用同一 provider 做 embedding 的场景下有效（即全用 OpenAI 或全用 Ollama），混用会导致维度不匹配。

**不做跨 provider embedding 混用**。如果 OpenAI 不可用且切换到 Ollama embedding，所有后续 embedding 也必须使用 Ollama（已有 vectors 失效，需要重新生成）。这是一个运维层面的约束，不在代码中自动处理。

### 2.3 Provider-level Fallback 验证

**现状**：gateway.ts 已实现完整的 fallback 链（primary → fallback candidates 遍历），但从未在 2+ 真实 provider 环境下验证过。

**验证要点**：
- 主 provider 超时 → fallback 启动
- 主 provider 鉴权失败 → 不 fallback（auth error 不可重试，正确行为）
- Circuit breaker open 后 → fallback 到下一个可用 provider
- Rate limiter queue full → 跳过当前 provider，尝试下一个
- 所有 provider 不可用 → 返回 `AI_ROUTE_NO_CANDIDATE`

**测试策略**：集成测试（mock HTTP server 模拟 provider 行为，不调用真实 API）

### 2.4 Rate Limit 动态校准

**现状**：`RateLimiter` 使用静态 `maxConcurrent`（默认 10），不感知 provider 实际限流状态。

**目标**：解析 provider HTTP 429 响应，动态调整 `maxConcurrent`。

**实现方案**：

```text
provider adapter 返回 429 → 解析响应头:
  - Retry-After: <seconds> → 降级窗口
  - x-ratelimit-remaining: <n> → 剩余配额
  - x-ratelimit-limit: <n> → 总配额

gateway 层接收 429 error → 通知 RateLimiter:
  - 立即将 maxConcurrent 降低到 min(active, 1)
  - 设置升压冷却期（如 30s 后尝试恢复到原值的 50%）
  - 逐步恢复（linear ramp-up）

新增类型:
  interface RateLimitHints {
    retryAfterSeconds?: number;
    remainingQuota?: number;
    limitQuota?: number;
  }

新增方法:
  RateLimiter.adjustFromHints(hints: RateLimitHints): void
```

**范围限制**：仅对明确返回 rate limit 头的 provider 生效（OpenAI、Anthropic、DeepSeek 都支持）。对不返回这些头的 provider，保持静态配置。

### 2.5 Tool Loop Token 预算管理

**现状**：`tool_loop_runner.ts` 只追踪 `max_rounds`（默认 5）和 `total_timeout_ms`（60s），不追踪 token 消耗。如果每轮 tool call 产生大量 token（如 cross-agent query 返回大段上下文），5 轮可能远超模型上下文窗口。

**目标**：在 tool loop 运行时累计 token 消耗，达到阈值时提前终止。

**实现方案**：

```text
ToolLoopConfig 新增字段:
  max_total_tokens?: number;        // 整个 loop 的 token 预算上限（默认取模型 max_context_tokens * 0.85）
  max_tool_result_tokens?: number;  // 单个 tool result 截断长度（默认 4096）
  token_count_mode: 'provider_reported' | 'estimated';

ToolLoopRunner.run() 变更:
  1. 每轮 gateway 返回后，从 response.usage 累计 input_tokens + output_tokens
  2. 对每个 tool result，估算其 token 数（字符数 / 4 作为粗略估计，或等待后续 tiktoken 集成）
  3. 累计 token 超过 max_total_tokens → 终止 loop，返回 fallback_on_exhaustion 策略
  4. 如果是 cross-agent tool call，特别关注 target agent 返回的 token 量
```

#### 2.5.1 Tokenizer 抽象层

直接集成 `tiktoken`，同时为 Anthropic 预留接口。

```typescript
// apps/server/src/ai/token_counter.ts

interface TokenCounter {
  /** 估算文本的 token 数。provider 用于选择 tokenizer。 */
  countTokens(text: string, provider: string, model: string): number;
  /** 估算 messages 数组的总 token 数 */
  countMessagesTokens(messages: AiMessage[], provider: string, model: string): number;
}

// 实现：TiktokenTokenCounter
// - provider='openai'/'deepseek'/任何 OpenAI 兼容 → tiktoken (cl100k_base / o200k_base)
// - provider='anthropic' → 字符数 / 3.5 估算（Anthropic tokenizer 在 JS 侧无原生库，后续引入 @anthropic-ai/tokenizer）
// - 其他 → 字符数 / 4 fallback
```

**`tiktoken` 依赖**：`tiktoken` npm 包，约 3MB（含 BPE 词典）。服务启动时惰性加载，不影响冷启动。

**模型 → encoding 映射**：

| 模型系列 | encoding |
|---------|----------|
| gpt-4.1 / gpt-4o / gpt-4-turbo | o200k_base |
| gpt-4 / gpt-3.5-turbo | cl100k_base |
| deepseek-chat / deepseek-reasoner | cl100k_base（OpenAI 兼容） |
| text-embedding-3-* | cl100k_base |

**Anthropic 处理**：当前用字符数 / 3.5 估算，误差约 ±15%（Anthropic 模型的 tokenizer 与 OpenAI 不同，但没有 JS 原生实现）。`@anthropic-ai/tokenizer` 包存在但需 Node 18+，可后续集成。在 tool loop 场景下，±15% 误差可接受——预算阈值本身带 15% 安全 margin。

#### 2.5.2 Anthropic thinking tokens

Anthropic 启用 `thinking` 能力时，thinking tokens 计入 context window 但不包含在标准 `usage.output_tokens` 中。Anthropic 单独报告 `usage.thinking_tokens`（或 `usage.output_tokens_details.thinking_tokens`）。

**TokenCounter 处理**：对 Anthropic provider，从 response 中提取 thinking tokens 并加入累计。Tool loop token 预算必须纳入 thinking tokens，否则会低估 Anthropic 的实际 context 消耗。

```typescript
interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  thinking_tokens?: number;  // 新增：Anthropic thinking tokens
  total_tokens?: number;
}
```

#### 2.5.3 Tool loop 集成

ToolLoopRunner 在每轮后调用 `tokenCounter.countMessagesTokens()` 累计上下文 token 消耗，超过阈值提前终止。

**ToolLoopConfig 新增字段**：
```typescript
max_total_tokens?: number;        // 默认取模型 max_context_tokens * 0.85
max_tool_result_tokens?: number;  // 单个 tool result 截断长度，默认 4096
```

### 2.6 Response Caching

**目标**：对确定性高的推理请求进行缓存，减少重复 API 调用成本。

**核心认知**：`messages[]` 已经编码了完整的推理上下文（agent state、周围实体、世界规则、对话历史等）。不同 agent 的 messages 几乎不可能碰撞。缓存隔离层的目的是安全边界和审计保障，而非区分不同请求。

#### 2.6.1 Cache Key 粒度 — 方案 B：pack 隔离，agent 不入 key

**Cache key 组成**：
```text
cache_key = hash({
  provider,
  model,
  messages[],
  temperature,    // temperature=0 才缓存
  response_mode,
  structured_output_schema?,
  tools?,
  tool_policy?,
  pack_id,        // pack 间隔离，pack 内 agent 共享
  task_type
})
```

**`pack_id` 入 key 的理由**：
- 语义安全边界。不同世界包的 NPC 决策不可互相污染，即使 prompt assembly 有 bug 导致 messages 意外碰撞
- 成本极低（一个字符串 hash，几乎不计入计算开销）

**`agent_id` 不入 key 的理由**：
- `messages[]` 已经区分了不同 agent 的请求（agent state、role、周围实体不同导致 messages 不同）
- 如果两个不同 agent 的 messages 碰撞了 -> 这说明 prompt assembly 有 bug，应该暴露，不应该靠 agent_id 防御
- 额外加 agent_id 只会降低命中率（10 个同质 agent 做相似决策被分成 10 个独立缓存项）换不来实际安全增益

**三种方案对比**：

| | A: 完整隔离 | B: pack 隔离（选择） | C: 无隔离 |
|---|---|---|---|
| key 内容 | +pack_id +agent_id | +pack_id | 仅 messages + params |
| 命中率 | 低（agent 间不共享） | 中（pack 内 agent 共享） | 高（跨 pack 共享） |
| 安全风险 | 最低 | 低 | 中 |
| 审计追溯 | 最清晰 | 中等 | 弱 |
| agent_id 冗余 | 是（messages 已区分） | 否 | 否 |

#### 2.6.2 TTL 策略 — 方案 B：per-task-type TTL

**四种方案对比**：

| | A: 固定 TTL | B: per-task-type（选择） | C: Sliding TTL | D: LRU-only |
|---|---|---|---|---|
| 实现复杂度 | 最低 | 低 | 中 | 最低 |
| 合理性 | 差 | 好 | 中 | 差 |
| 适用场景 | 不需要区分时效性 | 不同 task 时效性差异大 | 访问模式不均匀 | 使用场景简单 |

- **A（固定 300s）被否决**：agent_decision 应该在 60s 内过期（tick 推进、世界状态变化），embedding 可以存活 3600s（语义向量不变）。统一值必然"对某些 task 太长、对另一些太短"
- **C（Sliding TTL）被否决**：每次命中刷新 TTL。高频但已过时的缓存项会存活过久。在模拟场景下，一个 agent_decision 被频繁命中 = agent 一直在做相同决策 = 本身可能是 bug，不应让缓存掩盖
- **D（LRU-only）被否决**：低流量时 stale entry 永远不会被 evict。系统空闲 1 小时后，一个 tick 触发推理可能命中 1 小时前的缓存，当时世界状态已完全不同
- **B（per-task-type TTL）选择**：不同 task 的时效性需求不同

**TTL 默认值**：

```typescript
// 实现：Map<AiTaskType, number> 做覆盖，默认 fallback 到 120s
const TASK_TTL_OVERRIDES: Partial<Record<AiTaskType, number>> = {
  agent_decision: 60,        // tick 推进快，决策很快过时
  intent_grounding_assist: 60,
  context_summary: 300,      // 摘要半衰期更长
  memory_compaction: 600,    // 内存压缩低频且稳定
  embedding: 3600,           // 语义向量几乎不变
  moderation: 120,
  classification: 180,
};

const CACHE_DEFAULT_TTL_MS = 120_000; // 2 分钟
```

后续根据实际命中率和世界状态漂移程度调参。

#### 2.6.3 缓存范围

- **缓存**：`temperature=0` + `response_mode=json_schema` 的请求（deterministic）
- **不缓存**：`temperature > 0`、`tool_call` 模式、`streaming` 模式、包含 `conversation_history` track 的请求

#### 2.6.4 实现方案

```text
新增组件: ai/cache.ts
  - PromptCache 接口: get(key) → AiProviderAdapterResult | null, set(key, result, ttlMs)
  - 默认实现: InMemoryPromptCache (LRU, max 500 entries)
  - 预留接口: RedisPromptCache (未来分布式场景)

TTL 解析:
  - 查 TASK_TTL_OVERRIDES[task_type]
  - 命中 → 使用该值
  - 未命中 → fallback CACHE_DEFAULT_TTL_MS (120s)
  - route.defaults 可通过 cache_ttl_ms 覆盖

集成点: gateway.ts
  - 在 adapter.execute() 之前查询缓存
  - 命中 → 直接返回缓存结果（标记 cached: true）
  - 未命中 → 正常调用 → 写入缓存
```

#### 2.6.5 缓存命中时的审计记录

缓存命中跳过了 provider 调用，`recordAiInvocation()` 不会被调用。缓存推理在 `AiInvocationRecord` 中完全不可见，导致审计黑洞。

**修复**：`ModelGatewayResponse` 新增 `cached: boolean` 字段。缓存命中时构造 response 并写入 `AiInvocationRecord`，标记 `provider: 'cache'`，`usage` 中 `input_tokens` / `output_tokens` 沿用原缓存响应值（记录节约了多少 token），`latency_ms` 设为实际查缓存耗时（通常 < 5ms）。

```typescript
// ModelGatewayResponse 新增字段
cached?: boolean;

// AiInvocationRecord 写入
{
  provider: 'cache',
  model: response.model,
  usage: { ...response.usage, cost_usd: 0 },  // 缓存命中零成本
  latency_ms: cacheLookupMs,
  cached: true
}
```

**类型影响**：`packages/contracts/src/ai_shared.ts` 的 `AiInvocationRecord` schema 需新增 `cached` 字段（可选 boolean）。

### 2.7 Streaming / SSE 支持

**目标**：provider adapter 支持流式响应，gateway 透传 SSE。

**范围**：后端架构变更（adapter 流式接口 + gateway SSE endpoint）。前端 SSE 消费不在本次范围。Tool loop 不使用流式（串行阻塞模型不兼容流式，仅非 tool 请求使用流式）。

#### 2.7.1 架构路径

当前非流式路径：`AiTaskService.runTask()` → `ModelGateway.execute()` → `Adapter.execute()` → `ModelGatewayResponse`

流式路径绕过 AiTaskService（task 层逻辑厚重，不适合流式场景）。SSE endpoint 直接组装 gateway request 并调用新增的 `ModelGateway.executeStream()`：

```
POST /api/inference/stream
  → 组装 ModelGatewayRequest（在 route handler 中完成基础校验）
  → ModelGateway.executeStream(request)
    → Adapter.executeStream(input) → AsyncIterable<AiProviderAdapterChunk>
    → 每个 chunk 格式化为 SSE data 事件写回客户端
```

**不与 AiTaskService 集成**：AiTaskService 的 tool resolution、prompt assembly、decoder 等逻辑对一次完整推理（有头有尾）设计，不适合增量流式场景。

#### 2.7.2 Adapter 流式接口

`AiProviderAdapter` 新增可选方法 `executeStream`。不支持流式的 adapter（如 mock）不实现此方法，gateway 调用前检查是否存在。

```typescript
// providers/types.ts

type AiProviderAdapterChunk =
  | { type: 'start'; usage?: { input_tokens?: number } }
  | { type: 'text_delta'; text: string }
  | { type: 'thinking_delta'; text: string }
  | { type: 'tool_call_start'; index: number; call_id?: string; name: string }
  | { type: 'tool_call_delta'; index: number; arguments_fragment: string }
  | { type: 'finish'; finish_reason: string; usage?: TokenUsage }
  | { type: 'error'; code: string; message: string };

interface AiProviderAdapter {
  readonly provider: string;
  execute(input: AiProviderAdapterRequest): Promise<AiProviderAdapterResult>;
  executeStream?(input: AiProviderAdapterRequest): AsyncIterable<AiProviderAdapterChunk>;
}
```

**Chunk 类型说明**：
- `start`：流开始信号。Anthropic 的 `message_start` 事件携带 `usage.input_tokens`，在此传递。OpenAI 流式无此事件（直接开始 text_delta）
- `text_delta`：文本增量片段
- `thinking_delta`：Anthropic thinking 文本增量（thinking 启用时在 text_delta 之前出现）
- `tool_call_start`：一个新 tool call 开始（Anthropic: `content_block_start` with `type: 'tool_use'`，OpenAI: 首个带 `delta.tool_calls[0].function.name` 的 chunk）
- `tool_call_delta`：tool call arguments 的增量片段（OpenAI 按 fragment 到达，Anthropic 按 `input_json_delta`）
- `finish`：流结束，携带最终 `finish_reason` 和 `usage`
- `error`：流中错误

**不支持流式的 adapter**：gateway 在 `executeStream` 中检查 adapter 是否实现了此方法。未实现时，退化为非流式调用（内部调用 `adapter.execute()`，将完整结果作为单个 `text_delta` + `finish` 发送）。

#### 2.7.3 各 provider 原生事件映射

**OpenAI Chat Completions streaming**：
```
SSE chunk: {"choices":[{"delta":{"content":"Hello"}}]}
  → text_delta: { text: "Hello" }

SSE chunk: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather"}}]}}]}
  → tool_call_start: { index: 0, name: "get_weather" }

SSE chunk: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"city\":"}}]}}]}
  → tool_call_delta: { index: 0, arguments_fragment: "{\"city\":" }

SSE chunk: {"choices":[{"finish_reason":"stop"}],"usage":{...}}
  → finish: { finish_reason: "stop", usage: {...} }

SSE chunk: [DONE]
  → 流结束（不产生额外 chunk）
```

**Anthropic Messages streaming**：
```
event: message_start
data: {"message":{"usage":{"input_tokens":150}}}
  → start: { usage: { input_tokens: 150 } }

event: content_block_start
data: {"content_block":{"type":"text","text":""}}
  → 首个 text block，不产生 chunk（等待 content_block_delta）

event: content_block_start
data: {"content_block":{"type":"tool_use","id":"toolu_xxx","name":"get_weather"}}
  → tool_call_start: { index: 0, call_id: "toolu_xxx", name: "get_weather" }

event: content_block_delta
data: {"delta":{"type":"text_delta","text":"Hello"}}
  → text_delta: { text: "Hello" }

event: content_block_delta
data: {"delta":{"type":"thinking_delta","thinking":"..."}}
  → thinking_delta: { text: "..." }

event: content_block_delta
data: {"delta":{"type":"input_json_delta","partial_json":"{\"city\":"}}
  → tool_call_delta: { index: 0, arguments_fragment: "{\"city\":" }

event: message_delta
data: {"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":80}}
  → finish: { finish_reason: "stop", usage: { output_tokens: 80 } }
```

**OpenAI Chat Completions vs Responses API streaming**：
- Chat Completions streaming 由 `openai_compatible.ts` 实现，覆盖 OpenAI-compatible + DeepSeek + Ollama
- Responses API streaming（OpenAI 专有，格式完全不同）**不在本次范围**，标记为后续扩展

#### 2.7.4 Tool call 增量累积

流式模式下 tool_calls 增量到达，adapter 内部维护累积状态：

```
OpenAI adapter 累积逻辑:
  toolCallsBuffer: Map<index, { name, call_id, arguments_accumulated }>
  收到 tool_call_start → 创建 buffer entry
  收到 tool_call_delta → append arguments_fragment
  收到 finish → 从 buffer 组装完整 tool_calls，附加到 finish chunk 的 metadata

Anthropic adapter 累积逻辑:
  同上，但从 content_block_start (tool_use) 和 input_json_delta 提取
```

**gateway 层处理**：gateway 收到流式 chunk 后直接透传给 SSE。如果 tool_calls 完成（finish 到达时 buffer 非空），gateway 将累积的 tool_calls 记录到最终的 `AiInvocationRecord` 中。不会对 tool call chunk 触发 tool loop。

#### 2.7.5 Streaming observability

流式调用的 `AiInvocationRecord` 在流**开始前**写入一条 pending 记录，流**结束后**更新：

```
1. 流开始 → recordAiInvocation(pending): status='streaming', usage=null
2. 流结束 → recordAiInvocation(upsert): status='completed', usage=最终数据
3. 流中断 → recordAiInvocation(upsert): status='failed', error=中断原因
```

`AiInvocationRecord` schema 新增 `status: 'streaming'` 枚举值。`latency_ms` 从流开始到结束计算。

#### 2.7.6 SSE 基础设施

Express route handler 模式：

```typescript
// routes/inference.ts — POST /api/inference/stream
app.post('/api/inference/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'       // 禁用 nginx 缓冲
  });

  const abortController = new AbortController();

  req.on('close', () => {
    abortController.abort();         // 客户端断开 → 取消 provider 流
  });

  try {
    const gateway = getGateway();
    for await (const chunk of gateway.executeStream(request, abortController.signal)) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', code: 'STREAM_ERROR', message: String(err) })}\n\n`);
    res.end();
  }
});
```

**AbortController 传递**：`executeStream()` 接受 `AbortSignal`，传递给底层的 `fetch()`。客户端断开时立即取消 provider 连接，不浪费 token。

#### 2.7.7 实施范围与排除项

**纳入本次**：
- `AiProviderAdapter.executeStream` 接口定义
- `openai_compatible.ts` Chat Completions streaming（OpenAI + DeepSeek + Ollama）
- `anthropic.ts` Messages streaming
- `ModelGateway.executeStream()` 方法
- `POST /api/inference/stream` SSE endpoint
- Streaming observability（pending → upsert 模式）

**排除**（后续按需）：
- OpenAI Responses API streaming
- Tool loop 流式模式（仅非 tool 请求使用流式）
- 前端 SSE 消费
- Ollama streaming（openai_compatible 自动覆盖，但需本地验证）

### 2.8 Ollama / Local Provider Adapter

**目标**：支持本地模型（Ollama、LM Studio、vLLM 等 OpenAI 兼容服务器）。

**实现方案**：复用 `openai_compatible.ts` 通用 adapter，~25 行工厂函数。Ollama 默认提供 OpenAI 兼容 API（`/v1/chat/completions`）。

**注意**：`api_key_env` 为 null（本地模型无需认证），`enabled: false`（默认禁用，显式开启）。

**配置注册**：见 2.2 节 DeepSeek 同模式，仅 provider name / base_url / model 不同。

## 3. 实施顺序与依赖

```
Phase 0 (前置修复, 0.5 天)
  └── 0. Circuit breaker / rate limiter 生命周期修复 ── cbMap/rlMap 提升到闭包

Phase 1 (P0, 约 5 天)
  ├── 1a. OpenAI 兼容通用 adapter 重构 ── 提取 openai_compatible.ts，含 capabilityOverrides (0.5 天)
  ├── 1b. Anthropic adapter ─────────────── 独立实现 + system prompt 提取 + 折中 structured output (2-3 天)
  ├── 1c. DeepSeek adapter ──────────────── ~40 行工厂 + capabilityOverrides + YAML 注册 (0.5 天)
  ├── 1d. Ollama adapter ────────────────── ~25 行工厂 + embedding 模型注册 (0.5 天)
  └── 2.  Provider fallback 验证 ─────────── 集成测试 + circuit breaker 状态保持验证 (1 天)

Phase 2 (P1, 约 5 天)
  ├── 3. Rate limit 动态校准 ─────────────┐
  ├── 4. Tool loop token 预算 ────────────┤ 可并行
  └── 5. Response caching ────────────────┘ (含缓存审计记录)

Phase 3 (P2, 约 5 天)
  └── 6. Streaming/SSE ──────────────────── adapter 流式接口 + gateway SSE 透传
```

Phase 0 + Phase 1 共约 5.5 天。每个 phase 内部包含对应的单元测试和集成测试编写。

## 5. 测试策略

### 5.1 测试层级

| 层级 | 覆盖范围 | 工具 | CI |
|------|---------|------|----|
| **单元测试** | 每个新 adapter 的 request 构建、response 解析、错误处理、capabilityOverrides | vitest (unit config, parallelism ON) | 是 |
| **集成测试** | 多 provider fallback 链、circuit breaker 状态保持、rate limiter 动态校准、缓存命中/未命中 | vitest (integration config, serial) | 是 |
| **Contract 测试** | `openai_compatible.ts` 重构前后 OpenAI Chat Completions 行为一致 | vitest (unit) | 是 |

### 5.2 各组件测试要点

**Anthropic adapter**：
- system/developer message 提取到顶层 system 参数（验证 messages 数组不残留 system role）
- `json_schema` 模式：`__structured_output` tool 正确生成，`tool_choice` 正确设置
- `json_object` 模式：提示词注入正确，解析失败 → 重试一次
- tool_use response 解析（`content[1].tool_use.input`）
- streaming chunk 解析（Anthropic SSE 事件类型）
- thinking tokens 提取
- 鉴权失败 → `AI_PROVIDER_AUTH_MISSING`，不可重试

**OpenAI compatible adapter**：
- 重构前后 Chat Completions 路径输入/输出完全一致（contract test）
- DeepSeek quirk：temperature + top_p 同时传入 → top_p 被丢弃（或报错）
- Ollama quirk：seed 参数不应出现在 request body 中
- `maxTokensField` 映射：DeepSeek 使用 `max_tokens`，OpenAI 使用 `max_completion_tokens`

**Circuit breaker 修复**：
- 同一 provider 连续 5 次失败 → 第 6 次被拒绝（cb open）
- open 30s 后 → half_open → 探测请求成功 → closed
- 验证 cbMap 在 `execute()` 多次调用间保持状态（最关键）

**Multi-provider fallback**：
- 使用 mock HTTP server（如 `nock` 或 `msw`），不调用真实 API
- 场景 1：OpenAI 返回 500 → Anthropic 接管 → 成功
- 场景 2：OpenAI 鉴权失败（401）→ 不 fallback（auth 不可重试）
- 场景 3：OpenAI circuit breaker open → 跳过 → DeepSeek 接管
- 场景 4：所有 provider 不可用 → `AI_ROUTE_NO_CANDIDATE`

**Rate limiter 动态校准**：
- Mock 429 响应含 `Retry-After: 30` → `maxConcurrent` 降为 1
- 30s 冷却期后 → `maxConcurrent` 恢复到原值的 50%
- 逐步恢复（每 60s 提升 1，直到原值）

**Caching**：
- 相同 prompt hash → 命中，不调用 adapter → `cached: true`
- 不同 pack_id → 不命中（pack 隔离）
- TTL 过期 → 不命中
- 缓存命中写 `AiInvocationRecord`（`provider: 'cache'`）
- temperature > 0 → 不缓存
- `tool_call` 模式 → 不缓存

### 5.3 不纳入 CI 的测试

- 真实 API 调用的 end-to-end 测试（需要 API key，本地手动运行）
- 性能基准测试（100 agent 并发推理延迟）
- 长时间运行稳定性（24h 连续 tick）
- Ollama 本地集成测试（需要本地 Ollama 服务）

以下问题需要在多轮讨论中确定：

1. **已解决**：~~Token 计数精度~~ → 集成 `tiktoken`，OpenAI 兼容用 o200k_base/cl100k_base，Anthropic 用字符数/3.5 估算（见 2.5.1）
2. **已解决**：~~Anthropic structured output 策略~~ → 折中方案：`json_schema` 走 tool_use，`json_object` 走提示词注入（见 2.1）
3. **已解决**：~~DeepSeek adapter 方案选择~~ → 方案 B：通用 `openai_compatible.ts` adapter（见 2.2）
4. **已解决**：~~Caching cache key 粒度~~ → 方案 B：pack 隔离，agent 不入 key（见 2.6.1）
5. **已解决**：~~Caching TTL 策略~~ → 方案 B：per-task-type TTL，默认 120s（见 2.6.2）
6. **已解决**：~~Streaming 时间线~~ → 后端架构准备（Phase 1 + Phase 2）纳入本次实施，Phase 3-4 后续按需（见 2.7）

---

## 附录：现有设计文档参考

- `docs/subsystems/AI_GATEWAY.md` — AI Gateway 当前架构
- `.limcode/archive/historical/design/multi-model-gateway-and-unified-ai-task-contract-design.md` — 多模型网关历史设计
- `.limcode/archive/design/ai-tool-calling-enablement.md` — Tool Calling 设计
- `.limcode/archive/design/ai-elasticity-circuit-breaker-rate-limiter-backoff.md` — 弹性层设计
- `.limcode/archive/design/ai-registry-hot-reload.md` — 注册表热加载设计

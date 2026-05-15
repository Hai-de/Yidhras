# 配置系统参考 (ConfigW)

本文档描述 Yidhras 的运行时配置系统 (ConfigW)，包括分层合并语义、各配置域职责、热重载策略、AI 模型注册表、推理上下文配置、多轮对话格式配置以及世界包配置体系。不涉及构建工具配置（TypeScript、ESLint、Vitest 等），也不涉及 Prisma 数据库迁移配置 —— 后者见 [DB_OPERATIONS.md](DB_OPERATIONS.md)。

## 1. 配置加载架构

### 1.1 合并层级

ConfigW 运行时配置由以下层级自底向上深度合并（`deepMerge`）而成：

```
Layer 5: 环境变量覆盖 (process.env)
Layer 4: data/configw/local.yaml          — gitignored，本机密级覆盖
Layer 3: data/configw/{env}.yaml           — 环境层 (development / production / test)
Layer 2: data/configw/conf.d/*.yaml        — 域碎片文件（按文件名排序加载）
Layer 1: 代码内置默认值                      — apps/server/src/config/domains/*.ts
```

合并策略为对象级递归合并——子对象会深度合并，标量值直接覆盖。数组不作合并，直接用高层级覆盖低层级。`undefined` 值在合并时被跳过（不会将已有值置空）。

### 1.2 文件布局

| 路径 | 用途 |
|------|------|
| `apps/server/src/config/domains/*.ts` | 内置默认值 + Zod schema 定义，编译进 server 包 |
| `apps/server/templates/configw/` | 首次启动时的脚手架模板，复制到 `data/configw/` |
| `data/configw/` | 活跃配置目录（运行时实际读取） |
| `data/configw/conf.d/*.yaml` | 域碎片：每个文件对应一个配置域 |
| `data/configw/{development,production,test}.yaml` | 环境层覆盖：根据 `APP_ENV` 或 `NODE_ENV` 选择加载 |
| `data/configw/local.yaml` | 本机覆盖：最深合并层，不会被 git 追踪 |

首次启动时，`ensureRuntimeConfigScaffold` 会将模板目录下的所有文件复制到 `data/configw/`，除非目标文件已存在。这意味着首次部署后，可以直接编辑 `data/configw/` 下的文件进行定制。

### 1.3 环境选择

`APP_ENV` 环境变量决定加载哪个环境覆盖文件（`development` / `production` / `test`）。若未设置 `APP_ENV`，则降级使用 `NODE_ENV`。若两者均未设置，默认为 `development`。

`data/configw/{env}.yaml` 文件只在上层覆盖有差异的环境变量。例如 `test.yaml` 仅设置 `app.env: test`、`world.preferred_pack` 和 `startup.allow_degraded_mode`，其余字段从碎片和默认值继承。

## 2. 配置域索引

### 2.1 域一览

| 域文件 | 安全分级 | 热重载 | 职责 |
|--------|----------|--------|------|
| `app.yaml` | safe | 是 | 应用名、环境标识、HTTP 端口 |
| `paths.yaml` | dangerous | 否 | 世界包目录、资源目录、AI 模型配置路径 |
| `operator.yaml` | critical | 否 | JWT 密钥与过期策略、bcrypt 轮数、root 默认密码 |
| `plugins.yaml` | dangerous | 否 | 插件沙箱等级、manifest 尺寸/深度/路由上限、启用警告策略 |
| `world.yaml` | caution | 是 | 首选世界包、自举（bootstrap）策略 |
| `startup.yaml` | dangerous | 否 | 降级模式允许、缺包/缺世界包时失败策略 |
| `database.yaml` | dangerous | 否 | SQLite 连接参数（busy timeout、WAL checkpoint、同步模式） |
| `logging.yaml` | safe | 是 | 日志级别 (debug/info/warn/error)、输出格式 (text/json) |
| `clock.yaml` | caution | 是 | 单调时间强制执行、单次 tick 最大步进 |
| `world_engine.yaml` | dangerous | 否 | Rust world_engine 侧车超时、二进制路径、自动重启 |
| `scheduler.yaml` | caution | 是 | 模拟循环间隔、调度器并发、租约、自动重平衡、Agent 决策内核 |
| `prompt_workflow.yaml` | caution | 是 | Prompt 工作流各 profile 的 token 预算与安全边际 |
| `runtime.yaml` | dangerous | 否 | 多包运行时：最大加载包数、启动模式、自举列表 |
| `features.yaml` | safe | 是 | 功能开关：AI Gateway、推理追踪、通知、实验特性 |
| `conversation.yaml` | —（无模板） | — | 多轮对话格式 profile：transcript 模式、消息组装、压缩策略 |

### 2.2 安全分级说明

配置域按可否运行时变更分为四个安全等级：

| 等级 | 含义 | 生效方式 |
|------|------|----------|
| `safe` | 可即时热重载 | 修改 `conf.d/*.yaml` 后缓存重置，下次读取立即生效 |
| `caution` | 运行时生效但记录告警 | 修改后缓存重置，运行时读取新值，日志中标记变更 |
| `dangerous` | 需重启服务 | 写入文件后，需进程重启才能生效 |
| `critical` | 需操作员显式确认 + 重启 | `operator` 域专属，涉及认证密钥 |

安全分级由 `apps/server/src/config/tiers.ts` 中的 `CONFIG_DOMAIN_TIERS` 映射表定义。未显式列出的路径默认为 `dangerous`。

### 2.3 配置文件热重载

服务启动时，`ConfigWatcher` 监听 `data/configw/conf.d/` 目录的文件变更事件。当检测到 `.yaml` / `.yml` 文件的内容变化（通过 mtime + size 快照去重），500ms 防抖后清除运行时配置缓存。但只有 `safe` 级别的配置域才能真正"热生效"——因为在 `updateDomainConfig` 中仅对 `safe` 级别调用 `resetRuntimeConfigCache()` 并返回 `hotReloaded: true`。

## 3. 环境变量覆盖

所有配置域都可以通过环境变量覆盖。环境变量是合并层级的最顶层（Layer 5），优先级高于所有 YAML 文件。

完整的环境变量映射表见 `apps/server/src/config/runtime_config.ts` 中的 `buildEnvironmentOverrides` 函数。以下是常用覆盖项：

| 环境变量 | 对应配置路径 |
|----------|-------------|
| `PORT` | `app.port` |
| `APP_ENV` / `NODE_ENV` | `app.env` |
| `WORLD_PACK` | `world.preferred_pack` |
| `WORLD_PACKS_DIR` | `paths.world_packs_dir` |
| `AI_MODELS_CONFIG_PATH` | `paths.ai_models_config` |
| `SQLITE_BUSY_TIMEOUT_MS` | `database.sqlite.busy_timeout_ms` |
| `SQLITE_SYNCHRONOUS` | `database.sqlite.synchronous` |
| `OPERATOR_JWT_SECRET` | `operator.auth.jwt_secret` |
| `OPERATOR_JWT_EXPIRES_IN` | `operator.auth.jwt_expires_in` |
| `OPERATOR_ROOT_DEFAULT_PASSWORD` | `operator.root.default_password` |
| `SIM_LOOP_INTERVAL_MS` | `scheduler.runtime.simulation_loop_interval_ms` |
| `WORLD_ENGINE_TIMEOUT_MS` | `world_engine.timeout_ms` |
| `AI_GATEWAY_ENABLED` | `features.ai_gateway_enabled` |
| `RUNTIME_MULTI_PACK_MAX_LOADED_PACKS` | `runtime.multi_pack.max_loaded_packs` |
| `RUNTIME_MULTI_PACK_START_MODE` | `runtime.multi_pack.start_mode` |
| `STARTUP_ALLOW_DEGRADED_MODE` | `startup.allow_degraded_mode` |
| `SCHEDULER_AGENT_LIMIT` | `scheduler.agent.limit` |
| `SCHEDULER_LEASE_TICKS` | `scheduler.lease_ticks` |
| `MEMORY_TRIGGER_ENGINE_MODE` | `scheduler.memory.trigger_engine.mode` |

布尔类型环境变量接受 `1` / `true` / `yes` / `on`（true）和 `0` / `false` / `no` / `off`（false），大小写不敏感。

## 4. 各配置域详解

### 4.1 app — 应用基础

```yaml
app:
  name: "Yidhras"
  env: "development"   # development | production | test
  port: 3001
```

- `env` 同时控制环境覆盖文件的加载和 `validateProductionSecrets` 中的密钥安全检查：非 development/test 环境中，若 JWT secret 或 root 密码仍为默认值，服务将拒绝启动

### 4.2 paths — 文件系统路径

```yaml
paths:
  world_packs_dir: "data/world_packs"
  assets_dir: "data/assets"
  plugins_dir: "data/plugins"
  ai_models_config: "apps/server/config/ai_models.yaml"
```

所有路径均相对于工作区根目录解析。可通过 `WORLD_PACKS_DIR` 和 `AI_MODELS_CONFIG_PATH` 环境变量覆盖。

### 4.3 operator — 操作员认证

```yaml
operator:
  auth:
    jwt_secret: "changeme-..."   # 最少 16 字符，生产环境必须更换
    jwt_expires_in: "24h"
    bcrypt_rounds: 12            # 范围 4-16
  root:
    default_password: "changeme-root-password"  # 最少 8 字符
```

此域为 `critical` 级。JWT secret 和 root 密码在 API 返回中自动脱敏（只显示前 4 字符 + `***`）。

### 4.4 plugins — 插件沙箱与治理

```yaml
plugins:
  enable_warning:
    enabled: true
    require_acknowledgement: true
  sandbox:
    capability_level: "full"           # readonly | pack_scoped | full
    max_manifest_size_bytes: 1048576
    max_manifest_depth: 20
    max_routes: 16
    max_context_sources: 32
    warn_on_full_access: true
  dependency:
    strict: false
```

沙箱能力等级：
- `readonly`：仅读取 pack 信息 + 通知推送，无 Prisma/模拟控制
- `pack_scoped`：同 readonly + 当前 pack 数据读写 + HTTP 上下文
- `full`：完整 AppContext 访问（向后兼容默认值）

`warn_on_full_access: true` 时，每个 `full` 级插件注册时都会在日志中打印风险警告。

### 4.5 world — 世界包选择与自举

```yaml
world:
  preferred_pack: "death_note"
  preferred_opening: null          # 可选，指定开局场景 ID
  bootstrap:
    enabled: true
    target_pack_dir: "death_note"
    template_file: "data/configw/templates/world-pack/death_note.yaml"
    overwrite: false
```

自举（bootstrap）：当 `enabled: true` 时，如果 `target_pack_dir` 指定的目录不存在或为空，服务自动从 `template_file` 创建世界包。`overwrite: true` 会强制覆盖已有包。

### 4.6 startup — 启动策略

```yaml
startup:
  allow_degraded_mode: true          # 无有效世界包时仍允许启动
  fail_on_missing_world_pack_dir: false
  fail_on_no_world_pack: false
```

开发环境建议全宽松；生产环境 (`production.yaml`) 默认三项分别为 `false` / `true` / `true`，即缺失世界包目录或无可用包时拒绝启动。

### 4.7 database — 数据库连接

```yaml
database:
  provider: "sqlite"                   # sqlite | postgresql
  sqlite:
    busy_timeout_ms: 5000
    wal_autocheckpoint_pages: 1000
    synchronous: "NORMAL"              # OFF | NORMAL | FULL | EXTRA
```

数据库 provider 和文件路径由 Prisma 侧的 `DATABASE_URL` 环境变量和 `PRISMA_DB_PROVIDER` 控制（见 [DB_OPERATIONS.md](DB_OPERATIONS.md)）。此处仅控制 SQLite 连接级参数。

### 4.8 logging — 日志

```yaml
logging:
  level: "info"                        # debug | info | warn | error
  format: "text"                       # text（人类可读）| json（结构化输出）
```

生产环境建议 `json` 格式。

### 4.9 clock — 时钟安全

```yaml
clock:
  monotonic_enabled: true              # 禁止时间倒流
  max_step_ticks: 100000               # 单次 tick() 最大步进量
```

`monotonic_enabled: true` 确保模拟时间只能向前流动。关闭可能导致事件因果混乱和状态不一致。`max_step_ticks` 防止误操作导致模拟时间跳跃过大。

### 4.10 world_engine — Rust 世界引擎侧车

```yaml
world_engine:
  timeout_ms: 500
  binary_path: "apps/server/rust/world_engine_sidecar/target/debug/world_engine_sidecar"
  auto_restart: true
```

控制 Rust world_engine 侧车进程的通信超时、二进制路径和崩溃自动重启策略。

### 4.11 scheduler — 调度器

调度器是最复杂的配置域。完整结构：

```yaml
scheduler:
  enabled: true
  runtime:
    simulation_loop_interval_ms: 1000   # 模拟循环间隔
  lease_ticks: 5                         # 分区租约长度
  entity_concurrency:
    default_max_active_workflows_per_entity: 1
    max_entity_activations_per_tick: 1
    allow_parallel_decision_per_entity: false
    allow_parallel_action_per_entity: false
    event_followup_preempts_periodic: true
  tick_budget:
    max_created_jobs_per_tick: 32
    max_executed_decisions_per_tick: 16
    max_dispatched_actions_per_tick: 16
  automatic_rebalance:
    backlog_limit: 2
    max_recommendations: 1
    max_apply: 1
  runners:
    decision_job:
      batch_limit: 5
      concurrency: 2
      lock_ticks: 5
    action_dispatcher:
      batch_limit: 5
      concurrency: 1
      lock_ticks: 5
  observability:
    default_query_limit: 20
    max_query_limit: 100
    summary:
      default_sample_runs: 20
      max_sample_runs: 100
    trends:
      default_sample_runs: 20
      max_sample_runs: 100
    operator_projection:
      default_sample_runs: 20
      max_sample_runs: 100
      default_recent_limit: 5
      max_recent_limit: 20
  agent:
    limit: 5                             # 最大并发 Agent 数
    cooldown_ticks: 3
    max_candidates: 20
    decision_kernel:
      mode: "rust_primary"
      timeout_ms: 500
      binary_path: "apps/server/rust/scheduler_decision_sidecar/target/debug/scheduler_decision_sidecar"
      auto_restart: true
    signal_policy:
      event_followup:
        priority_score: 30
        delay_ticks: 1
        coalesce_window_ticks: 2
        suppression_tier: "high"
      relationship_change_followup: { priority_score: 20, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }
      snr_change_followup: { priority_score: 10, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }
      overlay_change_followup: { priority_score: 8, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }
      memory_change_followup: { priority_score: 9, delay_ticks: 1, coalesce_window_ticks: 2, suppression_tier: "low" }
    recovery_suppression:
      replay: { suppress_periodic: true, suppress_event_tiers: ["low"] }
      retry:  { suppress_periodic: true, suppress_event_tiers: ["low"] }
  memory:
    trigger_engine:
      mode: "rust_primary"
      timeout_ms: 500
      binary_path: "apps/server/rust/memory_trigger_sidecar/target/debug/memory_trigger_sidecar"
      auto_restart: true
```

关键子域：
- **entity_concurrency**：控制单个实体的并行工作流和每 tick 激活上限
- **tick_budget**：每个 tick 的 job 创建/决策执行/动作派发总量上限
- **automatic_rebalance**：调度器跨分区自动重平衡参数
- **runners**：决策任务和动作派发器的批处理大小、并发数、锁租约
- **agent.signal_policy**：各类信号的优先级分数、延迟 tick、合并窗口和压制等级
- **agent.recovery_suppression**：重放/重试恢复期间对周期信号和事件信号的压制策略

### 4.12 prompt_workflow — Prompt 工作流预算

```yaml
prompt_workflow:
  profiles:
    agent_decision_default:
      token_budget: 2200
      safety_margin_tokens: 80
    context_summary_default:
      token_budget: 1600
      safety_margin_tokens: 60
    memory_compaction_default:
      token_budget: 1800
      safety_margin_tokens: 60
```

三个 profile 分别对应 Agent 决策、上下文摘要、记忆压缩三种推理任务的 token 预算。`safety_margin_tokens` 是为结构化输出开销预留的安全余量。

### 4.13 runtime — 多包运行时

```yaml
runtime:
  multi_pack:
    max_loaded_packs: 2
    start_mode: "manual"               # manual | bootstrap_list
    bootstrap_packs: []                 # 当 start_mode 为 bootstrap_list 时自动加载的包 ID 列表
  metrics_port: 9090
```

- `start_mode: manual`：由操作员通过 API/CLI 手动加载世界包
- `start_mode: bootstrap_list`：启动时自动加载 `bootstrap_packs` 列表中的世界包
- `max_loaded_packs`：限制可同时加载的世界包数量

### 4.14 features — 功能开关

```yaml
features:
  ai_gateway_enabled: false
  inference_trace: true
  notifications: true
  experimental:
    prompt_slot_permissions: false
```

`experimental` 下的字段为实验特性，不保证向后兼容。

### 4.15 slot_behaviors — Prompt Slot 行为配置

`slot_behaviors` 域没有模板文件，仅在代码内置默认值中定义（默认为空 `{}`）。它为每个 prompt slot 提供运行时行为策略：

- 激活控制：触发概率、条件匹配、条件组合方式
- 深度与递归控制：最大嵌套深度、递归禁止
- 顺序与分组：组权重、组模式（exclusive/priority/budget）、渲染顺序
- 状态机触发器：sticky（最大激活次数）、cooldown（冷却 tick）、delayed_trigger（延迟触发）
- 上下文控制：忽略上下文长度

完整的 profile schema 见 `apps/server/src/config/domains/slot_behavior.ts`。

### 4.16 conversation — 多轮对话格式

此域没有模板文件，仅在 `data/configw/conf.d/` 下以活跃配置形式存在。定义了多轮对话的 transcript 序列化/组装/压缩 profile。

每个 profile 包含三个子部分：
- **transcript**：嵌入模式、turn 分隔符、发言者格式化字符串
- **message_assembly**：slot 到 message role 的映射、连续同 role 合并策略、AI 填充位置
- **compression**：AI 摘要开关、窗口 turn 数、摘要触发阈值、保留最近 N 轮

内置 profile：
- `default`：3 消息后向兼容基准（merge_consecutive_same_role: true）
- `chat-first-turn`：完整上下文，首轮对话专用
- `chat-follow-up`：轻量路径，后续轮次使用

## 5. AI 模型注册表

`apps/server/config/ai_models.yaml` 定义 AI 提供商、模型清单和路由规则。

### 5.1 结构

```yaml
version: 1

providers:
  - provider: openai
    enabled: true
    # ... 连接参数

models:
  - provider: openai
    model: gpt-4.1-mini
    availability: active

routes:
  - route_id: default.agent_decision
    preferred_models:
      - provider: openai
        model: gpt-4.1-mini
    defaults:
      timeout_ms: 30000
      retry_limit: 2
      allow_fallback: true
      audit_level: standard
      circuit_breaker:
        failure_threshold: 5
        recovery_timeout_ms: 30000
      rate_limit:
        max_concurrent: 10
      backoff:
        base_delay_ms: 1000
        max_delay_ms: 30000
```

数组按稳定键合并：providers 按 `provider`、models 按 `provider + model`、routes 按 `route_id`。

### 5.2 路由弹性默认值

每个 route 可携带 `defaults` 块来调优：
- **circuit_breaker**：连续失败 N 次后熔断，recovery_timeout_ms 后进入半开状态
- **rate_limit**：每个 provider 最大并发请求数
- **backoff**：指数退避的初始延迟和上限

AI Gateway 的完整体系见 [AI_GATEWAY.md](../subsystems/AI_GATEWAY.md)。

## 6. 推理上下文配置

推理上下文配置（`inference_context`）控制变量命名空间的解析策略、信息传输 profile 和策略摘要。

### 6.1 文件布局

| 路径 | 用途 |
|------|------|
| `apps/server/templates/configw/inference_context.default.yaml` | 模板 |
| `apps/server/templates/configw/inference_context.d/dev.yaml` | 开发环境覆盖 |
| `apps/server/templates/configw/inference_context.d/prod.yaml` | 生产环境覆盖 |
| `data/configw/inference_context.yaml` | 活跃配置（从 default.yaml 复制） |
| `data/configw/inference_context.d/` | 活跃环境覆盖目录 |

### 6.2 结构

```yaml
config_version: 1

variable_context:
  layers:
    system:    # 系统级变量（应用名、时区等）
    app:       # 应用级变量（启动健康状态等）
    pack:      # 世界包变量（元数据、变量池、prompt、AI 配置）
    runtime:   # 运行时变量（当前 tick、包状态、世界状态）
    actor:     # 行动者变量（身份、显示名、角色、Agent 快照）
    request:   # 请求变量（任务类型、策略、幂等键）

transmission_profile:
  defaults:
    snr_fallback: 0.5
    delay_ticks_fallback: "1"
  thresholds:
    fragile_snr: 0.3
  drop_chances:
    fragile: 0.35
    best_effort: 0.15
    reliable: 0.0
  policies:
    read_restricted_base: best_effort
    low_snr_base: fragile
    default_base: reliable

policy_summary:
  evaluations:
    - resource: social_post
      action: read
      fields: [id, author_id, content, created_at, ...]
```

每个命名空间层可独立开关（`enabled: true/false`），并通过 `values` 和 `alias_values` 提供模板变量。

## 7. 世界包配置

世界包有两层配置结构：入口清单 `pack.yaml` 和可选的 `config/` 目录下的分文件配置。

### 7.1 pack.yaml 入口

```yaml
schema_version: 0
metadata:
  id: "world-death-note"
  name: "死亡笔记"
  version: "0.5.0"
  description: "..."
  authors:
    - name: "Yidhras Team"
      role: "default pack maintainer"
  license: "SEE LICENSE IN ROOT PROJECT"
  tags: ["thriller", "investigation"]
  compatibility:
    yidhras: ">=0.5.0"
    schema_version: "world-pack/v1"

include:
  variables: "config/variables.yaml"
  prompts: "config/prompts.yaml"
  time_systems: "config/time_systems.yaml"
  simulation_time: "config/simulation_time.yaml"
  entities: "config/entities.yaml"
  identities: "config/identities.yaml"
  capabilities: "config/capabilities.yaml"
  authorities: "config/authorities.yaml"
  rules: "config/rules.yaml"
  bootstrap: "config/bootstrap.yaml"
  storage: "config/storage.yaml"
  ai: "config/ai.yaml"
  dynamics_config: "config/dynamics_config.yaml"
```

`include` 下的每个 key 指向一个 YAML 文件，内容按 key 语义化加载。所有路径相对于 `pack.yaml` 所在目录解析。世界包的完整规范见 [WORLD_PACK.md](../specs/WORLD_PACK.md)。

### 7.2 config/ 目录

每个 `include` 项可拆分为独立文件，便于大型世界包的组织。常用配置文件：

| 文件 | 内容 |
|------|------|
| `variables.yaml` | 世界包级变量池（模板引擎引用） |
| `simulation_time.yaml` | 初始 tick、tick 范围、步长 |
| `time_systems.yaml` | 时间系统定义（主时钟、辅助时钟、换算率） |
| `entities.yaml` | 实体定义：actors、artifacts、mediators、domains、institutions |
| `identities.yaml` | Agent 身份绑定 |
| `capabilities.yaml` | 能力注册表 |
| `authorities.yaml` | 授权规则（grant）、目标选择器、执行条件 |
| `rules.yaml` | 规则集：perception、capability_resolution、invocation、projection、objective_enforcement |
| `bootstrap.yaml` | 初始世界状态和初始事件 |
| `storage.yaml` | 存储策略：隔离 DB、集合定义、索引 |
| `ai.yaml` | AI 行为配置：推理预设、解码器、隐私层级、记忆循环策略、任务路由 |
| `dynamics_config.yaml` | 动态算法参数（线性、指数、sigmoid） |
| `prompts.yaml` | 世界包级 prompt 模板 |

### 7.3 世界包自举模板

`data/configw/templates/world-pack/` 目录存放世界包创建模板。当 `world.bootstrap.enabled: true` 时，若目标包目录不存在，服务使用对应的 YAML 模板创建新世界包。模板是一个完整的单文件世界包定义（等同于 `pack.yaml` + 所有 `include` 的内联内容）。

## 8. 配置 API

运行时提供以下 HTTP 端点用于读取和修改配置：

- `GET /api/config` — 返回全部运行时配置（敏感值脱敏）
- `GET /api/config/:domain` — 返回单个域的配置
- `POST /api/config/:domain` — 更新配置域并写入 `data/configw/conf.d/{domain}.yaml`
- `GET /api/config/backups/*` — 配置备份端点

详见 [API.md](../specs/API.md)。

## 9. 首次部署流程

```bash
pnpm prepare:runtime
```

此命令执行：
1. 运行 Prisma 迁移
2. 初始化运行时目录（将 `apps/server/templates/configw/` 下的模板复制到 `data/configw/`）
3. 种子化操作员身份

首次复制后，直接编辑 `data/configw/conf.d/*.yaml` 或 `data/configw/local.yaml` 即可定制配置。后续 `prepare:runtime` 不会覆盖已有文件。

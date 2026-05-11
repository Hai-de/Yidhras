# Yidhras 项目怀疑性全面审查报告

> 审查视角：以落地为唯一标准，对所有文档主张、架构承诺和代码实现进行对抗性验证。
> 审查范围：仓库全部源代码、文档、设计稿、测试与配置。
> 审查日期：2026-05-09
> 最后更新：2026-05-11（更正 §4.7 插件系统：`requestInference` 与 `registerPerceptionResolver` 已验证为已实现，Gaps 列表同步更新）

---

## 1. 执行摘要：绝望指数总览

### 1.1 核心结论

**Yidhras 是一个文档驱动型项目（documentation-driven project），其文档成熟度、架构词汇量和设计草案数量远超代码的实际落地深度。** 项目拥有令人印象深刻的概念分层（L1 社交+空间 → L2 关系 → L3 叙事 → L4 传输）、大量精心编写的架构文档、以及一套形式化的术语体系。然而，当这些主张被逐条拿到代码层面进行验证时，会发现大量功能处于以下状态之一：

- **纸面完成**：文档中描述为"已实现"，但实际只是接口定义或最小可行路径（MVP），缺乏生产级健壮性
- **部分桩代码**：有注册表、有类型定义、有路由，但核心逻辑为空或只有一条测试路径
- **设计推迟**：有详尽的设计文档（多轮对话 50KB、插槽函数 47KB、模板引擎统一 49KB），但实现处于"待决定"、"需求驱动"或"Phase 6+"状态
- **根本不存在**：文档中暗示其作为系统一部分运行的能力，在代码中完全找不到证据

### 1.2 绝望指数评分（0 = 即将落地，10 = 深空漂浮）

| 子系统 | 文档声称的成熟度 | 代码实际成熟度 | 绝望指数 | 说明 |
|--------|----------------|--------------|---------|------|
| 基础 HTTP API / CRUD | 生产级 | 中等 | 4 | Express + Prisma 标准套路，有测试覆盖 |
| Rust World Engine Sidecar | "已完成 sidecar-only 收口" | 约 1,693 行 Rust | 7 | IPC 加固已完成（2026-05-10），但 ~1,700 行的"世界引擎"与架构文档中的重要性仍不成比例 |
| AI Gateway | "分层内部管道" | 多 provider 刚落地 | 5 | Anthropic/DeepSeek/Ollama 适配器 2026-05-10 新增，多 provider 生态稳定性待验证 |
| Prompt Workflow Runtime | "V2 树形管道 exclusive" | 有实现但过度设计 | 6 | 五个 profile，但实际只用到前三个 |
| 调度器 Scheduler | "partition-aware / multi-worker" | SQLite 上的 lease 表 | 6 | 多 worker 但没有真正的分布式，全在单机上 |
| 插件系统 Plugin Runtime | "pack-local governance" | 中等，AI 推理/感知注册已补齐 | 7 | 11 个注册方法 + AI 推理可用，但无资源限制 enforce、无前端 CSP、无进程级隔离 |
| 空间语义 Spatial | "A 层 Phase 1 全部完成" | B/C 层为零 | 7 | A 层代码链路完整（含 move intent），但端到端 AI 行为未验证，前端无空间可视化 |
| 多轮对话 Multi-Turn | "设计文档 50KB" | 数据/持久化层就绪，路由层未激活 | 8 | Conversation 模块 ~2,368 行 TS，Tag 在 DB 层已激活但未用于多轮路由 |
| 前端 Web | "Nuxt 4 + Vue 3" | ~6,100 行 Vue SFC + ~25,400 行 TS | 7 | 纯管理后台，无实时交互，无游戏画面 |
| 数据清洗 DataCleaner | "统一抽象 + 注册表" | 47 行空注册表 | 9 | NLP、规则引擎、ML 辅助全部未开始 |
| 安全 / 运维 | "三层权限递进" | 仅 CORS | 9 | 无 helmet、无 CSRF、无 rate limit、无 Docker |
| 测试体系 | "unit + integration + e2e" | e2e 明确不跑 CI | 6 | 测试数量可观，但 e2e 是"本地/手动验证" |
| **项目整体** | **"罗生门模拟基础设施"** | **概念验证阶段** | **7.5 / 10** | **距离可运行的叙事模拟平台仍有海量工程债务** |

---

## 2. 审查方法论

本次审查遵循以下原则：

1. **代码优先于文档**：当文档与代码冲突时，以代码为准。文档中的"已完成"、"已实现"、"已形成"等词汇必须经过代码级验证才能采信。
2. **功能优先于接口**：有接口定义、有路由、有类型不等于功能可用。必须验证接口背后是否有真实业务逻辑。
3. **生产优先于原型**：原型阶段的"验证通过"不等于生产就绪。审查以"能否承载真实用户、真实负载、真实故障"为标准。
4. **对抗性视角**：主动寻找反例、边界条件和失败路径。如果一个系统"支持 X"，审查问题是"在什么条件下 X 会失败？失败时会发生什么？"

---

## 3. 核心主张 vs 代码现实的系统性偏差

### 3.1 主张："Rust World Engine 已完成 sidecar-only 收口"

**文档来源**：`docs/ARCH.md` §3.3.3、`.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`

**实际证据**：
- `apps/server/rust/world_engine_sidecar/src/` 下 8 个 Rust 文件，总计 **1,673 行**
- `apps/server/rust/scheduler_decision_sidecar/src/` 下 6 个文件，总计 **793 行**
- `apps/server/rust/memory_trigger_sidecar/src/` 下 8 个文件，总计 **1,981 行**
- **三个 Rust 进程加起来不到 4,500 行代码**

**怀疑性分析**：

一个被描述为"世界引擎内核"的系统，其 Rust 实现只有 1,673 行，这是什么概念？作为对比，一个最小化的 Roguelike 游戏引擎（如 Rust 的 `bracket-lib`）核心也超过 5,000 行。Yidhras 的 world engine 需要处理：实体状态管理、规则匹配、模板渲染、状态变更突变、prepare/commit/abort 事务语义、JSON-RPC 协议、握手、健康检查——全部压缩在 1,673 行中。

这意味着要么：
- (a) 该引擎极度精简，功能范围远小于文档暗示；或
- (b) 大量"世界引擎"逻辑实际上仍在 Node/TS 侧，Rust 只是执行了一层薄包装

查看 `objective.rs`（352 行）和 `step.rs`（486 行），这确实是核心。但 `template.rs` 只有 73 行——文档声称的"模板渲染"在 Rust 侧只有 73 行？这不可能覆盖复杂的规则模板求值。事实上，模板引擎的主体（`apps/server/src/template_engine/`）完全在 TS 侧，Rust 侧的模板处理只是接收已渲染的字符串或简单替换。

**结论**：Rust sidecar 不是"世界引擎内核"，而是一个**状态变更执行器 + 规则匹配器**。真正的"引擎"（上下文组装、prompt 构建、AI 调用、工作流编排、感知管线、插件生命周期）全部在 Node/TS 侧。文档使用"Rust world engine"的术语制造了架构上的误导。

### 3.2 主张："AI Gateway 是分层内部管道"

**文档来源**：`docs/subsystems/AI_GATEWAY.md`

**实际证据**（审查日期 2026-05-09 / 更新 2026-05-10）：
- 审查日期时 Provider adapters：`apps/server/src/ai/providers/` 下仅有 `mock.ts`、`openai.ts`、`gateway_backed.ts`
- **2026-05-10 更新**：新增 `anthropic.ts`（765 行）、`openai_compatible.ts`（537 行）、`deepseek.ts`（22 行薄封装）、`ollama.ts`（21 行薄封装），通过提交 `1704d9b`（可插拔 Provider 配置）和 `8b57eff`（AI Gateway 补全）落地
- `gateway_backed.ts` 不是独立 provider，而是 gateway 的自引用包装

**怀疑性分析**：

文档详细描述了 circuit breaker、rate limiter、exponential backoff、tool calling、cross-agent bridge 等机制。在审查日期时，这些弹性层的保护对象只是通往 OpenAI 的单一路径——当 OpenAI API 不可用时，系统没有替代路径。`route_resolver.ts`（227 行）理论上支持多 route 多 model 选择，但当时 `ai_models.yaml` 默认只配置 OpenAI。

**2026-05-10 之后**：多 provider 已落地，Anthropic（Claude）适配器代码量甚至超过 OpenAI（765 vs 474 行），DeepSeek 和 Ollama 通过 `openai_compatible` 基类复用。circuit breaker 的多 provider 切换价值开始显现。然而需注意：
- 多 provider 生态刚刚落地一天，生产级多 provider 切换（自动 fallback、错误分类、provider 特定的 rate limit 校准）尚未经过充分验证
- DeepSeek 和 Ollama 适配器为薄封装（各 ~21 行），异常处理和行为差异可能需要进一步充实

以下分析点依然成立：

文档自己承认（`AI_GATEWAY.md` §5）：**"公开 inference contract 仍然只稳定承诺 mock 与 rule_based"**。这意味着：
- 所有通过真实 AI 的推理都是"内部/受控能力"
- 外部 API 用户只能调用 mock（返回假数据）或 rule_based（基于规则的硬编码响应）
- 一个以"AI 驱动模拟"为核心卖点的系统，对外不提供 AI 推理能力

**Tool Calling** 虽然实现了，但 `tool_loop_runner.ts` 的串行阻塞模型意味着：如果一次 tool call 失败或超时，整个推理任务失败。文档称这是"受控执行能力"，实际上它是一个**单点故障放大器**。

**结论**：AI Gateway 的弹性分层设计在**概念上正确**，多 provider 落地（2026-05-10）使其从"过度设计的 OpenAI 包装器"向"真正的多 provider gateway"演进。但多 provider 生态的稳定性、自动 fallback、provider 特定错误处理等尚待验证。公开 inference contract 仍只承诺 mock/rule_based 这一约束未变。

### 3.3 主张："Prompt Workflow Runtime 是可解释、可观察、可按 task type 切换的运行时"

**文档来源**：`docs/subsystems/PROMPT_WORKFLOW.md`

**实际证据**：
- 内置 5 个 profile：`agent-decision-default`、`context-summary-default`、`memory-compaction-default`、`chat-first-turn`、`chat-follow-up`
- `chat-first-turn` 和 `chat-follow-up` 的存在证明多轮对话有设计，但...
- `conversation_history_track.ts` 只是读取 `agent_conversation_memory` 并生成 section drafts
- **Tag 系统**：`ConversationEntry` 数据模型已包含 `tags?: string[]` 字段，`store_prisma.ts` 通过 `tags_json` 列完成持久化读写。Conversation 模块总计 ~2,368 行 TS。但 Tag 在**多轮对话路由和 profile 选择**层面尚未激活（`TODO.md`："Tag 系统 schema 已就位，用途尚在讨论中，待决定后激活"）。`PROMPT_WORKFLOW.md` 也明确标注 `chat-first-turn` 和 `chat-follow-up` profile 依赖多轮对话基础设施，"该基础设施尚未激活"。

**怀疑性分析**：

5 个 profile 中，`PROMPT_WORKFLOW.md` 自行承认当前生产路径仅有前 3 个（`agent-decision-default`、`context-summary-default`、`memory-compaction-default`）。`chat-*` profile 的存在是为了展示多轮对话的架构预留，但其激活依赖 Tag 系统在路由层面的应用。
- `conversation_profile` 字段在 `InferenceContext` 中有定义，但如何被设置、如何被持久化、如何在多轮之间保持状态，代码中缺乏完整链路
- 多轮对话设计文档（`.limcode/design/multi-turn-conversation-design.md`，50,752 字节）极其详尽，涵盖了 conversation entry、turn、thread、branching、archival 等概念
- **Tag 的数据/持久化层已激活，路由/行为层未激活**——这不是"Tag 系统完全不存在"，而是"Tag 系统尚未用于多轮对话路由"

token_budget_trim executor 声称按优先级裁剪，但 token 计数是如何实现的？如果使用的是简单字符估算或外部 tiktoken 库，其精度如何？文档未说明。在中文场景下，token 估算误差可能高达 30-50%，这意味着 budget trim 要么过度裁剪（丢失关键上下文），要么不足裁剪（超出模型窗口）。

**结论**：Prompt Workflow 是一个**设计过度、实现不足**的子系统。它有漂亮的概念分层（轨道 → 汇合 → pipeline → executor），但实际生产路径可能只使用了其中 30% 的能力。大量代码是为了"未来扩展性"而写的，当前并未被验证其必要性。

### 3.4 主张："Scheduler 是 partition-aware / multi-worker"

**文档来源**：`docs/ARCH.md` §3.2、§3.2.1

**实际证据**：
- `SchedulerStorageAdapter` 接口，`SqliteSchedulerStorageAdapter` 实现
- 数据存储在 `runtime.sqlite` 中，与 pack runtime 共用同一个 SQLite 文件
- `scheduler_lease.ts`、`scheduler_ownership.ts`、`scheduler_rebalance.ts` 实现 lease/ownership/rebalance 逻辑
- `fileParallelism: false`（测试配置），e2e 测试明确说"isolated temp DBs per session"

**怀疑性分析**：

"partition-aware / multi-worker" 的声称在单机 SQLite 架构下意味着什么？

- 如果所有 worker 都在同一台机器上，"partition" 只是内存中的逻辑分组
- SQLite 的并发写入能力有限（即使是 WAL 模式），"multi-worker" 在数据库层面是串行的
- `SqliteSchedulerStorageAdapter` 通过 `CREATE TABLE IF NOT EXISTS` 在 `runtime.sqlite` 中创建 scheduler 表，这意味着所有 scheduler 状态与 pack runtime 状态竞争同一个数据库连接池
- 文档称 "lease 与 cursor state 以 partition 为作用域，存储于 pack-local SQLite"——但这只是**数据分片**，不是**计算分片**。所有计算仍然在 Node/TS 主线程中进行

真正的分布式调度器需要：独立的 worker 进程（或容器）、网络通信、分区再平衡时的状态迁移、故障检测和自动故障转移。Yidhras 的 scheduler 是一个**单机内存调度器**，其 "multi-worker" 概念是**伪分布式**的。它在代码层面模拟了分布式系统的接口（lease、ownership、rebalance），但没有真正的分布式运行时。

**结论**：Scheduler 是一个**单机模拟分布式**的系统。它的 lease/ownership/rebalance 逻辑在单机场景下是过度设计，在真实分布式场景下又不足以支撑。这是典型的**提前抽象**（premature abstraction）。

### 3.5 主张："空间语义 A 层 Phase 1 全部完成"

**文档来源**：`.limcode/design/spatial-semantics-design.md`、`.limcode/plans/foundation-enhancements-from-prototype-evaluation.md`

**实际证据**：
- `spatial/` 目录存在：`runtime.ts`（A 层实现）、`perception/` 目录存在
- `simulation_loop.ts` 增加了 step 6：`runPerceptionPipeline()`
- `action_dispatcher.ts` 增加了 `move` intent 分支
- `enforcement_engine.ts` 增加了 `location.in` / `location.adjacent_to` 预过滤
- **但**：`TODO.md` 明确列出 "`move` intent 接地逻辑 — dispatcher 分支已实现，AI → intent 的解析（'走向厨房' → `move(target='kitchen')`）后续由 prompt 工程处理"
- **原型世界包 `snowbound_mansion/config.yaml` 有 629 行，但只有配置，没有端到端验证报告**

**怀疑性分析**：

A 层声称"全部完成"，但让我们逐一验证：

1. **Constitution schema 扩展**：完成。`spatial` 段已加入 Zod schema。
2. **SpatialRuntime**：完成。有邻接图 + BFS 距离 + location 查询。
3. **EntityState spatial namespace**：完成。约定 `{location: location_id}`。
4. **PerceptionResolver 接口 + 默认实现**：完成。`default_resolver.ts` 实现了同 location full / 其他 none。
5. **Sim loop 第 6 步**：完成。`perception_pipeline.ts` 存在。
6. **Context assembly 空间上下文源**：完成。`spatial_proximity.ts` 注入当前地点 + 邻接地点。
7. **Action dispatch 支持 move intent**：完成。`intent_grounder.ts`（365 行）将 `move` 列为五个直接内核 action 之一（`trigger_event`、`post_message`、`adjust_relationship`、`adjust_snr`、`move`），`action_dispatcher.ts` 有完整的 `dispatchMoveIntent()`（payload 解析 + 空间运行时可用性检查 + 邻接校验 + 实体移动执行）。**但存在争议点**：AI 是否能从自然语言可靠地生成 `move` intent 取决于 prompt 模板的质量和模型能力——"AI → intent 的解析（'走向厨房' → `move(target='kitchen')`）后续由 prompt 工程处理"。这意味着 grounder 能正确处理 `move`，但 prompt 中是否有效传达了空间移动的能力需要进一步验证。
8. **Enforcement engine 空间谓词**：完成。预过滤已实现。

**第 7 点的真实状态**：move intent 的**代码链路完整**（grounder → dispatcher → spatial runtime）。"AI 无法生成 move intent"的说法不准确——move 是内核 action，AI 只需输出 `action_type: 'move'` 即可触发。真正的未验证项是**端到端行为**：AI 在模拟循环中是否真的会自主产生移动行为？这取决于 prompt 工程和模型能力，属于调优/验证层面而非代码缺失。

此外，B 层（连续几何）和 C 层（抽象度量空间）在 schema 中有定义，但**零实现**。文档说"需求驱动"，但一个平台如果不提供至少一个参考实现，包作者如何知道 B/C 层是否真的能工作？

**前端方面**：文档称"前端最小地图/位置视图（原型阶段不需要）"。但 `ARCH_DIAGRAM.md` §4.9 的表格中列出了 A 层可视化是"地点邻接图（节点 = 地点，边 = 邻接关系）"。前端 `graph.vue` 使用 Cytoscape.js，但它渲染的是 L2 关系图，不是空间图。空间语义在前端完全不可见。

**结论**：空间语义 A 层是**基础设施完备、端到端行为未验证**的典型。所有"系统侧"功能已完成（含 move intent 的完整代码链路），但 AI 是否能自主产生空间移动行为未经端到端验证，前端无可视化，原型世界包无自动化运行报告。代码层面是可运行的，行为层面是未验证的。

---

## 4. 逐子系统深度审查

### 4.1 后端基础设施（Express / Prisma / SQLite）

**Claim**：TypeScript + Express + Prisma + SQLite 后端，支持 SQLite / PostgreSQL 双 provider。

**Evidence**：
- Express app 在 `create_app.ts` 中装配，有标准 middleware 链
- Prisma schema 拆分为 `schema.sqlite.prisma` 和 `schema.pg.prisma`（648 行）
- `SqlitePackStorageAdapter` 和 `PostgresPackStorageAdapter` 存在
- Repository 接口层已收口（`AgentRepository`、`MemoryRepository` 等）

**Skeptical Audit**：

双 provider 支持在**接口层面**存在。Prisma schema 有三个文件：`schema.prisma`（691 行）、`schema.sqlite.prisma`（648 行）、`schema.pg.prisma`（648 行）。三个文件之间的关系（是否存在继承/生成机制，或是否需要手动同步）未经充分验证——若 `schema.sqlite.prisma` 和 `schema.pg.prisma` 由 `schema.prisma` 通过工具生成，则同步问题不成立；若三者独立维护，则需要自动化 diff 校验（目前 CI 中未见此类检查）。

SQLite 作为默认后端，在并发场景下会成为瓶颈。文档说"当前规模 SQLite JSON column + 纯 TS 即可；十万级实体时评估 pgvector / LanceDB"，但没有回答：
- 从 SQLite 迁移到 PostgreSQL 的在线迁移路径是什么？
- `PackStorageAdapter` 的 PostgreSQL 实现使用 "schema-per-pack"，这在 PostgreSQL 中意味着动态 schema 创建。这在托管 PostgreSQL（如 AWS RDS、Google Cloud SQL）中通常需要超级用户权限，而这些权限在生产环境中往往不可用
- 快照功能**明确不支持 PostgreSQL**（`ARCH.md` §2.4.2："快照功能仅适用于 SQLite 后端"）

**安全方面**：`create_app.ts` 中只使用了 `cors()` middleware。没有 `helmet`、没有 `express-rate-limit`、没有 CSRF 保护、没有 XSS 过滤、没有请求体大小限制。一个暴露 HTTP API 的系统，其安全中间件只有 CORS，这在生产环境中是不可接受的。

**Gaps**：
- [ ] schema 变更的三文件同步自动化校验
- [ ] PostgreSQL 部署的权限和运维文档
- [ ] 从 SQLite 到 PostgreSQL 的在线迁移路径
- [ ] 安全中间件（helmet、rate limit、请求大小限制）
- [ ] 输入消毒和 SQL 注入防护（Prisma 有参数化查询，但 raw SQL 路径需要审计）

**Verdict**：基础设施是标准 Express/Prisma 栈，没有特别的问题，但也没有超出常规的生产级加固。**在安全性上存在明显缺口**。

---

### 4.2 Rust Sidecar 池

**Claim**："Rust world engine 与 sidecar 边界"、"WorldEnginePort"、"Host-managed persistence 覆盖完整闭环"

**Evidence**：
- `world_engine_sidecar_client.ts`：419 行 TS 代码，通过 stdio JSON-RPC 与 Rust 进程通信
- Rust world_engine_sidecar：1,673 行
- Rust scheduler_decision_sidecar：793 行
- Rust memory_trigger_sidecar：1,981 行
- Sidecar 协议覆盖：handshake、health、pack load/unload、state query、objective execution、step prepare/commit/abort

**Skeptical Audit**：

stdio JSON-RPC 是一个**极其脆弱的 IPC 机制**。它要求：
1. Rust 进程的标准输出必须严格只输出 JSON-RPC 消息
2. 任何日志、panic 消息、第三方库的 stderr 输出都会污染协议流
3. 没有消息长度前缀，依赖 JSON 的边界解析
4. 没有内置的心跳或连接复用

在生产环境中，stdio IPC 几乎只在本地开发工具中使用（如 LSP 的 language server）。对于需要长时间运行、高频率通信（每 tick 一次 step prepare/commit）的世界引擎，stdio IPC 缺乏：
- 流量控制（backpressure）
- 连接恢复（Rust 进程 crash 后需要重新 spawn）
- 消息确认和重传
- 性能监控（延迟 histogram）

文档声称"pack load 时自动启动 loop，pack unload 时停止 loop 并 kill sidecar 进程"。但 kill sidecar 进程时，如果有一个 pending 的 `step/commit` 请求在 stdio 管道中，会发生什么？Node 侧会收到一个半截的 JSON，然后解析失败。错误恢复逻辑是什么？

更重要的是，**三个 Rust sidecar 是独立的进程**。world_engine_sidecar、scheduler_decision_sidecar、memory_trigger_sidecar 各自 spawn。

> **2026-05-10 更新**："每个 pack 需 3 个 Rust 进程，10 pack = 30 进程"的指控经验证不成立（见下方更新块）。sidecar 进程按需 spawn 而非 per-pack 固定分配。此处保留原始论述文本以供追溯，读者应以更新块为准。

**Gaps**：
- [x] stdio IPC 的健壮性评估和替代方案（Unix domain socket / TCP loopback） — **已完成：方案 A 原地加固，无需替换**
- [x] Sidecar 进程 crash 恢复和 pending 请求处理 — **已完成：指数退避自动重连 + pending 请求 reject 通知**
- [ ] 多 pack 场景下的内存和 CPU 开销基准测试
- [ ] Rust sidecar 的构建和分发流程（CI 中是否编译 Rust？部署时是否包含 Rust 二进制？）
- [ ] Sidecar 协议版本兼容性（`WORLD_ENGINE_PROTOCOL_VERSION` 变更时的滚动升级策略）

**Verdict**：Rust sidecar 的实现规模（<4,500 行）与其在架构文档中的重要性不成比例。更关键的是，**大量"世界引擎"逻辑实际上仍在 TS 侧**，Rust 只是一个执行远程命令的薄客户端/服务器。

> **2026-05-10 更新**：§4.2 中指出的 IPC 工程完备性缺口已通过方案 A（原地加固）修复。详见 `docs/ARCH.md` §3.3.3：
> - 提取 `StdioJsonRpcTransport` 共享基类，消除三处 85% 重复的 transport 实现
> - 增加心跳检测（可配置间隔 + 连续失败阈值 → `unhealthy` 事件）
> - 增加进程 crash 后指数退避自动重连（默认 3 次，基数 500ms）
> - 增加 stdin 背压处理（`drain` 事件）
> - 优雅关闭替代 SIGTERM 强杀（stdin EOF → 自然退出 → 3s 后 SIGKILL 兜底）
> - Rust 侧 world engine 在 stdin EOF 退出前检查 pending prepared state 并输出 warning
>
> 审计中"stderr 污染协议流""无连接复用""10 pack = 30 进程"三项指控经验证不成立或夸大。
> 相关文件：`apps/server/src/app/runtime/sidecar/stdio_jsonrpc_transport.ts`（共享基类），`apps/server/rust/*/src/main.rs`（优雅关闭）。

---

### 4.3 AI Gateway 与推理系统

**Claim**："task-level service decides what kind of AI call is needed, a route resolver picks the right model and provider"

**Evidence**（审查日期 2026-05-09 / 更新 2026-05-10）：
- `ai/task_service.ts`：task-aware 入口
- `ai/route_resolver.ts`：route 选择（227 行，支持多 model 多 provider 匹配）
- `ai/gateway.ts`：dispatch 层
- `ai/providers/openai.ts`：474 行
- `ai/providers/anthropic.ts`：765 行（2026-05-10 新增）
- `ai/providers/openai_compatible.ts`：537 行（2026-05-10 新增，DeepSeek/Ollama 的共享基类）
- `ai/providers/deepseek.ts`：22 行（2026-05-10 新增，薄封装）
- `ai/providers/ollama.ts`：21 行（2026-05-10 新增，薄封装，免 API key）
- `ai/providers/mock.ts`：mock provider
- `ai/providers/gateway_backed.ts`：自引用包装
- Elasticity 层：circuit_breaker.ts、rate_limiter.ts、backoff.ts

> **注**：审查日期时仅有 openai/mock/gateway_backed 三个 adapter。多 provider 于 2026-05-10 通过提交 `1704d9b` 和 `8b57eff` 落地。

**Skeptical Audit**：

**Provider 生态（审查日期 vs 当前）**：审查日期（2026-05-09）时系统仅有 OpenAI 一个真实 provider。2026-05-10 新增了 Anthropic（765 行，完整适配器）、`openai_compatible` 基类（537 行）及基于其的 DeepSeek（22 行）和 Ollama（21 行）薄封装。

当前多 provider 已落地，但以下仍需关注：
- Anthropic 适配器代码量充足（765 行），但**刚落地一天**，与 circuit breaker/rate limiter/backoff 等弹性层的集成尚未经过生产级验证
- DeepSeek 和 Ollama 为薄封装（各 ~21 行），异常处理和行为差异可能需要进一步充实
- 仍无 Google Gemini、Azure OpenAI、Moonshot、通义千问等适配器
- 无多模态路径（OpenAI adapter 中有 `image_url` 和 `file_ref` 的代码，但没有实际的多模态 task 定义）

**Circuit Breaker 的有效性**（审查日期时的状态 → 当前）：审查日期时系统只有一个真实 provider（OpenAI），circuit breaker 只能将其标记为 open/closed，退化为 mock/rule_based 是功能丧失而非优雅降级。2026-05-10 多 provider 落地后，circuit breaker 在 provider 间切换的价值开始显现。但多 provider fallback 的端到端行为（是否自动从 OpenAI 切换到 Anthropic？切换后的上下文兼容性如何？）尚未经过验证。

**Rate Limiter 的数值来源**：rate limiter 的 `maxConcurrent` 默认 10。这个数值是怎么来的？OpenAI 的 rate limit 因账户级别而异（免费 tier、Tier 1-5）。系统没有动态调整机制，也没有根据 HTTP 429 响应中的 `retry-after` 头自动校准。

**Tool Calling**：工具调用系统允许模型在推理中调用工具。但 `tool_loop_runner.ts` 的串行模型意味着：
- 每个 tool call 都是阻塞等待
- 如果 tool call 涉及 cross-agent query，需要再调用一次 AI gateway，这可能再触发 tool call，形成递归
- `max_rounds` 默认 5，但 `total_timeout_ms` 60s 对于一个可能包含多次网络请求的 loop 来说非常紧张
- Tool result 以 `role='tool'` 消息追加到对话历史，但对话历史的总长度管理（trimming）由谁负责？如果 tool loop 跑了 5 轮，每轮产生大量 token，是否会撑爆上下文窗口？

**Gaps**（审查日期后已部分补齐，标注变更）：
- [x] 非 OpenAI provider 适配器 — **2026-05-10 部分完成**：Anthropic (765 行)、DeepSeek (22 行薄封装)、Ollama (21 行薄封装) 已落地。仍缺 Google Gemini、Azure OpenAI、Moonshot 等
- [x] 国内模型生态 — **2026-05-10 部分完成**：DeepSeek 适配器已落地（基于 openai_compatible 基类）。仍缺 Moonshot、Qwen、智谱等
- [ ] Rate limit 的动态校准（根据 provider HTTP 响应调整）
- [ ] Tool loop 的 token 预算管理（防止递归 tool call 撑爆上下文）
- [ ] Streaming/SSE 支持（文档明确说"暂缓"，但如果前端要支持实时交互，这是必须的）
- [ ] 模型响应的缓存机制（相同 prompt 的重复调用成本高昂）
- [ ] 多 provider 自动 fallback 的端到端验证（OpenAI → Anthropic 切换的行为兼容性）

**Verdict**：AI Gateway 的分层架构（task → route → gateway → adapter → elasticity）在**概念上正确**。2026-05-10 多 provider 落地使其从审查日期时的"过度设计的 OpenAI 包装器"向"真正的多 provider gateway"演进。但多 provider 生态刚刚落地，自动 fallback、provider 特定错误处理、成本控制等生产级能力尚待验证。公开 inference contract 仍只承诺 mock/rule_based 这一根本约束未变。

---

### 4.4 Prompt Workflow Runtime

**Claim**："multi-track, slot-driven pipeline"、"V1 flat prompt system has been fully removed"、"System B 多轨汇合架构"

**Evidence**：
- `context/workflow/orchestrator.ts`：编排入口
- `context/workflow/tracks/`：template / node / snapshot / conversation_history
- `context/workflow/executors/`：placement_resolution、fragment_assembly、behavior_control、content_transform、permission_filter、token_budget_trim、bundle_finalize
- `inference/prompt_tree.ts`、`prompt_fragment_v2.ts`、`prompt_bundle_v2.ts`
- 5 个内置 profile

**Skeptical Audit**：

**轨道与 Pipeline 的 overhead**：每次 AI 推理都需要运行：
1. 选择 profile
2. 初始化 workflow state
3. 运行 3-4 条内容轨道（template、node、snapshot、可选 conversation_history）
4. 运行 7 个汇合后 executor

这个开销对于单次推理来说可能微不足道（毫秒级），但在高并发场景下（例如 100 个 agent 同时推理），workflow runtime 的 CPU 开销会成为瓶颈。文档没有提供性能基准数据。

**Token Budget Trim 的精度问题**：`token_budget_trim` executor 声称"按 slot priority 从低到高遍历，裁剪 removable fragment"。但：
- token 计数方法未明确。如果是基于字符数估算，中文场景误差巨大
- `profile.defaults.token_budget` 默认 2200（`agent-decision-default`），这是为哪个模型设计的？GPT-3.5 的 4k 上下文？GPT-4 的 8k？不同模型的 token 化方式不同（Claude 使用不同的 tokenizer），固定 budget 不合理
- 没有动态 budget 调整机制（例如根据模型类型、根据历史平均输出长度）

**Behavior Control 的空转**：`behavior_control` executor 支持 `keyword_match`、`logic_match`、`context_length`、`conversation_turn`、`custom` 条件。但查看 `slot_condition_evaluators.ts`，这些条件的评估逻辑非常简单（字符串包含、数值比较）。而 `slot-function-advanced-design.md`（47,875 字节）描述了更复杂的条件系统（双重模块设置、WASM 沙箱、Phase 6+）。当前实现只是设计文档的一个**子集**。

**Conversation History Track**：`conversation_history_track.ts` 读取 `context.agent_conversation_memory` 并生成 section drafts。Conversation 模块有完整的持久化链路（`store_prisma.ts` 322 行，通过 `tags_json` 列读写），Tag 的数据/持久化层已激活。但 `agent_conversation_memory` 在多轮之间的状态传递和 Tag 用于多轮对话路由/profile 选择的机制尚未激活（`TODO.md`、`PROMPT_WORKFLOW.md` 均确认）。这是一个**数据层就绪、行为层待激活**的状态。

**Gaps**：
- [ ] Token 计数的精确实现和中文场景验证
- [ ] 动态 budget 调整（per-model、per-task-type）
- [ ] Behavior control 的高级条件（设计文档 Phase 2-5 中描述的功能）
- [ ] Conversation memory 的持久化和读取链路验证
- [ ] Profile 的性能基准测试（高并发下的 latency）
- [ ] 自定义 executor 的注册和运行时隔离（插件注册的 executor 如果抛错，是否会影响整个 pipeline？）

**Verdict**：Prompt Workflow 是一个**设计文档远大于代码实现**的子系统。当前实现是功能性的，但大量高级功能（WASM 沙箱、复杂条件、双重模块）处于"设计完成、实现推迟"状态。其复杂度（7 个 executor × 4 条轨道 × 5 个 profile）带来了维护负担，但尚未被证明其必要性。

---

### 4.5 Context / Memory / Overlay 系统

**Claim**："Memory Block Runtime 当前形成最小闭环"、"语义记忆检索已满足"、"VectorStore（余弦相似度 + brute-force）已实现"

**Evidence**：
- `MemoryRepository.ts`：MemoryBlock / MemoryCompactionState CRUD
- `context/service.ts`、`context/source_registry.ts`：Context Module
- Vector 嵌入由 `text-embedding-3-small` 在写入时生成
- 余弦比对由 Rust sidecar 完成

**Skeptical Audit**：

**VectorStore 的 brute-force 实现**：文档说"VectorStore（余弦相似度 + brute-force）已实现，语义记忆检索已满足"。brute-force 意味着每次查询需要计算 query embedding 与所有 memory block embeddings 的点积。如果有 1,000 个 memory blocks，每次查询需要 1,000 次余弦计算。这在原型阶段可接受，但在长期运行的模拟中，memory blocks 会无限增长（`ConversationEntry.archived` 的"无限增长"问题在 `TODO.md` 中被承认）。当 blocks 达到 10,000 或 100,000 时，brute-force 的查询延迟会线性增长。

更关键的是，**没有向量索引**。文档说"十万级实体时评估 pgvector / LanceDB"，但没有回答：
- 谁负责监控 vector store 的规模？
- 规模达到阈值时，如何迁移到 pgvector？
- 如果 kernel-side 使用 SQLite（默认），pgvector 不可用（SQLite 没有向量索引扩展）。必须迁移到 PostgreSQL 才能使用 pgvector

**Memory Compaction**：`MemoryRepository.ts` 中有 `MemoryCompactionState`，但 compaction 策略是什么？何时触发？如何决定哪些 blocks 被压缩、哪些被保留？文档提到 `memory_compaction` task type，但没有描述 compaction 的具体算法。

**Overlay 的持久化**：overlay 被描述为"kernel-side working-layer object"，不是"pack runtime source-of-truth"。但 `ContextOverlayEntry` 持久化在 kernel Prisma 中，这意味着每次推理产生的 overlay 都会写入 SQLite/PostgreSQL。如果系统每 tick 为每个 agent 产生一个 overlay entry，数据库的增长速度会非常快。文档没有提到 overlay 的清理或 TTL 机制。

**Gaps**：
- [ ] Vector store 的规模监控和自动索引升级路径
- [ ] Memory compaction 的具体算法和触发条件
- [ ] Overlay entry 的 TTL 和自动清理机制
- [ ] 多 agent 场景下的 memory block 并发写入一致性
- [ ] Embedding 生成失败时的降级策略（文档说"静默降级为不匹配"，但这意味着语义检索功能失效时没有告警）

**Verdict**：Memory 系统在当前规模下可用，但**缺乏长期运行的可扩展性设计**。brute-force 向量检索 + 无限增长的 entries + 无清理机制 = **确定性的性能退化**。

---

### 4.6 调度器（Scheduler）

**Claim**："partition-aware / multi-worker"、"lease 与 cursor state 是 partition-scoped"、"automatic rebalance"

**Evidence**：
- `scheduler_lease.ts`、`scheduler_ownership.ts`、`scheduler_rebalance.ts`
- `SqliteSchedulerStorageAdapter`： lease / cursor / ownership / worker state 存储
- 30+ 个 integration test 文件覆盖 scheduler 行为
- `MultiPackLoopHost` 管理 per-pack loop

**Skeptical Audit**：

**Worker 模型的真实性**：文档描述了一个多 worker 调度系统，但查看代码：
- Worker 状态存储在 SQLite 中
- "Partition" 是逻辑概念，不是物理隔离
- 所有 worker 竞争同一个 SQLite 数据库的 lease 表
- 没有独立的 worker 进程模型——"worker" 只是 Node/TS 主循环中的不同迭代

这意味着 scheduler 的 "multi-worker" 是**单进程内的协作式多任务**，不是**分布式任务队列**。如果一个 worker（即一次循环迭代）卡住了（例如 AI 推理耗时过长），整个调度器会阻塞。没有超时机制？有，`tick_budget` 和 `lease_ticks`，但这些是逻辑超时，不是操作系统级别的任务隔离。

**Rebalance 的实际效果**：`scheduler_rebalance.ts` 实现了再平衡建议逻辑。但再平衡在一个单机上有什么意义？如果所有计算都在同一台机器的同一个 Node 进程中，partition 的迁移只是内存中的 hash 表重新分配。真正的再平衡需要：跨机器的负载差异度量、网络开销估算、状态迁移。这些在单机架构下不存在。

**Decision Job 的执行**：`job_runner.ts` 运行 decision jobs。每个 job 本质上是一次 AI 推理调用。如果一次推理需要 5 秒（OpenAI API 延迟），而 tick interval 是 3 秒，会发生什么？调度器会积压 jobs。文档没有描述积压时的背压（backpressure）策略。

**Gaps**：
- [ ] 真正的多进程/分布式 worker 模型
- [ ] Decision job 的并发控制和背压策略
- [ ] 长时间运行 job 的超时和取消机制
- [ ] Scheduler 在 AI provider 延迟抖动下的稳定性
- [ ] 跨物理机的 partition 迁移能力

**Verdict**：Scheduler 是一个**单机逻辑调度器**，其分布式术语（partition、worker、rebalance、lease）是**架构上的透支**。它在单机场景下功能完整，但无法横向扩展。

---

### 4.7 插件系统（Plugin Runtime）

**Claim**："pack-local plugin"、"governance is a kernel-side concern"、"server-side / web-side 承接边界"

**Evidence**：
- `plugins/discovery.ts`、`store.ts`、`service.ts`、`runtime.ts`
- `ServerPluginHostApi`：提供 11 个注册方法 + AI 推理接口
- Web runtime manifest 和同源 asset 路由
- Plugin management GUI 页面

**Skeptical Audit**：

**沙箱缺失**：`PLUGIN_RUNTIME.md` §10 明确承认："sandbox / isolation 能力仍不算强"。这是一个**致命的 understatement**。当前插件系统允许 pack-local 插件：
- 注册 Express 路由（`registerPackRoute`）
- 注册 prompt workflow step executor（`registerPromptWorkflowStep`）
- 注册 context source adapter（`registerContextSource`）

这些注册方法在 `activate()` 中被调用，而 `activate()` 执行的是**不受信任的第三方代码**。虽然插件是 pack-local 的（即由 pack 作者提供），但 pack 作者可能不是系统管理员。恶意或 buggy 的插件可以：
- 注册一个 Express 路由来读取文件系统（因为 Node/TS 宿主有 `fs` 访问权限）
- 在 prompt workflow step 中执行无限循环，阻塞整个推理 pipeline
- 在 context source 中发起外部 HTTP 请求，泄露模拟数据

文档说"后续若引入 Rust world engine，plugin host 通过 Host API / lookup port 与之交互"。但当前插件完全运行在 Node/TS 宿主中，没有任何隔离。`TODO.md` 甚至列出了"Rust WASM 沙箱（需求驱动）"作为推迟项。

**Web Bundle 的安全性**：插件的 web bundle 通过动态 import 加载到前端。同源路由校验确保 asset path 落在允许的 runtime root 内，但：
- 没有 CSP（Content Security Policy）限制插件脚本的执行权限
- 没有插件脚本的签名验证
- 插件可以访问前端的所有 API（因为它是动态 import 到同一作用域的）

**Host API 的 AI 推理与感知注册**（审查日期后已补齐）：审查日期时 `TODO.md` 列出"插件 host API 无 AI 推理接口"和"插件 API 无 `registerPerceptionResolver`"。两项均已在此后的开发中实现：

- `requestInference`（`runtime.ts:145-153`）：带 `server.inference.request` capability 校验，通过独立 `AiTaskService` 实例执行（独立熔断器，与主推理链路隔离）。入口在 `index.ts:246`。
- `registerPerceptionResolver`（`runtime.ts:138-143`）：带 `server.perception_resolver.register` capability 校验，插件注册的解析器接入 `perception_pipeline.ts:112`，优先于默认 `spatial_proximity` 解析器。

两项在 `TODO.md` 以及 `PLUGIN_RUNTIME.md` §9.1–§9.2 中均已标记完成。

**资源限制的纸面配置**：`context.ts` 定义了 `PluginSandboxConfig`，包含 `maxManifestSizeBytes`、`maxManifestDepth`、`maxRoutes`、`maxContextSources` 等字段，配置 schema 中有默认值（1MB、深度 20、16 路由、32 context source）。但这些值**仅在 config 层定义，运行时未 enforce**。`discovery.ts` 不检查 manifest 大小/深度，`runtime.ts` 的 `registerPackRoute`/`registerContextSource` 不对照上限校验。`capabilityLevel`（readonly/pack_scoped/full）裁剪的是 API 表面（`createPluginContext`），不是 CPU/内存/网络资源限制。

**Gaps**：
- [ ] 插件代码沙箱（VM2 已废弃，isolated-vm 或 WASM 是可能方向）
- [ ] 插件资源限制的运行时 enforce（config 中已定义 `maxManifestSizeBytes`/`maxRoutes`/`maxContextSources` 等上限，但 `discovery.ts`/`runtime.ts` 未对照校验）
- [x] 插件 AI 推理接口（`requestInference` — 已实现，独立 AiTaskService 实例）
- [x] 插件自定义感知解析器注册（`registerPerceptionResolver` — 已实现，接入感知管线）
- [ ] 前端插件脚本的 CSP 和签名验证
- [ ] 插件崩溃时的宿主隔离（`activatePluginEntrypoint` 有 try/catch，`PluginRenderBoundary.vue` 有 `onErrorCaptured`；无限循环/`process.exit()` 等进程级破坏无防护，本质上依赖沙箱）

**Verdict**：插件系统在审查日期时的两项核心能力缺口（AI 推理接口 `requestInference`、感知解析器注册 `registerPerceptionResolver`）已补齐。`ServerPluginHostApi` 现提供 11 个注册方法 + AI 推理。剩余实质性缺口集中在**安全边界**：资源限制仅有纸面配置未经运行时 enforce、前端 web bundle 无 CSP/签名校验、无进程级隔离（`activatePluginEntrypoint` 有 try/catch 但无限循环等进程级破坏无防护）。`capabilityLevel` 的 API 表面裁剪不足以构成安全沙箱。

---

### 4.8 空间语义层（Spatial Semantics）

已在 §3.5 中详细审查。补充以下缺口：

**Gaps**：
- [ ] AI `move` intent 的 prompt 工程接地（基础设施就绪，AI 行为缺失）
- [ ] B 层连续几何（零实现）
- [ ] C 层抽象度量空间（零实现）
- [ ] 前端空间可视化（地点邻接图、2D 地图、降维投影全部缺失）
- [ ] 空间索引（十万级实体评估推迟）
- [ ] L4 传输层的空间距离驱动（`spatial_delay`/`spatial_drop` 配置在文档中，代码中未找到实现）
- [ ] 声音传播模型（Layer 2 声学衰减，明确推迟到原型跑通后）

**Verdict**：A 层是**能演示但不能自主运行**的。B/C 层是**纯设计**。

---

### 4.9 前端（Web）

**Claim**："Nuxt 4 + Vue 3 + Pinia 前端"、"Graph rendering: features/graph/*, uses ClientOnly + GraphCanvas + Cytoscape"

**Evidence**：
- Pages：10 个主要页面，总计 ~1,619 行 Vue
- Features：~3,723 行 Vue
- 总 Vue 代码量：**~6,100 行**（含 TypeScript composables/stores/adapters 则约 31,500 行）
- 使用 `useVisibilityPolling` 进行轮询刷新

**Skeptical Audit**：

**Vue SFC ~6,100 行是什么水平？** 作为一个对比，一个中等复杂度的 SaaS 管理后台（如 Supabase 的 dashboard）通常有 50,000-100,000 行前端代码。Yidhras 的前端页面层（Vue SFC）约 6,100 行（含 TypeScript composables/stores/adapters 约 31,500 行），这意味着：
- 每个页面平均约 160 行（overview.vue 270 行已经是最复杂的页面之一）
- 页面组件相对简洁，复杂性集中在 composables 和 stores 中
- 没有实时协作功能
- 没有游戏化的可视化

**前端是"只读轮询控制台"**：`AI_GATEWAY.md` 的 enhancements-backlog 中明确说："前端是只读轮询控制台，不触发推理。所有推理数据通过 3-30 秒间隔的 fetch 拉取已完成的作业结果"。

这意味着：
- 操作员不能在前端直接与 agent 交互（不能聊天、不能给指令）
- 所有 AI 行为由后台 scheduler 驱动，前端只是被动显示
- 没有 WebSocket、没有 SSE、没有实时推送

对于一个"叙事模拟平台"，前端只是一个**监控仪表盘**，不是**交互界面**。操作员可以看到 agent 做了什么、scheduler 的状态、事件时间线，但不能介入模拟。这极大地限制了平台的可用性和吸引力。

**Graph 可视化**：`graph.vue` 使用 Cytoscape.js 渲染关系图。但关系图的节点和边数据从哪里来？如果 L2 关系数据只在 pack runtime 中，前端需要通过 HTTP API 轮询获取。对于 10-15 个 agent 的小规模场景，这没问题。但对于 100+ 实体，关系图的渲染性能会成为问题（Cytoscape.js 在 500+ 节点时开始明显卡顿）。

**空间地图缺失**：前端没有任何空间可视化组件。A 层声称完成，但操作员无法在前端看到 agent 在哪里、地点之间的连接关系。`graph.vue` 渲染的是社交关系图，不是空间图。

**Gaps**：
- [ ] 实时交互能力（WebSocket / SSE）
- [ ] 操作员与 agent 的直接对话界面
- [ ] 空间地图 / 地点邻接图可视化
- [ ] 前端性能优化（大规模图谱渲染）
- [ ] 移动端适配
- [ ] 深色模式 / 主题系统的完整实现（`THEME.md` 有设计，但实现程度未知）

**Verdict**：前端是一个**轻量级的管理后台**，不是**叙事模拟的交互界面**。其功能仅限于监控和配置，缺乏让操作员"进入世界"的沉浸感。页面层约 6,100 行的 Vue SFC 体现了这一现状。

---

### 4.10 权限与安全模型

**Claim**："Operator-Subject 统一权限模型"、"三层递进权限过滤：L1 Pack Access → L2 Capability → L3 Policy"

**Evidence**：
- `operator/guard/pack_access.ts`
- `app/middleware/capability.ts`
- `access_policy/` 目录
- `subject_resolver.ts`

**Skeptical Audit**：

**三层权限的理论 vs 实践**：
- L1 Pack Access：基于 `OperatorPackBinding` 显式绑定。实现简单，有效。
- L2 Capability：基于 `OperatorGrant` + pack authority。有 grant TTL、revocable、scope_json 约束。**但 capability 列表是硬编码的枚举吗？** 如果是，新增 capability 需要改代码。
- L3 Policy：字段级 ABAC（Attribute-Based Access Control）。这是三层中最复杂的，但代码中 `access_policy/` 的实现规模如何？如果只有简单的 allow/deny 列表，这不是真正的 ABAC（真正的 ABAC 需要属性求值引擎、策略组合算法）。

**Agent 自主行为权限**：`resolveSubjectForAgentAction()` 的逻辑是：如果 Agent 有控制 Operator，以 Operator 的 identity 校验 capability；否则以 agent 自身为 subject。这存在一个**理论上的关注点**（以下为怀疑性分析，尚未在代码中验证具体的可利用路径）：
- Agent X 的行为间接获得了 Operator A 的所有 capability
- 如果 Agent X 被 prompt injection 攻击（例如 AI 被诱导生成恶意 intent），理论上可以在 Operator A 的权限范围内执行操作
- 没有机制限制"Agent 自主行为可使用的 capability 子集"

**注意**：以上为理论关注点。`intent_grounder.ts` 对每种 action 有 capability 校验，`action_dispatcher.ts` 对每种 intent 有参数校验（如 `dispatchMoveIntent` 校验邻接关系）。从 prompt injection 到实际系统操作的完整攻击路径未被展示。该风险的真实性取决于：(a) AI 生成的 intent 是否能绕过 intent grounder 的 capability 校验；(b) 是否存在超出 capability 校验范围的高危操作。这是一个**值得关注但缺乏具体证据**的论述点。

**安全中间件**：如前所述，`create_app.ts` 中只有 `cors()`。没有：
- `helmet`（HTTP 头安全）
- `express-rate-limit`（请求频率限制）
- `csurf`（CSRF 保护）
- 请求体大小限制（防止 JSON bomb）
- SQL 注入防护（Prisma 有参数化查询，但 raw SQL 路径需要审计）
- XSS 输出编码（虽然 API 返回 JSON，但错误消息可能包含用户输入）

**Gaps**：
- [ ] 安全中间件（helmet、rate limit、CSRF、请求大小限制）
- [ ] Agent 自主行为的 capability 白名单（而非使用控制 Operator 的全部权限）
- [ ] Prompt injection 的检测和缓解
- [ ] API 密钥的安全存储（OpenAI API key 通过环境变量传入，但 `.env` 文件是否在版本控制中？）
- [ ] 审计日志的完整性校验（防止篡改）
- [ ] 操作员密码策略（最小长度、复杂度、过期）

**Verdict**：权限模型在**功能层面**完整，但在**安全层面**存在明显缺口。Agent 自主行为的权限传递机制是一个**潜在的攻击面**。

---

### 4.11 世界包系统（World Pack）

**Claim**："world-pack 项目化与发布规范"、"scaffold:world-pack"、"death_note 参考实现"、"snowbound_mansion 原型验证"

**Evidence**：
- `data/world_packs/` 下有 `death_note` 和 `snowbound_mansion`
- `apps/server/templates/world-pack/` 有模板文件
- `scaffold:world-pack` CLI 命令
- `snowbound_mansion/config.yaml`：629 行，有 trait 池、地点定义、空间配置

**Skeptical Audit**：

**原型世界包的验证状态**：`.limcode/plans/foundation-enhancements-from-prototype-evaluation.md` 列出了验证顺序：
1. Stage 1 验证：`pnpm test:unit` 通过
2. Stage 2 验证：配置含 `spatial` 段的世界包 → 加载成功 → 物化后 entity_states 包含 `spatial` namespace
3. Stage 3 验证：AI agent 发出 `move` intent → dispatch 成功
4. Stage 4 验证：同一 tick 多 agent 产生事件 → 感知管线过滤

但这些验证是**开发者手动执行的**，不是**自动化端到端测试**。`tests/e2e/` 目录中没有 `snowbound_mansion` 的端到端验证。文档中没有"原型世界包运行 24 小时后的观察报告"或"agent 行为日志样本"。

**宏系统的实际限制**（**已于 2026-05-11 解决，见 `.limcode/design/macro-typed-value-system-design.md`**）：~~`snowbound_mansion/config.yaml` 的注释明确承认："pick 宏的 from 参数仍使用逗号分隔字符串（macro handler 签名限定 args 为 `Record<string, string>`）"。这意味着即使在这个"已完成"的宏系统中，**参数类型只有字符串**。无法传递数字、布尔值或数组。`TODO.md` 中的技术债务 #3 也指出 `variables` schema 不支持数组。这与设计文档中声称的"带类型输出：number / string / string[]"矛盾。~~ 宏系统已全面升级为 `MacroValue` 类型体系，支持 number、boolean、null、数组、对象字面量。内置宏 `int`/`float`/`roll` 返回 number，`pick` 返回 string 或 string[]。`expandStateJson` 保留 JSON 类型。`variables` schema 的数组支持也已一并实现。

**世界包生态**：目前仓库中只有 2 个世界包（`death_note` 和 `snowbound_mansion`），且都是项目维护者编写的。没有第三方世界包，没有世界包市场，没有世界包兼容性测试矩阵。一个平台的价值在于其生态系统，而 Yidhras 的生态系统目前为**零**。

**Gaps**：
- [ ] 原型世界包的自动化端到端测试（24 小时连续运行）
- [x] 宏系统的真类型支持（number、boolean、array）— 已于 2026-05-11 实现
- [ ] 第三方世界包的兼容性验证工具
- [ ] 世界包市场/分发机制
- [ ] 世界包版本升级路径（config.yaml 结构变更时如何迁移旧包？）
- [ ] 世界包性能基准（加载时间、内存占用、推理延迟）

**Verdict**：世界包系统的基础设施（schema、loader、materializer、scaffold）已完成，但**内容生态尚未起步**。原型世界包缺乏自动化验证。宏系统的类型限制已于 2026-05-11 解决。

---

### 4.12 数据清洗与扩展接口（DataCleaner）

**Claim**："已建立 DataCleaner 统一抽象"、"数据的策略性清洗接口"

**Evidence**：
- `packages/contracts/src/data_cleaner.ts`：类型定义
- `apps/server/src/plugins/extensions/data_cleaner_registry.ts`：**47 行**
- `TODO.md` 列出待实现：专用语义提取/验证库、NLP 与模糊技术、规则引擎与决策流、机器学习辅助清洗、向量化字符串操作

**Skeptical Audit**：

这是一个**极其典型的"接口先行、实现为零"案例**。DataCleaner 的注册表只有 47 行代码，提供 register/get/list/clean 四个方法。但：
- 没有内置的 DataCleaner 实现
- 没有语义提取库
- 没有 NLP 集成
- 没有规则引擎
- 没有 ML 辅助
- 没有向量化字符串操作

`TODO.md` 中的 5 项待实现全部处于**未开始**状态。这是一个**完全空白的子系统**，只有一个接口定义和注册表。文档中的"已建立统一抽象"实际上是在说"我们已经定义了一个接口，但没有任何实现"。

**Gaps**：
- [ ] 所有 5 项待实现内容（语义提取、NLP、规则引擎、ML、向量化）
- [ ] 内置 DataCleaner（如文本清理、格式校验、敏感信息过滤）
- [ ] DataCleaner 的测试覆盖率

**Verdict**：DataCleaner 是一个**空壳子系统**。它的存在只是为了在架构图上占据一个位置。

---

### 4.13 测试体系

**Claim**："unit + integration + e2e"、"948 unit + 227 integration，零回归"

**Evidence**：
- `apps/server/tests/unit/`：大量单元测试
- `apps/server/tests/integration/`：30+ 个集成测试文件
- `apps/server/tests/e2e/`：存在
- `apps/web/tests/unit/`：20+ 个前端单元测试
- CI：`server-tests.yml` 运行 integration test；`server-smoke.yml` 运行 smoke test

**Skeptical Audit**：

**e2e 测试的实际情况**：`AGENTS.md` §4 明确说："`test:e2e` 是 not in the default CI gate; it's for local/manual verification"。这意味着：
- e2e 测试在每次 push/PR 时不运行
- e2e 测试可能是脆弱的、耗时的、需要特定环境的
- "零回归"的声称只适用于 unit + integration，不包括 e2e

**测试并行度限制**：
- unit：default parallelism（正常）
- integration：`fileParallelism: false`（串行）
- e2e：`fileParallelism: false`（串行）

串行测试意味着测试套件的总执行时间会随测试文件数量线性增长。当前 227 个 integration test 已经需要串行执行，当测试数量翻倍时，CI 时间会翻倍。

**前端测试**：`apps/web/tests/unit/` 中只有 store、route、composable 的单元测试，没有组件测试（没有使用 Vue Test Utils 或 Cypress/Playwright）。`PLUGIN_RUNTIME.md` §10 也承认："GUI 测试主要仍以 composable / unit 为主，页面级交互测试还可继续补强"。

**Coverage 盲点**：
- Rust sidecar 的测试覆盖率未知（无独立 `tests/` 目录，但 `memory_trigger_sidecar` 中有 4 处 `#[cfg(test)]` 内联测试；`world_engine_sidecar` 和 `scheduler_decision_sidecar` 未找到测试代码）
- AI Gateway 的 OpenAI adapter 是否有 mock server 测试？（可能有，但真实 API 调用的测试覆盖率未知）
- 前端页面级交互测试缺失
- 性能测试和负载测试缺失

**Gaps**：
- [ ] e2e 测试纳入 CI gate
- [ ] Rust sidecar 的单元测试
- [ ] 前端组件级和页面级 E2E 测试（Playwright/Cypress）
- [ ] 性能基准测试（scheduler throughput、AI gateway latency、memory retrieval latency）
- [ ] 负载测试（100 agent 并发推理时的系统稳定性）
- [ ] 混沌测试（sidecar crash、网络分区、数据库故障）

**Verdict**：测试体系在**功能正确性**方面有较好覆盖，但在**端到端集成**、**性能**和**故障恢复**方面存在明显缺口。"零回归"的声称只在 unit + integration 范围内有效。

---

### 4.14 部署与运维

**Claim**："Node.js 18+"、"pnpm 10+"、"start-dev.sh"、"prepare:runtime"

**Evidence**：
- `start-dev.sh`：开发启动脚本
- `package.json`：scripts 定义
- `.github/workflows/`：CI 配置存在

**Skeptical Audit**：

**生产部署配置缺失**：
- 没有 Dockerfile
- 没有 docker-compose.yml
- 没有 Kubernetes manifest
- 没有 Helm chart
- 没有 Terraform / Pulumi 配置
- 没有环境配置模板（production.yaml、staging.yaml）

文档中的所有命令都是**开发环境**命令（`pnpm dev`、`pnpm prepare:runtime`、`./start-dev.sh`）。没有一条命令是用于**生产部署**的。`AGENTS.md` 中提到的 `DATABASE_URL` 默认指向 `file:../../../data/yidhras.sqlite`，这是一个相对路径，在容器化部署中完全不可用。

**运行时数据管理**：`data/` 目录是 runtime data area，gitignored。在开发环境中，数据存在本地文件系统。在生产环境中：
- SQLite 文件需要持久化存储（PV/PVC in K8s，或 EBS 卷）
- 数据备份策略是什么？
- 数据迁移策略是什么？
- 如果运行多个实例（HA），SQLite 文件不能共享，必须使用 PostgreSQL。但切换到 PostgreSQL 后，快照功能不可用

**监控和告警**：
- 有 `system/notifications` API 返回系统通知
- 有 scheduler observability 接口
- 但**没有外部监控系统集成**（Prometheus metrics、Grafana dashboard、PagerDuty/Slack 告警）
- 日志格式是文本日志，不是结构化 JSON（不便于集中化日志分析）

**Gaps**：
- [ ] Dockerfile 和容器化构建流程
- [ ] 生产环境配置管理（12-factor app 合规性）
- [ ] 数据库备份和恢复自动化
- [ ] 监控系统集成（Prometheus、Grafana）
- [ ] 结构化日志（JSON format）
- [ ] 健康检查的完整实现（`/api/health` 有，但 readiness/liveness probe 的语义需要更细粒度）
- [ ]  graceful shutdown（SIGTERM 时的连接清理、sidecar 进程终止）

**Verdict**：项目的**运维成熟度为零**。所有文档和工具都是面向开发者的，没有面向 SRE/运维工程师的生产部署指南和工具。

---

## 5. 架构层面的结构性幻觉

### 5.1 "Modularization First" 的形式化陷阱

项目反复强调"模块化优先"、"port 收口"、"facade 模式"。这些设计模式在代码中确实存在（`RuntimeKernelFacade`、`SchedulerObservationPort`、`ContextAssemblyPort` 等）。但问题在于：

**形式化的接口不等于可替换的实现**。例如：
- `PackStorageAdapter` 接口有 SQLite 和 PostgreSQL 两个实现。但 PostgreSQL 实现使用 schema-per-pack，这在生产 PostgreSQL 中需要超级用户权限。如果实现不可替换（因为运维限制），接口的形式化就没有价值。
- `SchedulerStorageAdapter` 接口只有 SQLite 实现。接口的存在暗示未来可能有 PostgreSQL 实现，但如果没有这个实现的计划，接口就是**架构上的透支**。

### 5.2 "分层架构"的过度分层

Server 内部分层：Routes → Services → Workflow/Runtime → PackRuntime/Governance。这个分层在概念上正确，但在实践中：

- **Routes 层并不薄**。`API.md` 列出了 50+ 个路由端点，每个端点有参数校验、错误码、鉴权逻辑。这是一个厚重的 transport 层。
- **Service 层与 Workflow 层的边界模糊**。`inference_workflow.ts` 被描述为 facade，但拆分成 8 个子文件（parsers、results、snapshots、ai_invocations 等）。这些子文件之间的依赖关系是否形成了新的紧耦合？
- **Runtime 层直接操作数据库**。`PackSimulationLoop` 调用 `SchedAdapter` 读写 SQLite，同时调用 `WorldEnginePort` 与 Rust sidecar 通信。这意味着 runtime 层同时承担了 orchestration 和 persistence 的职责。

### 5.3 "Rust 迁移"的战略性误导

文档反复提到"Rust world engine"、"Rust sidecar"、"Rust 迁移"，给人一种"核心计算正在向 Rust 转移"的印象。但实际情况是：

- Rust 代码总量 < 4,500 行，而 TS 代码量（仅 `apps/server/src/`）约 70,000 行
- Rust sidecar 只负责：step prepare/commit、objective execution、memory trigger
- TS 侧负责：HTTP API、调度、AI 调用、prompt 构建、上下文组装、插件生命周期、权限校验、审计日志、前端服务
- **90% 以上的业务逻辑仍在 TS 侧**

这不是"Rust 迁移"，这是"Rust 外包了三个计算密集型任务"。术语的选择（"world engine"、"kernel"）夸大了 Rust 组件的架构重要性。

### 5.4 "多包运行时"的伪分布式

文档描述了一个复杂的多包运行时架构（主包 vs 附加包、`PackRuntimeRegistry`、`PackRuntimeHandle`、`PackScopeResolver`）。但：

- 所有 pack 运行在同一个 Node 进程中
- 所有 pack 共享同一个事件循环
- 所有 pack 的 Rust sidecar 是独立进程，但由同一个 Node 宿主 spawn
- 没有 pack 间的资源隔离（一个 pack 的无限循环会拖垮所有 pack）

这本质上是一个**单进程多租户**模型，使用了分布式系统的词汇（registry、handle、scope、partition）来描述。术语的错位制造了"系统可以横向扩展"的幻觉。

---

## 6. 文档债务与自我欺骗

### 6.1 文档与代码的比例失衡

粗略统计：

| 类别 | 规模估算 |
|------|---------|
| 设计文档（`.limcode/design/`） | ~350 KB |
| 计划文档（`.limcode/plans/`） | ~80 KB |
| 稳定参考文档（`docs/`） | ~200 KB |
| 后端 TS 源代码（`apps/server/src/`） | ~70,000 行 |
| 前端 Vue/TS 源代码（`apps/web/`） | ~31,500 行（Vue SFC ~6,100 行 + TS ~25,400 行） |
| Rust 源代码 | ~4,500 行 |
| **代码总计** | **~106,000 行** |

文档总量约 630 KB，代码量约 106,000 行。

### 6.2 "状态：完成"的宽松定义

`.limcode/design/spatial-semantics-design.md` 顶部标注"状态: 完成 · A 层 Phase 1 全部完成"。但 "完成" 的定义是：
- 基础设施代码已合并？是。
- 单元测试通过？是。
- 原型世界包端到端验证？配置存在，但无运行报告。
- AI agent 能自主使用空间功能？未验证（move intent 代码链路完整，但端到端 AI 行为未经自动化验证）。
- 前端能可视化空间？否。

这种 "完成" 是**开发者视角的完成**，不是**用户视角的完成**。用户（世界包作者、操作员）关心的是"我能不能创建一个空间世界并让 AI 在里面自主移动"，答案是"不能"。

### 6.3 技术债务的"不阻塞当前阶段"陷阱

`TODO.md` 中有多项技术债务被标记为"不阻塞当前阶段"：
- `ConversationEntry.archived` 无限增长
- flaky test `death-note-memory-loop.spec.ts`
- ~~variables schema 不支持数组~~（已解决：2026-05-09 新增 array 支持，2026-05-11 宏类型系统升级）
- ~~插件 Host API 无 AI 推理接口~~（已解决：`requestInference` 已实现）
- ~~插件 API 无 `registerPerceptionResolver`~~（已解决：已实现并接入感知管线）

这种标记创造了一个**虚假的进度感**："我们知道这些问题，但它们不紧急"。但实际上，这些问题中的每一个都会在未来成为阻塞性障碍。~~例如，variables 不支持数组意味着所有世界包的配置必须使用逗号分隔字符串，这会在世界包生态扩大时成为兼容性噩梦。~~ 此项已不存在。

---

## 7. 落地所需的真实工作量估算

以下估算是基于**生产级可用**标准的怀疑性评估，不是基于"demo 可用"。

### 7.1 最小可用产品（MVP）缺口

要让一个世界包能够**自主运行 24 小时而不需要人工干预**，至少需要：

| 工作项 | 估算工作量 | 优先级 | 阻塞性 |
|--------|-----------|--------|--------|
| AI `move` intent 的 prompt 工程接地 | 2-3 天 | P0 | **是** — 空间语义无法使用 |
| 非 OpenAI provider 适配器（至少 2 个） | 3-5 天 | P0 | **是** — 单 provider 不可接受 |
| 前端空间地图可视化（地点邻接图） | 3-5 天 | P1 | 否 — 前端缺失不影响后端 |
| 插件 AI 推理接口 (`requestInference`) | 2-3 天 | P1 | 否 — 影响插件生态 |
| 原型世界包自动化 e2e 测试 | 2-3 天 | P1 | 否 — 验证需要 |
| 安全中间件（helmet、rate limit） | 1-2 天 | P0 | **是** — 生产安全 |
| Dockerfile + 容器化构建 | 2-3 天 | P0 | **是** — 无法部署 |
| 生产环境配置管理 | 2-3 天 | P0 | **是** — 运维需要 |
| PostgreSQL 部署文档和权限方案 | 2-3 天 | P1 | 否 — SQLite 可先运行 |
| 结构化日志和监控指标 | 3-5 天 | P1 | 否 — 运维需要 |
| **MVP 合计** | **~25 天** | | |

### 7.2 完整平台缺口

要让 Yidhras 成为文档中描述的**完整"罗生门模拟基础设施"**，还需要：

| 工作项 | 估算工作量 | 说明 |
|--------|-----------|------|
| B 层连续几何 + C 层抽象度量空间 | 15-20 天 | 含 schema、runtime、query、visualization |
| 多轮对话 Tag 系统实现 | 10-15 天 | 设计文档 50KB，实现量不小 |
| Streaming/SSE 支持 | 5-7 天 | 需要前端重构为实时模式 |
| 前端实时交互（操作员与 agent 对话） | 10-15 天 | WebSocket/SSE + UI |
| 插件沙箱（isolated-vm 或 WASM） | 10-15 天 | 安全必须 |
| DataCleaner 全部 5 项实现 | 20-30 天 | NLP、规则引擎、ML 辅助等 |
| 向量索引（pgvector / LanceDB） | 5-7 天 | 十万级实体需要 |
| 声音传播模型（Layer 2） | 5-7 天 | 原型世界包需要 |
| 多模态 AI 支持（图像、音频） | 10-15 天 | 长远需要 |
| 第三方世界包生态工具 | 10-15 天 | 兼容性验证、市场、分发 |
| 性能基准测试和优化 | 10-15 天 | scheduler、memory、workflow |
| 混沌测试和故障恢复 | 5-7 天 | sidecar crash、网络分区 |
| **完整平台合计** | **~130-170 天** | 约 6-8 个月（假设 2 名全职工程师） |

### 7.3 隐性债务

还有一些难以估算的隐性债务：

- **架构简化**：当前架构中存在大量"形式化接口"和"未来扩展点"，这些代码需要维护但尚未被使用。随着项目成熟，可能需要**删除** 30-50% 的当前代码（YAGNI 原则）。
- **文档同步**：当前文档量约为代码量的 2-3 倍（按字节计）。每次代码变更需要同步更新多个文档，这是巨大的维护负担。
- **Rust/TS 边界摩擦**：随着功能增加，Rust sidecar 和 TS 宿主之间的通信频率会增加。stdio IPC 可能成为瓶颈，需要替换为更高效的 IPC（Unix socket/shared memory），这是一个**架构级重构**。
- **AI 成本失控**：如果平台运行 100 个 agent，每 tick 每个 agent 调用一次 OpenAI API，每次调用 $0.01，tick interval 3 秒，则每小时成本 = 100 × (3600/3) × $0.01 = **$1,200/小时**。没有成本控制和缓存机制，平台无法商业化。

---

## 8. 结论：距离地球还有多远

### 8.1 当前位置

Yidhras 目前处于 **"功能验证阶段晚期 / 工程化阶段早期"**。用航天比喻：

- **文档和设计**：已在火星轨道绘制了完整的登陆路线图，甚至设计了火星基地的室内装修方案
- **核心基础设施**：火箭主体已组装，引擎可以点火，但只能进行亚轨道飞行
- **AI 推理**：依赖单一燃料供应商（OpenAI），没有替代燃料
- **前端**：地面控制中心可以监控火箭状态，但不能与宇航员实时对话
- **插件系统**：允许第三方安装设备，但没有安全检查，一颗螺丝松了可能炸毁整艘船
- **空间语义**：着陆舱已造好，但宇航员还不能操作它移动
- **部署运维**：没有发射台，火箭目前只能在车间里试运行

### 8.2 最危险的幻觉

项目最危险的幻觉是**"架构成熟度假象"**。通过大量的文档、精心设计的接口、形式化的分层和术语体系，项目制造了一种"我们已经完成了 80%"的感觉。但实际上：

- **已完成的部分**：Express API、Prisma CRUD、基础调度循环、Prompt 组装管道、权限校验、插件注册表
- **未完成的部分**：AI 行为的真正自主性、多 provider 生态、前端交互、生产部署、安全加固、性能优化、生态工具

已完成的部分是**通用的 Web 后端工程**（任何中级 Node.js 开发者都能搭建）。未完成的部分是**项目的独特价值所在**（AI 驱动的自主叙事模拟）。

### 8.3 建议的着陆路径

如果目标是**尽快落地一个可演示、可运行的叙事模拟**，建议：

1. **冻结架构扩展**：停止新增抽象层、接口、port、facade。当前架构已经足够复杂。
2. **补齐 AI 行为链路**：`move` intent 的 prompt 工程接地是最高优先级。没有它，空间语义只是装饰。
3. **接入第二个 AI provider**：DeepSeek 或 Anthropic，降低对 OpenAI 的依赖。
4. **前端最小交互**：让操作员能在前端与 agent 发送消息，看到实时响应（即使通过轮询）。
5. **容器化部署**：一个 Dockerfile，让项目能在任何机器上 `docker run`。
6. **自动化 e2e**：让 `snowbound_mansion` 能自动运行 100 ticks 并输出行为日志。

如果目标是**文档中描述的完整平台**，则需要：
- 6-8 个月的持续开发
- 至少 2 名全职后端工程师 + 1 名前端工程师 + 1 名 AI/ML 工程师
- 充足的 AI API 预算用于测试和优化
- 对架构进行**减法**（删除未使用的抽象）而不是加法

### 8.4 最终评分

| 维度 | 评分（1-10） | 说明 |
|------|------------|------|
| 概念创新性 | 8 | 空间语义 + 感知管线 + 事件驱动闭环是优秀的设计 |
| 文档完整性 | 9 | 文档体系是项目最强的部分 |
| 代码落地度 | 5 | 基础功能有实现，但核心 AI 行为链路缺失 |
| 前端可用性 | 4 | 监控后台，非交互平台 |
| 生产就绪度 | 2 | 无部署配置、无安全加固、无监控 |
| 生态可扩展性 | 3 | 插件无隔离、世界包无市场、无第三方工具 |
| 成本可控性 | 2 | 单 provider、无缓存、无成本优化 |
| **综合绝望指数** | **7.5 / 10** | **在太空中漂浮，能看到地球，但缺乏着陆所需的燃料和导航系统** |

---

## 附录：审查中使用的关键文件清单

### 文档（被审查的主张来源）
- `README.md`
- `docs/ARCH.md`
- `docs/ARCH_DIAGRAM.md`
- `docs/LOGIC.md`
- `docs/specs/API.md`
- `docs/specs/WORLD_PACK.md`
- `docs/subsystems/AI_GATEWAY.md`
- `docs/subsystems/PROMPT_WORKFLOW.md`
- `docs/subsystems/PLUGIN_RUNTIME.md`
- `TODO.md`
- `.limcode/enhancements-backlog.md`
- `.limcode/design/spatial-semantics-design.md`
- `.limcode/design/prototype-world-pack-implementation.md`
- `.limcode/design/technical-debt-from-prototype-evaluation.md`
- `.limcode/design/multi-turn-conversation-design.md`
- `.limcode/design/slot-function-advanced-design.md`
- `.limcode/plans/foundation-enhancements-from-prototype-evaluation.md`

### 代码（被验证的实现证据）
- `apps/server/src/` 全部 TS 源码（~423 个 .ts 文件，约 70,000 行）
- `apps/server/rust/` Rust sidecar 源码（~4,500 行，`memory_trigger_sidecar` 含 4 处 `#[cfg(test)]` 内联测试）
- `apps/web/` 前端源码（~6,100 行 Vue SFC + ~25,400 行 TS，合计约 31,500 行）
- `apps/server/prisma/schema.prisma`（691 行）、`schema.sqlite.prisma`（648 行）、`schema.pg.prisma`（648 行）
- `apps/server/tests/` 全部测试（179 个 spec 文件；980 unit + 227 integration 为原始报告声称的 case 数，未逐一验证）
- `data/world_packs/snowbound_mansion/config.yaml`
- `packages/contracts/src/` 共享类型

---

> 本报告的目的不是否定项目的价值，而是**用怀疑性的手术刀切开文档与代码之间的泡沫**，让团队看到真实的工程债务和落地距离。只有当幻觉被戳破，真正的着陆才能开始。

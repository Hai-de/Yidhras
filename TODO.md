# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 大型任务

#### 数据的策略性清洗接口

> 已建立 DataCleaner 统一抽象（`packages/contracts/src/data_cleaner.ts`），全局注册表在 `apps/server/src/plugins/extensions/data_cleaner_registry.ts`。
> 设计文档: `.limcode/design/plugin-expansion-design.md`
> 能提供接口就只供接口，复杂的功能应当通过外接来实现
- [x] 1. 正则引擎 → `data_cleaner.regex` — 含 ReDoS 防护（长度限制、嵌套量词检测、超时、匹配计数上限）
- [x] 4. 基础字符串方法 → `data_cleaner.string` — 7 种模式（trim/lowercase/uppercase/collapse_ws/strip_html/strip_control/strip_punctuation）
- [x] 2. 结构化语法解析器
- [ ] 3. 专用语义提取/验证库
- [ ] 5. 自然语言处理（NLP）与模糊技术
- [ ] 6. 规则引擎与决策流
- [ ] 7. 设计接口让机器学习辅助清洗
- [ ] 8. 向量化字符串操作

#### 测试覆盖

- 23 单元测试（dependency_resolver: 16, data_cleaner_registry: 7）
- 10 集成测试（依赖检查 enable/disable、global-scope、load order）
- 7 e2e 测试（HTTP API 端到端）

### 提示词流水线升级

阶段二的 上下文构建（Context Builder）：
- 项目尚未上线也没有使用者，需要清理上下文构建（Context Builder）中的兼容性别名，且允许提供别名，只要是符合特定的语法（语法设置的方式尚未决定）

#### 阶段三：提示词构建（Prompt Workflow）

> 设计文档：`.limcode/design/prompt-workflow-system-b-advancement-design.md`
> 推进计划：`.limcode/plans/prompt-workflow-system-b-advancement-plan.md`

##### 多轮对话（Multi-Turn Conversation） — 阶段一 ✅ 完成

> 设计文档：`.limcode/design/multi-turn-conversation-design.md`
> 阶段一计划：`.limcode/plans/multi-turn-conversation-phase1.md`

阶段一（2026-05-05 完成）：

- [x] `ConversationEntry` + `AgentConversationMemory` 类型定义（含 `kind`、`turn_range`、`modifications` 上限 50）
- [x] `ConversationStore` 接口 + Prisma 实现（`ConversationMemory` + `ConversationEntryRecord` 表）
- [x] `ConversationFormatConfig` 类型 + YAML schema + 配置域（`data/configw/conf.d/conversation.yaml`）
- [x] `ConversationAssembler` 实现（全路径取代旧的 `adaptPromptTreeToAiMessages`，已删除）
- [x] `conversation_history` slot 加入 `PromptFragmentSlot` 联合类型
- [x] `runConversationHistoryTrack` 轨道（per-entry draft + `getVisibleEntries` 截断）
- [x] `InferenceContext` 扩展（`agent_conversation_memory` + `current_agent_id` + `conversation_profile`）
- [x] `PromptWorkflowProfile` 扩展（`conversation_profile` + `tracks.conversation_history`）
- [x] 静态 profile（`chat-first-turn`、`chat-follow-up`）+ 轻量路径
- [x] 滑动窗口截断（`window_turns`）+ token_budget_trim 反转裁剪
- [x] `source_inference_id` + `derived_from_entry_ids` 写入捕获
- [x] 推理管线接入（`task_service` 全走 assembler + `executeRunInternal` writeback）+ 双向事务写入
- [x] 测试：29 集成测试 + 单元覆盖

阶段二/三待实现（设计文档：`.limcode/design/multi-turn-conversation-design.md`）：
- [ ] 多 agent transcript 嵌入（默认模式）+ 消息级别注入点
- [ ] 一对一角色映射降级为配置门控简化选项
- [ ] AI 摘要压缩（Hybrid 方案：截断兜底 + 独立压缩路径 + 写入后触发 + 软归档 + agent opt-in）
- [ ] 压缩到单一 role + 因果图查询
- [ ] 自适应轨道选择、per-conversation 配置覆盖
- [ ] Tag 系统（类型/Prisma schema 已就位，用途尚在讨论中，待决定后激活）
- [ ] `SlotFunctionRegistry` — 已移出阶段三，作为独立设计项目（涉及图灵完备执行核心、双模块架构）

#### 已知技术债务（不阻塞当前阶段）

- `ConversationEntry.archived` 软归档后 entries 数组无限增长 — 需日后实现定期物理归档到冷存储（如按年份归档到独立表、或导出为 JSON 文件并删除 DB 行）

##### 插槽函数（链表）

- 内置slot既然可以被关闭，那自然可以使用类似的宏语法或者函数名"{{system_core}}"来指代原来已经被禁用的内置slot
- 内置的slot可以被关闭，但始终存在用来定位， slot 定义加入绝对位置和相对位置的动态定位功能，方便其他的动态的slot在slot之间插入和移除
> ⚠ 当前 System B 只有 fragment 层面的 anchor/placement，没有 slot 之间的位置关系。Slot 定位系统需要独立设计，`PromptFragmentPlacementMode` 可作为基础类型扩展

- 引入函数的内联/嵌套/封装/作用域概念，让插槽函数升级为顶层空间，
- 允许在顶级空间之外定义变量作为全局变量，包括宏定义也是
> ⚠ 当前 System B 将宏展开限制为单次扁平替换。嵌套/作用域需要独立的宏系统设计

- 高级功能：允许执行（需要图灵完备的）代码，处理： 深度/顺序/触发概率/群组权重/扫描深度/逻辑匹配/始终激活/条件激活/黏性（出发后保留次数）/触发后冷却时间/延迟触发/延迟递归/不可递归/防止进一步递归/无视上下文长度/关键字匹配/向量化触发 等等高级且复杂的功能，尚不确定使用脚本语言lua/js/rust或者是其他方式实现核心模块，但毫无疑问需要被隔离
> ⚠ `SectionDraft.metadata: Record<string, unknown>` 可作为触发概率、冷却时间等元数据的扩展点，未来 executor 可消费这些字段

- 双重模块设置，一个是当前的Prompt Tree V2，另一个是更复杂拥有插槽函数的核心
> ⚠ 双模块路线与当前 System B 的线性 pipeline 架构有根本性差异（图灵完备 vs 声明式 pipeline），需要在插槽函数核心设计启动时明确边界

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

- 22 单元测试（dependency_resolver: 15, data_cleaner_registry: 7）
- 10 集成测试（依赖检查 enable/disable、global-scope、load order）
- 7 e2e 测试（HTTP API 端到端）

### 提示词流水线升级

#### 阶段三：提示词构建（Prompt Workflow）

> 设计文档：`.limcode/design/prompt-workflow-system-b-advancement-design.md`


##### 多轮对话（Multi-Turn Conversation）

> 设计文档：`.limcode/design/multi-turn-conversation-design.md`

- [x] 自适应轨道选择（`ProfileResolver` + `chat-first-turn` / `chat-follow-up` 静态策略）
- [x] per-conversation 配置覆盖（`resolveEffectiveFormatConfig` A+C 混合方案）
- [ ] Tag 系统（类型/Prisma schema 已就位，用途尚在讨论中，待决定后激活）


#### 已知技术债务（不阻塞当前阶段）

- `ConversationEntry.archived` 软归档后 entries 数组无限增长 — 需日后实现定期物理归档到冷存储（如按年份归档到独立表、或导出为 JSON 文件并删除 DB 行）

##### 插槽函数

> 模板引擎统一已完成（`.limcode/design/template-engine-unification-design.md`），以下各项的进展标注基于 `template_engine/` 当前能力。

- [x] 内置slot既然可以被关闭，那自然可以使用类似的宏语法或者函数名"{{system_core}}"来指代原来已经被禁用的内置slot
> ✅ 已实现 POC：`slot-ref` 块处理器 (`{{#slot-ref "system_core"}}fallback{{/slot-ref}}`)，内联 slot 引用 (`{{system_core}}`) 通过 Narrative `VariableResolver` 查询 slot 注册表分流。实现位于 `template_engine/frontends/slot_function/blocks.ts`

- [x] 内置的slot可以被关闭，但始终存在用来定位， slot 定义加入绝对位置和相对位置的动态定位功能，方便其他的动态的slot在slot之间插入和移除
> ⚠ slot 定位系统需要独立设计（`PromptFragmentPlacementMode` 层面），不属于模板引擎统一范围
> Phase 1 ✅ / Phase 2 ✅ / Phase 3 ✅ / Phase 4 ✅ — 插槽定位系统全部完成
> ⚠ 已知问题：Phase 3 实现后暂无 track 产出 `before_anchor`/`after_anchor` 的 section draft，锚点解析逻辑仅通过单元测试覆盖，待后续有实际消费需求时接入。

- [x] 引入函数的内联/嵌套/封装/作用域概念，让插槽函数升级为顶层空间
- [x] 允许在顶级空间之外定义变量作为全局变量，包括宏定义也是
> ✅ `RenderContext.scopeStack` 已在共享内核实现；`scope` 块接口已定义 (`{{#scope var=val}}...{{/scope}}`)，完整实现待插槽函数核心设计确定

- [ ] 高级功能：允许执行任意代码，处理： 深度/顺序/触发概率/群组权重/扫描深度/逻辑匹配/始终激活/条件激活/黏性（出发后保留次数）/触发后冷却时间/延迟触发/延迟递归/不可递归/防止进一步递归/无视上下文长度/关键字匹配/向量化触发 等等高级且复杂的功能，尚不确定使用脚本语言lua/js/rust或者是其他方式实现核心模块，但毫无疑问需要被隔离
> ⚠ 图灵完备脚本执行需要独立沙箱运行时，不在声明式模板引擎范围内

- [ ] 双重模块设置，一个是当前的Prompt Tree V2，另一个是更复杂拥有插槽函数的核心
> ⚠ 双模块路线需在插槽函数核心设计启动时明确边界


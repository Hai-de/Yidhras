# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/specs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 大型任务

#### 上层语义变迁 — 空间语义层

> 设计文档：`.limcode/design/spatial-semantics-design.md`
> 当前系统有成熟的时间维度（ChronosEngine tick-based）和拓扑关系维度（L2 Relationship），但零空间基础设施。

- [ ] A 层：离散位置（命名地点 + 邻接图）
  - [x] world pack constitution 添加 `spatial` 可选段：地点定义 + 邻接关系 + 空间规则
  - [x] EntityState 约定 `location: room_id` 空间状态 schema
  - [x] 空间上下文源注入推理管线（"谁在附近"、"同地点事件")
  - [x] 空间事件传播步骤加入 sim loop（当前 5 步 → 6 步）— 感知管线，产出 overlay entry
  - [x] 客规执行谓词扩展：`location_in`、`adjacent_to` — enforcement engine 侧预过滤
  - [ ] 前端最小地图/位置视图（原型阶段不需要）
  - [ ] 原型世界包验证（题材已在整理中）
  - [ ] `move` intent 接地逻辑 — dispatcher 分支已实现，AI → intent 的解析（"走向厨房" → `move(target='kitchen')`）后续由 prompt 工程处理
- [ ] B 层：连续几何（坐标 + 度量函数）— 依赖 A 层完成，需求驱动
  - [ ] 实体携带 (x, y[, z]) 连续坐标
  - [ ] 可配置距离函数（欧氏 / 曼哈顿 / 自定义）
  - [ ] 空间范围查询（半径内实体）
- [ ] C 层：抽象度量空间（属性维度构成向量空间）— 依赖 B 层完成，需求驱动
  - [ ] 空间位置泛化为可度量属性维度的高维向量
  - [ ] 自定义度量函数注册机制
  - [ ] 降维可视化（投影观察窗）
- [ ] 空间索引：当前规模 SQLite JSON column + 纯 TS 即可；十万级实体时评估 pgvector / LanceDB
  > 2026-05-08: VectorStore（余弦相似度 + brute-force）已实现，语义记忆检索已满足。
- [ ] 可感知交互：投影观察窗 / 语义方向试控器 / 局部切片与关系解释 — 依赖 B/C 层
> 架构演变:
> 最初: L1 Social (Post/Noise) → L2 Relational (图谱) → L3 Narrative (Chronos) → L4 Transmission (延时/丢包)
> 目标: L1 Social+空间 (关系待定) → L2 Relational → L3 Narrative → L4 Transmission
> 空间作为可插拔领域层，由 world pack 声明其空间模型（A/B/C），不同世界可有不同空间语义

#### 数据的策略性清洗接口

> 已建立 DataCleaner 统一抽象（`packages/contracts/src/data_cleaner.ts`），全局注册表在 `apps/server/src/plugins/extensions/data_cleaner_registry.ts`。
> 设计文档: `.limcode/design/plugin-expansion-design.md`
> 能提供接口就只供接口，复杂的功能应当通过外接来实现
- [ ] 3. 专用语义提取/验证库
- [ ] 5. 自然语言处理（NLP）与模糊技术
- [ ] 6. 规则引擎与决策流
- [ ] 7. 设计接口让机器学习辅助清洗
- [ ] 8. 向量化字符串操作

### 提示词流水线升级

##### 多轮对话（Multi-Turn Conversation）

> 设计文档：`.limcode/design/multi-turn-conversation-design.md`
- [ ] Tag 系统（类型/Prisma schema 已就位，用途尚在讨论中，待决定后激活）


#### 已知技术债务（不阻塞当前阶段）

- `ConversationEntry.archived` 软归档后 entries 数组无限增长 — 需日后实现定期物理归档到冷存储（如按年份归档到独立表、或导出为 JSON 文件并删除 DB 行）
- `tests/integration/death-note-memory-loop.spec.ts` > `records revise_judgement_plan as overlay and plan memory block during action dispatch` — 预存 flaky 测试，`expected undefined to be truthy`。不阻塞当前阶段，需单独排查 memory overlay 记录逻辑

##### 插槽函数

> 模板引擎统一已完成（`.limcode/design/template-engine-unification-design.md`），以下各项的进展标注基于 `template_engine/` 当前能力。

- [x] 高级功能 — Phase 1–5 完成
> 设计：`.limcode/design/slot-function-advanced-design.md` | 计划：`.limcode/plans/slot-function-advanced-phase1-4.md`、`slot-function-advanced-phase5.md`
> 剩余：
>   - [ ] Phase 6+: Rust + wasmtime WASM 沙箱（需求驱动）
>   - [ ] 功能 B：双重模块设置（决策推迟）
- [ ] 双重模块设置，一个是当前的Prompt Tree V2，另一个是更复杂拥有插槽函数的核心
> ⚠ 决策推迟至功能 A Phase 1-5 复杂度评估完成后


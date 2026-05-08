# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项，完成后用户会直接移除。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/specs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 大型任务

#### 上层语义变迁
- [ ] 评估项目是否需要加入空间语义约束作为可插拔领域层，可能需要坐标、距离函数、空间索引、空间事件流
- [ ] 支持连续的几何场景，比如坐标(x, y, z)，看情况要不要变成可度量的属性维度构成的向量空间
- [ ] 有本地存储的需求，可能需要向量化数据库
  > 2026-05-08: MemoryBlock 已添加 `embedding` + `embedding_model` 列，VectorStore（余弦相似度 + brute-force 检索）已实现。
  > 当前规模下 SQLite JSON column + 纯 TS 余弦距离即可满足语义记忆检索，无需引入专用向量 DB。
  > 待规模升级时（十万级实体空间索引）再评估 pgvector / LanceDB。
- [ ] 项目需要可感知的交互，可能需要投影观察窗（降维可视化）/语义方向试控器/局部切片与关系解释，这种也在某种程度上切合项目开始时的主张
> 项目刚开始的设想架构:
> L1 Social: 社交层 (Post / Noise)
> L2 Relational: 关系图谱 (Cytoscape.js 可视化)
> L3 Narrative: 叙事逻辑 (Chronos Engine / Resolver)
> L4 Transmission: 物理传输层 (延时 / 丢包模拟)
> 项目当前希望的架构
> L1 Social: 社交或互动层 and 空间层（关系尚未明朗）
> L2 Relational: 关系图谱
> L3 Narrative: 叙事逻辑
> L4 Transmission: 物理传输层

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

##### 插槽函数

> 模板引擎统一已完成（`.limcode/design/template-engine-unification-design.md`），以下各项的进展标注基于 `template_engine/` 当前能力。

- [x] 高级功能 — Phase 1–5 完成
> 设计：`.limcode/design/slot-function-advanced-design.md` | 计划：`.limcode/plans/slot-function-advanced-phase1-4.md`、`slot-function-advanced-phase5.md`
> 剩余：
>   - [ ] Phase 6+: Rust + wasmtime WASM 沙箱（需求驱动）
>   - [ ] 功能 B：双重模块设置（决策推迟）
- [ ] 双重模块设置，一个是当前的Prompt Tree V2，另一个是更复杂拥有插槽函数的核心
> ⚠ 决策推迟至功能 A Phase 1-5 复杂度评估完成后


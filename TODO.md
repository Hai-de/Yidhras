# TODO

> 本文件只记录当前 backlog、优先级与最近一段时间的待处理事项。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### P0 下一阶段开发顺序（方案 A：架构优先）

- [x] **第一阶段：数据库边界治理（继续使用 Prisma，但降低迁移/更换成本）**
  - [x] 盘点 `context.prisma` / `sim.prisma` / `new PrismaClient()` 的直接依赖点，按模块分组（scheduler、inference、plugin、audit、projection、memory）
  - [x] 明确 kernel-side 数据、pack-owned 数据、read model / projection 数据、审计追踪数据的存储边界
  - [x] 为高频核心域补 repository / store / facade 收口，避免业务层继续直接散射 Prisma 查询
  - [x] 消除 `context.sim.prisma` 这类运行时穿透访问，统一经 AppContext 存储边界或专用仓储访问
  - [x] 让数据库迁移与更换更容易：优先做到“仍用 Prisma，但 schema / migration / repository 边界清晰”，而不是直接抽象成多 ORM
  - [x] 为部署者补数据库迁移/更换文档：环境变量、Prisma migration、初始化步骤、常见坑

- [x] **第二阶段：世界包与 Prompt Workflow 宏 / 变量系统正式化**
  - [x] 梳理变量来源优先级：system / app config / world pack / runtime state / actor / request / plugin
  - [x] 在现有 `NarrativeResolver` 基础上设计正式宏能力边界：默认值、条件、列表展开、命名空间、调试 trace
  - [x] 统一 Prompt Workflow、模板变量、世界包变量的作用域和覆盖规则，避免多套隐式机制并存
  - [x] 为宏展开与 Prompt Workflow 增加可观测诊断，保证出错时可定位
  - [x] 编写基础的文档，让使用者能上手

- [x] **第三阶段：把适合外置的硬编码参数迁到 YAML 配置**
  - [x] 继续沿用现有 `data/configw` / runtime config scaffold 机制，不另起一套配置系统
  - [x] 先迁移部署者关心的配置：运行端口、路径、provider/model route、feature flag、bootstrap 行为
  - [x] 再迁移世界包作者和运营调参关心的配置：prompt workflow profile、token budget、section policy、scheduler 阈值等
  - [x] 为配置补 schema 校验、注释说明、示例文件、首次启动自动生成逻辑
  - [x] 补配置介绍与部署文档，明确 env / yaml / code default 的优先级

- [X] **第四阶段：单世界包内的多实体并发请求**
  - [X] 完善实体在虚拟时钟下的活动行为分配和限制的多套方案
  - [X] 在单 active pack 前提下评估实体级并发，而不是直接进入多世界包并行
  - [X] 梳理 scheduler、job runner、ownership / lease、冲突控制与幂等要求
  - [X] 设计实体并发的分区、锁、重试、失败恢复与观测指标

- [x] **第五阶段：多世界包同时运行（这个阶段默认experimental / 默认关闭 / 先 operator / test-only）**
  - [x]  `SimulationManager` 从单 active pack 升级为多 pack runtime registry是实验性功能！！！
  - [x] 梳理 pack 级 clock、runtime speed、plugin runtime、projection、route context 的隔离要求
  - [x] 逐步改造前后端对“单 active pack”前提的依赖，避免一次性全栈返工

### P1 架构与实现跟进

- [ ] 继续观察 `SimulationManager` 与 runtime facade 的边界，决定是否需要下一轮收口
- [ ] 评估是否需要补充更正式的 capability / topic 文档承接 Prompt Workflow、Plugin Runtime、AI Gateway 等横切主题
- [ ] 如有需要，继续补 shared contracts 对 canonical pack/entity endpoint 的正式 schema

### P2 评估项

- [ ] 评估 `Event / Post / ActionIntent / InferenceTrace / DecisionJob` 的长期文档承载方式，避免继续散落在状态文档中
- [ ] 评估 relationship runtime evidence 的最终文档归属边界
- [ ] 评估是否需要把历史阶段性结论迁移到 `CHANGELOG.md` 或 `docs/history/`

## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。
- 已完成工作的证据、评审与结论，优先进入 `.limcode/review/`、`.limcode/progress.md` 或后续专门历史文档。

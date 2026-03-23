## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] Phase 0：冻结现有运行行为与错误包络，避免重构期语义漂移  `#br1`
- [ ] Phase 1：拆分 index.ts，提取 app/bootstrap/http/routes 层  `#br2`
- [ ] Phase 2：抽离共享校验、序列化、runtime gating、API helper  `#br3`
- [ ] Phase 3：按领域整理服务边界（system/world/identity/social/narrative/inference）  `#br4`
- [ ] Phase 4：补齐测试入口与重构验收清单  `#br5`
<!-- LIMCODE_TODO_LIST_END -->

# 后端重构路线草案（评估版）

## 1. 文档目的

这不是一份“立即开拆”的施工单，而是一份给你评估方向的后端重构路线草案。

目标是回答三个问题：

1. 当前后端最值得重构的地方是什么；
2. 应该按什么顺序拆，才不会把系统搞乱；
3. 哪些重构值得现在做，哪些应该延后。

本草案强调：

- **低风险、渐进式重构**，不是一次性翻修；
- **先收敛入口与边界**，再谈深入抽象；
- **服务当前 M2 规划**，而不是为了“看起来优雅”重构。

---

## 2. 基于当前代码结构的观察

结合当前 `apps/server/src` 的结构，可以看出后端已经具备一批相对清晰的领域模块：

- `clock/`
- `core/`
- `db/`
- `dynamics/`
- `identity/`
- `narrative/`
- `permission/`
- `world/`
- `utils/`

但也有一个非常明显的问题：

## 2.1 当前最大问题不是“模块太少”，而是“入口太重”

`apps/server/src/index.ts` 当前同时承担了很多职责：

- 进程启动与 preflight
- Express app 创建
- request id 注入
- 错误处理中间件
- world-pack readiness gating
- 参数解析与校验
- 各类 API route 定义
- simulation loop 启动
- 部分 identity / policy / binding 逻辑接线

这会带来几个后果：

1. **读入口文件成本很高**
2. **新增接口会继续把入口文件推向失控**
3. **共享逻辑难以复用**
4. **未来 inference 模块接入时容易继续堆在 `index.ts`**

所以我认为：

> 当前后端重构的第一优先级，不是改数据库，不是改算法，而是把 `index.ts` 从“超级脚本”拆成“应用装配层”。

## 2.2 第二个问题是“共享 HTTP 逻辑还挂在入口文件上”

从现有符号可以看出，`index.ts` 内部存在多类“其实应该被抽走”的通用逻辑，例如：

- `toJsonSafe`
- `asyncHandler`
- `assertRuntimeReady`
- `parsePositiveStepTicks`
- `parseOptionalTick`
- `validatePolicyConditions`
- request id / API error 组装逻辑

这些逻辑并不属于某个具体业务接口，它们属于：

- HTTP 基础设施
- 通用校验
- 运行时门禁
- 响应辅助能力

如果继续放在入口文件中，后续任何新模块都会倾向于“顺手继续加几个函数”。

## 2.3 第三个问题是“领域模块存在，但应用层边界还不够清晰”

现在的领域模块本身并不算乱，但“谁负责组装谁”还不够稳定。

例如未来你要接入 inference，会涉及：

- world-pack prompts
- identity / binding
- policy
- agent context
- tick
- route debug API
- runtime integration boundary

如果应用层不先重构，inference 很容易再次落入：

- route 层组装上下文
- route 层拼 prompt
- route 层直接调 provider
- runtime 再写一套平行逻辑

这才是后续复杂度爆炸的根源。

---

## 3. 重构目标

我建议当前后端重构只追求 5 个目标：

### G1. 让入口文件只负责装配，不再负责具体业务
`index.ts` 应该逐步退化成：

- 创建依赖对象
- 注册中间件
- 注册 routes
- 启动服务与 simulation

### G2. 把 HTTP 基础设施从业务逻辑中分离
例如：

- request id middleware
- error handler
- async wrapper
- runtime ready guard
- JSON safe serialization
- 通用参数解析器

### G3. 为 M2 推理模块预留干净接入点
不要让 inference 成为又一个塞进入口文件的大块逻辑。

### G4. 保持现有 API 语义基本稳定
本轮重构不追求对外破坏性变化。

### G5. 给未来测试与 smoke 脚本提供更稳定的装配边界
后面如果要补单元测试/模块测试，应用装配结构必须先清晰。

---

## 4. 不建议现在做的事情

为了防止重构失控，我建议这轮明确避免以下动作：

### 4.1 不做“一次性目录革命”
不要现在就把整个 `apps/server/src` 全部改成陌生结构。

例如不建议上来就把所有文件迁入：

- `application/`
- `domain/`
- `infrastructure/`
- `adapters/`

这种大改会让当前仓库认知成本瞬间升高。

### 4.2 不做“泛化过度”的架构抽象
比如现在就引入：

- CQRS
- 事件总线
- IOC 容器
- 完整 repository pattern
- 复杂模块注册系统

这些东西不是永远不能有，而是**现在引入收益不高，复杂度却会立刻上升**。

### 4.3 不把重构和业务新增混成一个大 PR
建议重构优先处理：

- 结构
- 边界
- 共享逻辑抽离

然后再接 M2 inference。

否则你会很难判断问题到底来自：

- 重构本身
- 还是新业务逻辑本身

---

## 5. 推荐重构路线

我建议按 4 个阶段推进。

---

## Phase 0：冻结行为边界（低成本准备阶段）

### 目标
在真正重构前，先确认哪些行为不能被改坏。

### 要做什么

1. 把当前“必须稳定”的行为列成清单：
   - `/api/status`
   - `/api/health`
   - `/api/clock`
   - `/api/clock/formatted`
   - `/api/runtime/speed`
   - `/api/system/notifications`
   - identity / binding / policy 相关 API
2. 明确重构期间不能改变的约束：
   - 统一错误包络
   - `X-Request-Id`
   - `WORLD_PACK_NOT_READY` 的 503 语义
   - BigInt 字符串化
3. 把当前 smoke 脚本当成重构护栏，而不是部署脚本。

### 为什么值得做
因为当前后端已经有一套比较明确的“运行时契约”，重构最大风险不是代码拆坏，而是**行为静悄悄变了**。

---

## Phase 1：拆分 `index.ts`（当前最值得做）

### 目标
把 `index.ts` 从“巨型入口文件”降级为“应用装配器”。

### 推荐拆分方向

建议新增类似结构：

```text
apps/server/src/
  app/
    create_app.ts
    middleware/
      request_id.ts
      error_handler.ts
    http/
      async_handler.ts
      runtime_guard.ts
      json_safe.ts
      validators.ts
    routes/
      system.ts
      clock.ts
      social.ts
      relational.ts
      narrative.ts
      identity.ts
      policy.ts
  core/
  world/
  identity/
  narrative/
  ...
  index.ts
```

### 具体含义

#### `index.ts`
最终只保留：

- 初始化 Prisma / SimulationManager / NotificationQueue
- 执行 startup preflight
- 创建 app
- 启动 HTTP server
- 启动 simulation timer

#### `app/create_app.ts`
负责：

- 创建 express app
- 注册 middleware
- 注册各 route 模块

#### `app/routes/*.ts`
负责：

- 每个 API 分组的 route 定义
- route 级参数收集
- 调用 service 或 manager

#### `app/http/*.ts`
负责：

- `asyncHandler`
- `assertRuntimeReady`
- `toJsonSafe`
- parse helpers
- 通用 request helpers

### 收益
这一阶段完成后：

- 入口文件会明显瘦身；
- 新增接口时不再默认写进 `index.ts`；
- M2 inference 可以作为 route module + service module 平滑接入。

### 风险
- import 路径会发生一批机械性调整；
- 需要谨慎处理 shared state（如 `runtimeReady`、`startupHealth`、`SimulationManager`、notifications）。

### 控制方法
建议通过 `AppContext` 对象统一向 route modules 传递依赖，例如：

- `prisma`
- `sim`
- `notifications`
- `startupHealth`
- `getRuntimeReady()`
- `assertRuntimeReady()`

这样可以避免 route 模块四处直接 import 全局可变状态。

---

## Phase 2：抽离共享应用层能力

### 目标
把“跨接口复用的基础能力”固定下来，减少重复代码和未来漂移。

### 建议抽离的能力

1. **HTTP 错误能力**
   - 统一 `ApiError`
   - 错误响应 helper
   - route 统一抛错方式

2. **序列化能力**
   - `toJsonSafe`
   - BigInt -> string
   - Date / nested object 安全处理

3. **参数解析与校验能力**
   - tick 解析
   - role/status 枚举校验
   - policy conditions 校验
   - include_expired 等 query parsing

4. **运行时门禁能力**
   - runtime ready guard
   - 统一 world-pack gating 入口

5. **启动与健康检查能力**
   - world pack dir resolving
   - preflight
   - startup health snapshot

### 为什么这一阶段重要
因为当前很多逻辑已经有“基础设施”的性质了，但仍然长在入口文件里。

如果这层不抽走，后面 route 虽然拆开了，但会出现另一种混乱：

- 每个 route 文件自己复制一套解析逻辑；
- 或者 route 间共享逻辑互相 import 得非常难看。

---

## Phase 3：整理领域模块边界

### 目标
让应用层调用路径更稳定，避免“路由知道太多领域细节”。

这一阶段不追求重写领域模块，而是做 **调用边界整理**。

### 3.1 System / Runtime 边界
建议把现在散落的系统能力整理为更明确的服务面：

- startup health service
- runtime speed service
- notification service
- runtime state snapshot service

这样 `/api/status`、`/api/health`、`/api/runtime/speed` 会更自然地归于 system 层。

### 3.2 Identity / Policy 边界
当前 identity 模块已经相对成型，但建议进一步明确：

- `identity/service.ts`：身份注册与绑定生命周期
- `identity/policy_engine.ts`：字段级评估
- route 层只做入参转换

重点不是重写，而是避免未来 inference 直接绕过这些模块去数据库拼自己的身份上下文。

### 3.3 Social / Narrative / Relational 边界
目前这几块逻辑很多还直接通过 Prisma 或 SimulationManager 暴露。

建议未来逐步转向：

- social service
- narrative service
- graph/relational service

但这一步我建议 **放在入口拆分之后**，不要现在同步大动。

### 3.4 Inference 接入边界（最关键）
重构路线必须服务你现在的 M2 重点，因此应提前预留：

- inference route module
- inference service module
- inference 对 system/world/identity 的依赖只通过明确接口进入

不要让 inference 成为：

- 又一个直接在 route 中组合 Prisma + sim + world pack + policy 的大杂烩。

---

## Phase 4：测试与验收重构

### 目标
让后端从“能跑”变成“可持续重构”。

### 当前现实
你现在没有统一测试框架，主要依赖：

- 可执行 TS 脚本
- smoke startup
- smoke endpoints

这在当前阶段没问题，但如果开始重构应用层结构，建议至少补齐两类东西：

1. **轻量 route smoke**
   - 保证拆分 routes 后对外行为一致
2. **模块级 contract 验证**
   - 至少对解析器、guard、serialization、startup snapshot 做小范围可执行验证

### 这一阶段的最低目标
不一定要立刻引入 Vitest/Jest，但至少应该做到：

- route 重构后 smoke 不回退；
- 新抽出的 helper 能被单独执行验证；
- 后续 inference service 能有独立验证入口。

---

## 6. 推荐的目标结构（渐进式，不强制一次到位）

我建议目标结构长这样：

```text
apps/server/src/
  app/
    create_app.ts
    context.ts
    middleware/
      request_id.ts
      error_handler.ts
    http/
      async_handler.ts
      runtime_guard.ts
      json_safe.ts
      parsers.ts
      validators.ts
    routes/
      system.ts
      clock.ts
      social.ts
      relational.ts
      narrative.ts
      identity.ts
      policy.ts
      inference.ts
  core/
    simulation.ts
    runtime_speed.ts
  identity/
    service.ts
    policy_engine.ts
    middleware.ts
    types.ts
  narrative/
    resolver.ts
    types.ts
  world/
    loader.ts
    bootstrap.ts
  inference/
    ...
  utils/
    api_error.ts
    notifications.ts
  index.ts
```

注意：

- 这里并没有强推 DDD 或 hexagonal 全家桶；
- 只是把当前已经存在的“应用装配职责”分离出来；
- 对现有目录破坏最小。

---

## 7. 我认为现在最值得优先做的 6 件事

按优先级排序：

### P1. 拆 `index.ts`
这是收益最大的重构动作。

### P2. 引入 `AppContext`
统一传递：

- Prisma
- SimulationManager
- startup health
- notification queue
- runtime state getter

### P3. 抽出 HTTP helper 层
把：

- asyncHandler
- runtime guard
- json safe
- parsers / validators

从入口文件拿出去。

### P4. 按 API 分组拆 route 文件
至少拆成：

- system
- clock
- social
- relational
- narrative
- identity
- policy

### P5. 为 inference 预留独立 route/service 位置
哪怕业务还没开工，结构位先留好。

### P6. 用 smoke 脚本做回归护栏
每拆完一个阶段就跑一遍，而不是最后一起看。

---

## 8. 现在不建议优先做的 5 件事

### N1. 不建议立刻重写 `SimulationManager`
它现在虽然未来会继续扩张，但当前主要问题仍是应用入口层，不是 simulation core 本身。

### N2. 不建议立刻引入 repository pattern
当前 Prisma 直用并不是第一痛点。

### N3. 不建议立刻大规模 service 化所有 API
可以先拆 route，再决定哪些真的值得独立 service。

### N4. 不建议现在做全量测试体系升级
可以先靠 smoke + 小脚本撑住，避免一次性引入太多变量。

### N5. 不建议现在同步推进 Phase D 持久化工作流
这会把重构目标从“收敛结构”变成“同时新增复杂业务”。

---

## 9. 风险清单

### 风险 1：重构变成目录搬家
如果只是把代码分散到更多文件，但边界没有变清晰，那收益会很低。

### 风险 2：共享状态被拆坏
例如：

- `runtimeReady`
- `startupHealth`
- simulation timer
- notification queue

这些在拆分时最容易出现生命周期问题。

### 风险 3：路由拆分后重复代码反而变多
如果没有同步抽出 helper 层，每个 route 文件都可能复制一套校验逻辑。

### 风险 4：重构和新功能同时推进导致定位困难
这就是为什么我建议：

- 先做结构收敛；
- 再接 inference。

---

## 10. 建议的验收标准

如果你决定按这条路线做，我建议把“后端重构完成”的标准定义为：

1. `index.ts` 明显瘦身，只剩应用装配与启动职责；
2. routes 已按 API 分组拆分；
3. request id / error envelope / runtime guard / json safe 已抽离；
4. smoke startup / endpoints 仍全部通过；
5. 对外 API 语义无破坏性变化；
6. inference 模块可以在不继续污染入口文件的前提下接入。

---

## 11. 我对这条路线的总体判断

### 可行性
高。

### 收益
很高，尤其是对你接下来要做的 M2 inference 来说。

### 代价
中等，主要是：

- 机械性拆分文件；
- 依赖注入方式变清晰；
- 需要更自觉地控制共享状态。

### 是否值得现在做
**值得，但建议做“轻量重构版”，不要做“全面重构版”。**

也就是说：

> 现在最值得做的是“应用层收敛与入口瘦身”，
> 不是“后端架构彻底翻新”。

---

## 12. 建议你评估时重点看这 5 个问题

1. 你是否认可“当前最大问题是入口太重，而不是领域模块太少”？
2. 你是否接受先做应用层重构，而不是立刻重写 simulation / Prisma 层？
3. 你是否希望 inference 在一个干净结构中接入，而不是继续堆进 `index.ts`？
4. 你是否接受本轮重构以“对外行为不变”为硬约束？
5. 你是否希望重构和 M2 开发分成两个连续阶段，而不是混成一次施工？

如果这 5 个问题里，你大部分答案是“是”，那这条路线就适合继续细化为正式执行计划。

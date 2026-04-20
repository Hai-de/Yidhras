# 多世界包同时运行（实验性）设计

## 1. 背景

当前项目已经完成“单世界包内的多实体并发请求”阶段，具备了以下基础：

- 单 `active pack` 前提下的稳定 world runtime；
- pack 级虚拟时钟串行推进；
- scheduler partition / ownership / lease / rebalance 基线；
- decision job / action intent 的 claim + lock + retry 基线；
- 实体级 single-flight 与 activity budget；
- 以保守默认值 + 可调 runtime config 为原则的运行时策略收口。

但第五阶段“多世界包同时运行”与前四阶段性质不同。它不再只是扩容当前模型，而是开始触碰：

- `SimulationManager` 的单 active-pack 运行方式；
- `/api/status` 等接口的单 pack 返回模型；
- pack overview / timeline 的 active-pack guard；
- plugin runtime 的 active-pack-local route scope；
- inference context 对当前 active pack 的默认依赖；
- operator / projection / route context 对“当前只有一个世界”的隐式前提。

因此，这一阶段本质上不是普通功能增强，而是：

> 把当前单 active-pack 系统，向一个 **multi-pack runtime registry / container-like host** 的方向试探性演进。

这也是为什么第五阶段必须采取保守策略，而不是直接把 multi-pack 设为默认模式。

---

## 2. 设计定位

本阶段正式定义为：

> **实验性 multi-pack runtime registry**

而不是：

> 默认多世界包运行平台。

### 2.1 产品策略

本能力的产品策略必须是：

- **默认关闭**；
- **明确 experimental**；
- **优先 operator / test-only**；
- **不承诺稳定 API contract**；
- **不替换当前单 active-pack 稳定模式**。

### 2.2 为什么必须 experimental

原因包括：

1. 当前系统到处存在单 active-pack 假设；
2. 该能力会同时影响 runtime、API、plugin runtime、projection、前端语义；
3. 当前项目尚无真实使用者，更适合通过实验性用户反馈来成熟特性；
4. 若直接默认开启，会把当前稳定面一起拖入重构。

---

## 3. 设计目标

### 3.1 目标

1. 在不破坏当前单 active-pack 稳定模式的前提下，引入一个可加载多个 pack runtime 的 registry；
2. 为每个 pack 提供独立的 runtime handle，而不是继续依赖全局唯一 `activePack`；
3. 明确多 pack 运行时的 pack-local 隔离边界：
   - clock
   - runtime speed
   - scheduler
   - plugin runtime
   - projection
   - route context
4. 优先提供 experimental operator / debug / test-only 能力；
5. 为将来是否“转正”为正式多 pack 模式保留演进空间。

### 3.2 非目标

1. 本阶段**不**把 multi-pack 设为默认运行模式；
2. 本阶段**不**重写当前全部 canonical API；
3. 本阶段**不**要求当前前端主导航和主业务页面立即支持多 pack；
4. 本阶段**不**把 `SimulationManager` 直接扩张成新的万能 app-service bucket；
5. 本阶段**不**承诺 experimental API 在短期内保持完全稳定；
6. 本阶段**不**要求当前所有 plugin / projection / workflow 在第一轮就达到生产级隔离完善度。

---

## 4. 当前系统中的单 active-pack 依赖

以下边界当前都显式或隐式依赖单 active-pack：

### 4.1 Core runtime

- `SimulationManager.activePack`
- `context.sim.getActivePack()`
- `context.sim.clock`
- `context.sim.resolvePackVariables()`
- 单一 runtime speed snapshot

### 4.2 API contract

当前文档已明确：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`

都要求：

- 请求中的 `packId` 必须等于当前 active pack；
- 否则返回 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`。

### 4.3 Status / health

- `/api/status` 目前返回单个 `world_pack`
- startup health 也更接近“系统是否有一个可启动 pack”语义，而不是“多个 runtime 的系统级状态”

### 4.4 Plugin runtime

当前 plugin runtime 显然是 active-pack-local：

- 读取当前 active pack 的已启用插件
- web manifest 也是当前 active pack 作用域
- route scope mismatch 依赖 active pack

### 4.5 Inference / pack context

- inference context 默认从当前 active pack 读取 world prompts / pack metadata / runtime contract
- 多 pack 后若没有显式 scope，context 语义会混乱

### 4.6 Projection / operator

- operator 与 projection 层也经常通过 active pack 获取元信息
- pack overview / timeline 等接口目前不是真正意义上的“任意 pack 查询”

这说明：

> 第五阶段如果直接默认 multi-pack，会撬动整套稳定边界。

---

## 5. 核心设计结论

## 5.1 不直接把 `SimulationManager` 改成“大一统多 pack 容器”

不建议把现有 `SimulationManager` 直接演化为：

- 多 pack registry
- 多 clock host
- 多 scheduler host
- 多 plugin host
- 多 projection host

原因：

- 会把它继续扩张成新的万能 app-service bucket；
- 会破坏前阶段已建立的“不要继续膨胀 `SimulationManager`”原则；
- 风险过大，难以逐步演进。

因此建议引入新的 runtime host 概念，而 `SimulationManager` 保持：

- 单 pack 兼容 facade；
- 或默认 active-pack facade；
- 不作为 multi-pack 全部能力的直接最终宿主。

## 5.2 引入新的 registry / handle 模型

建议新增以下概念：

### `PackRuntimeRegistry`

职责：

- load / unload / list / lookup pack runtime；
- 管理当前已加载 pack runtime 集合；
- 管理 experimental feature gate 与 load policy；
- 决定某个 pack 是否可被 operator 启动或卸载。

### `PackRuntimeHandle`

职责：

- 表示某个 pack 的运行时句柄；
- 对外提供 pack-local 的：
  - clock snapshot
  - scheduler snapshot
  - runtime speed snapshot
  - health snapshot
  - plugin runtime snapshot
  - projection scope information

### `PackRuntimeHost`

职责：

- 负责某个 pack runtime 的生命周期；
- 持有 pack-local state；
- 装配该 pack 的运行时依赖；
- 为 registry 提供可管理、可观测、可停止的运行单元。

---

## 6. 必须优先明确的隔离面

## 6.1 Pack clock 隔离

每个 pack 应拥有独立：

- `current_tick`
- `pause/resume`
- `runtime speed`
- `ChronosEngine`

原因：

- 当前单 pack 语义下，clock 是世界内部时间；
- 多个世界若共享同一个 clock，会让 pack-local narrative / scheduler / speed 语义混乱；
- 将来 experimental 模式下，operator 很可能希望分别暂停/观察某个 pack。

### 结论

> multi-pack 下，clock 必须是 **pack-local**。

## 6.2 Scheduler 隔离

当前 scheduler partition 仅以 `partition_id` 表达。进入 multi-pack 后，调度单元应升级为：

- `(pack_id, partition_id)`

至少以下对象都需要支持 pack-local scope：

- lease
- cursor
- worker ownership
- worker runtime state
- rebalance recommendation
- migration backlog
- observability read model

### 结论

> scheduler 不能继续只看全局 partition，必须引入 **pack-scoped partitioning**。

## 6.3 Plugin runtime 隔离

多 pack 同时运行时，plugin runtime 必须隔离：

- installation scope
- runtime cache
- web manifest cache
- asset route namespace
- route context
- UI mounting scope

否则会出现：

- pack A 的插件路由落到 pack B；
- web runtime manifest 串用；
- panel / route / asset host 混乱。

### 结论

> plugin runtime 必须是 **pack-local runtime host**，而不是共享 active-pack 容器。

## 6.4 Projection / query scope 隔离

必须明确：

- overview / timeline / scheduler / graph 查询默认作用域；
- operator 是否允许跨 pack 聚合；
- experimental API 是否一律要求显式 `packId`；
- stable API 是否继续维持单 active-pack 语义。

### 结论

> projection / query 不应依赖隐式 active pack，而应在 experimental 模式下显式 pack scope 化。

## 6.5 Startup / health 隔离

当前 `/api/status` 更接近：

- 系统是否就绪
- 当前唯一 world pack 是谁

进入 multi-pack 后，建议拆成两层：

- **system health**：数据库、runtime host、registry 是否健康
- **per-pack runtime health**：某个 pack runtime 是否 loaded / paused / degraded / failed

### 结论

> `/api/status` 的稳定 contract 不应直接重写；experimental 模式应单独提供 per-pack status surfaces。

---

## 7. API 策略

## 7.1 稳定 API 保持不变

当前稳定 API 继续保留单 active-pack 语义：

- `/api/status`
- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`
- 现有 active-pack guard 逻辑

这些不因为 experimental multi-pack 而立即改变。

### 原则

- 单 pack 仍是稳定模式；
- 现有前端不因 experimental 而被迫重构；
- `PACK_ROUTE_ACTIVE_PACK_MISMATCH` 等稳定错误码继续成立。

## 7.2 新增 experimental operator API

建议新增实验接口，例如：

- `GET /api/experimental/runtime/packs`
- `POST /api/experimental/runtime/packs/:packId/load`
- `POST /api/experimental/runtime/packs/:packId/unload`
- `GET /api/experimental/runtime/packs/:packId/status`
- `GET /api/experimental/runtime/packs/:packId/clock`
- `GET /api/experimental/runtime/packs/:packId/scheduler/*`
- `GET /api/experimental/runtime/packs/:packId/projections/timeline`

### 原则

- 这些接口只面向 operator / test-only；
- 不进入当前 canonical API 主线；
- 明确标记 experimental；
- 返回值允许在试验期演进。

---

## 8. 前端策略

## 8.1 不直接改主 UI

当前前端默认假设大概率仍是：

- 一个当前世界
- 一个系统状态
- 一个 pack overview / timeline / plugin panel host

因此本阶段不建议直接把 multi-pack 推入主导航与主业务页面。

## 8.2 先做 experimental 只读工作台

若需要前端接入，建议先做：

- pack selector
- runtime inspector
- 只读状态页
- pack-local clock / scheduler / health 面板

而不是立即改：

- 主布局
- 主导航
- canonical overview/timeline 页
- 现有 pack-local 插件面板宿主

### 结论

> 多 pack 前端接入应先是 **实验性只读工作台**，不是默认主界面升级。

---

## 9. 推荐配置与 feature gate

建议至少新增：

```yaml
features:
  experimental:
    multi_pack_runtime:
      enabled: false
      operator_api_enabled: false
      ui_enabled: false

runtime:
  multi_pack:
    max_loaded_packs: 2
    start_mode: manual
    bootstrap_packs: []
```

必要时再补：

```yaml
scheduler:
  experimental_multi_pack:
    isolate_partitions_per_pack: true
    isolate_worker_state_per_pack: true
```

### 配置原则

- 默认关闭；
- 显式打开才进入 experimental runtime；
- 可限制最大 loaded packs，避免一开始就走向无限容器化；
- operator API 与 UI 开关可分离。

---

## 10. 推荐落地顺序

## Phase 5A：只做 experimental runtime registry

目标：

- 引入 registry / handle / host 模型；
- 实现 load / unload / list；
- 查看每个 pack runtime 的基础 status / clock / scheduler 摘要；
- 不修改 canonical API，不修改主 UI。

## Phase 5B：只开放 experimental operator API

目标：

- 让实验用户能操作与观察 pack runtime；
- 验证 pack-local 隔离是否正确；
- 不污染稳定 API。
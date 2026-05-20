# 系统架构图 / Architecture Diagrams

本文档提供 Yidhras 的图形化架构总览，面向项目内部维护者，用于快速理解：

- 工作区级系统组成
- server 内部分层与依赖方向
- runtime host、world engine 与持久化边界
- 典型请求与运行链路

> 文字版边界定义见 `ARCH.md`
> 
> 公共接口契约见 `specs/API.md`
> 
> 业务执行语义见 `LOGIC.md`

## 1. 工作区级系统总览

```mermaid
flowchart LR
    User[User / Operator]

    subgraph Web[apps/web]
        WebApp[Nuxt 4 + Vue 3 + Pinia]
    end

    subgraph Contracts[packages/contracts]
        SharedContracts[Shared transport contracts]
    end

    subgraph Server[apps/server]
        ExpressHost[Express + TypeScript host]
        AppServices[Application services]
        MultiPackLoopHost[Multi-pack loop host\nper-pack scheduler loops]
        PluginHost[Plugin host]
        AIGateway[AI gateway]
    end

    subgraph Persistence[Persistence]
        KernelDB[(Kernel-side Prisma\nSQLite / PostgreSQL)]
        PackDB[(Pack-local runtime DB\nworld data + scheduler storage)]
    end

    subgraph Sidecar[Rust sidecar pool]
        WorldEngine[Per-pack world engine processes\nstdio + JSON-RPC]
    end

    User --> WebApp
    WebApp <-->|HTTP API| ExpressHost
    WebApp <--> SharedContracts
    ExpressHost <--> SharedContracts

    ExpressHost --> AppServices
    AppServices --> MultiPackLoopHost
    AppServices --> PluginHost
    AppServices --> AIGateway

    ExpressHost --> KernelDB
    AppServices --> KernelDB
    MultiPackLoopHost --> PackDB
    MultiPackLoopHost <-->|per-pack WorldEnginePort| WorldEngine
```

> 本图展示工作区级系统组成：Web 前端与 Server 宿主通过 HTTP API 交互，Server 内部包含 MultiPackLoopHost、Plugin Host、AI Gateway 等平台能力，持久化分为 kernel-side Prisma 与 pack-local runtime SQLite 两层，Rust sidecar 通过 stdio JSON-RPC 推进世界状态。

## 2. Server 内部分层与依赖方向

```mermaid
flowchart TD
    Routes[Transport / App layer\nExpress routes / middleware / HTTP envelope]
    Services[Application services / Read models\norchestration / aggregation / snapshots]
    Workflow[Workflow / Inference / Context]
    Runtime[Multi-pack loop host\nPackSimulationLoop / scheduler / lease / diagnostics]
    PackRuntime[Pack runtime\nworld entities / entity states / authority / mediator]
    Governance[Kernel persistence / Governance\nworkflow / audit / plugin governance / memory]

    Routes --> Services
    Services --> Workflow
    Services --> Runtime
    Services --> Governance
    Workflow --> Governance
    Workflow --> Runtime
    Runtime --> PackRuntime
    Runtime --> Governance
```

> 本图展示 Server 内部分层与依赖方向：Routes → Services → Workflow/Runtime → PackRuntime/Governance，route 层保持薄层，依赖逐层向下，不反向穿透。

## 3. Runtime Host / World Engine / Persistence 边界

```mermaid
flowchart TB
    subgraph Host[Node/TS host]
        direction TB
        MultiPackLoopHost[MultiPackLoopHost\npack lifecycle / loop orchestration]
        PackStateMachine[Pack state machine\nloading → ready → degraded → unloading → gone]

        subgraph PackContainer["Per-pack container (× N loaded packs)"]
            direction LR
            PackLoop[PackSimulationLoop\n7-step cycle]
            SchedAdapter[SchedulerStorageAdapter\nlease / cursor / ownership]
            WEP[WorldEnginePort]
            HostAPI[PackHostApi\ncontrolled read surface]
        end
    end

    subgraph SidecarPool[Rust sidecar pool]
        SidecarProc[Per-pack world engine\nstdio + JSON-RPC]
    end

    PackSQLite[(Pack-local runtime SQLite\nworld data + scheduler storage)]

    MultiPackLoopHost -->|"start/stop/monitor"| PackLoop
    MultiPackLoopHost --> PackStateMachine
    PackLoop --> SchedAdapter
    PackLoop --> WEP
    PackLoop --> HostAPI
    WEP <-->|"per-pack JSON-RPC"| SidecarProc
    HostAPI -.->|"controlled read"| SidecarProc
    SchedAdapter --> PackSQLite
```

> 本图展示 Runtime Host / World Engine / Persistence 三层边界：MultiPackLoopHost 管理 per-pack 容器，每个 pack 拥有独立的 PackSimulationLoop、SchedulerStorageAdapter、WorldEnginePort 和 sidecar 进程。Pack 状态机在 API 层通过 packScopeMiddleware 强制执行。

## 4. 典型 HTTP 请求链路

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web
    participant R as Server route
    participant S as App service
    participant C as Workflow / Context
    participant K as Runtime kernel
    participant E as World engine
    participant D as Persistence

    U->>W: 发起操作
    W->>R: HTTP request
    R->>S: 解析参数并调用应用服务
    S->>C: 组装 workflow / context
    S->>K: 调用 runtime orchestration
    K->>E: 通过 WorldEnginePort 执行 query / step
    E-->>K: 返回结果 / prepared state
    K->>D: Host-managed persistence
    D-->>S: 返回持久化结果
    S-->>R: 组装 read model / response
    R-->>W: HTTP response
    W-->>U: 更新界面
```

> 本图展示典型 HTTP 请求链路：User → Web → Route → App Service → Workflow/Context → Runtime Kernel → World Engine → Persistence → 逐层返回。请求不直接穿透到 pack runtime 或 raw sidecar client。

## 5. Scheduler Tick 与世界推进链路

```mermaid
sequenceDiagram
    participant MLH as MultiPackLoopHost
    participant PSL as PackSimulationLoop<br/>(per-pack)
    participant WEP as WorldEnginePort
    participant Sidecar as Per-pack sidecar<br/>(stdio + JSON-RPC)
    participant SchedStore as SchedulerStorageAdapter<br/>(pack-local SQLite)
    participant Obs as Observability<br/>(cross-pack metrics)

    MLH->>PSL: tick (per-pack interval)
    PSL->>PSL: 1. expire stale leases
    PSL->>WEP: 2. world engine step
    WEP->>Sidecar: JSON-RPC
    Sidecar-->>WEP: prepared step / diagnostics
    WEP-->>PSL: world delta
    PSL->>PSL: 3. scheduler (partition / assign)
    PSL->>SchedStore: writeDetailedSnapshot
    PSL->>PSL: 4. decision jobs
    PSL->>PSL: 5. action dispatcher
    PSL->>PSL: 6. perception pipeline
    PSL->>PSL: 7. projection pipeline
    PSL->>Obs: emitAggregatedMetrics
```

> 本图展示 per-pack 调度 tick 的 7 步循环：expire stale leases → world engine step → scheduler partition/assign → decision jobs → action dispatcher → perception pipeline → projection pipeline。Scheduler 运营数据通过 SchedulerStorageAdapter 写入 pack-local SQLite，可观测性拆分为单 pack 调试快照与跨 pack 聚合指标两层。Projection 管线读取世界状态、评估 projection 规则、将计算结果持久化为 entity state。

## 6. AI Tool Calling 链路

```mermaid
sequenceDiagram
    participant TS as AiTaskService
    participant GW as ModelGateway
    participant AD as Provider Adapter
    participant TL as ToolLoopRunner
    participant TR as ToolRegistry
    participant TP as ToolPermissionPolicy
    participant CB as CrossAgentBridge

    TS->>GW: ModelGatewayRequest (tools + tool_policy)
    GW->>AD: invoke (含 tools 定义)
    AD-->>GW: response (finish_reason='tool_call')
    GW-->>TL: tool_calls[]
    loop Tool Loop (≤ max_rounds)
        TL->>TP: 校验 tool permission
        TP-->>TL: allowed / denied
        alt cross_agent query
            TL->>CB: 转为 CrossAgentQuery
            CB->>TS: runTask() 查询目标 agent
            TS-->>CB: target agent result
            CB-->>TL: CrossAgentResult
        else 普通 tool
            TL->>TR: execute(name, args)
            TR-->>TL: ToolExecutionResult
        end
        TL->>GW: 追加 role='tool' 消息 + 重新调用
        GW->>AD: invoke (更新后的消息历史)
        AD-->>GW: response
        alt finish_reason='stop'
            GW-->>TL: 终止 loop
        else finish_reason='tool_call'
            GW-->>TL: 继续 loop
        end
    end
    TL-->>TS: 最终 ModelGatewayResponse
```

> 本图展示 AI Tool Calling 链路：AiTaskService → ModelGateway → Provider Adapter → ToolLoopRunner（含 ToolPermissionPolicy 校验）→ 循环至 finish_reason='stop' 或达上限。Cross-agent query 通过 CrossAgentBridge 转调 AiTaskService，不绕过 gateway。

## 7. Pack 状态机

```mermaid
stateDiagram-v2
    [*] --> loading: load()

    loading --> ready: 初始化完成
    loading --> unloading: unload() / 超时 / 失败

    ready --> degraded: 连续崩溃达 SCHEDULER_CRASH_THRESHOLD
    ready --> unloading: unload()

    degraded --> ready: resume()
    degraded --> unloading: unload()

    unloading --> gone: 资源销毁完成

    gone --> loading: load()
```

> 本图展示 Pack 五态状态机：loading → ready → degraded → unloading → gone。degraded 由连续崩溃触发（默认阈值 3），gone 状态可重新 load。API 中间件 packScopeMiddleware 在每个请求上校验状态并返回对应的 HTTP 状态码。

## 8. 阅读路径

- 看图理解系统组成：本文件 `ARCH_DIAGRAM.md`
- 看正式边界定义：`ARCH.md`
- 看公共 API contract：`specs/API.md`
- 看业务语义与执行主线：`LOGIC.md`
- 看 Prompt Workflow：`subsystems/PROMPT_WORKFLOW.md`
- 看 AI Gateway：`subsystems/AI_GATEWAY.md`
- 看 Plugin Runtime：`subsystems/PLUGIN_RUNTIME.md`

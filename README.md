# Yidhras (伊德海拉)

叙事引擎与 Agent 模拟器，为了给使用者提供情报分析 + 社会操控的感觉。

## 核心架构
- **L1 Social:** 社交层 (Post / Noise)
- **L2 Relational:** 关系图谱 (Cytoscape.js 可视化)
- **L3 Narrative:** 叙事逻辑 (Chronos Engine / Resolver)
- **L4 Transmission:** 物理传输层 (延时 / 丢包模拟)

## 当前工程状态
- M0 工程基线已完成：前后端 lint / typecheck 均已打通并通过。
- 后端运行时基线稳定：健康检查、统一错误包络、通知队列、world-pack 降级启动、运行时速度策略均已落地。
- 当前正式路线已从“先做临时推理接口”升级为：**直接按可演进到持久化工作流的正式工程路线推进**。

## Backend Refactor Status (2026-03-23)
- `apps/server/src/index.ts` now acts as a composition root for startup, runtime bootstrap, and route assembly.
- Base Express wiring lives in `apps/server/src/app/create_app.ts`, which registers `identityInjector()` and `requestIdMiddleware()` before route modules.
- Route modules are grouped under `apps/server/src/app/routes/*.ts` and should remain thin HTTP adapters.
- App-level service boundaries now live in `apps/server/src/app/services/*.ts` for system, runtime control, identity, policy, social, relational, narrative, and agent-context flows.
- Shared HTTP and runtime infrastructure lives under `apps/server/src/app/http/*.ts`, `apps/server/src/app/middleware/*.ts`, and `apps/server/src/app/runtime/*.ts`.
- Inference integration is reserved via `apps/server/src/app/routes/inference.ts`, `apps/server/src/inference/service.ts`, and the startup wiring/log in `apps/server/src/index.ts`.
- Stable external contracts preserved during the refactor:
  - unified error envelope: `{ success: false, error: { code, message, request_id, timestamp, details? } }`
  - `X-Request-Id` generation/propagation via `requestIdMiddleware()`
  - runtime gating via `assertRuntimeReady(feature)` with `503/WORLD_PACK_NOT_READY`
  - BigInt JSON transport serialized as strings

## 正式路线规划（B→D）

### Phase B（当前阶段，D-ready 服务层）
目标：先建立稳定的推理服务边界，而不是堆积一次性调试逻辑。

计划内容：
- 统一 `InferenceService` 入口，禁止在路由层和 runtime 中重复拼装推理逻辑。
- 建立 `InferenceContext`、`PromptBundle`、`DecisionResult`、`ActionIntentDraft` 等领域契约。
- 提供策略注入能力（如 `mock` / `rule_based` / future provider）。
- 提供硬编码 prompt 通道，并与 world-pack `prompts` 片段结合。
- 提供 `preview/run` 调试 API，用于验证 prompt 和标准化决策结果。
- 预留 trace metadata（如 `inference_id`、`actor_ref`、`tick`、`provider`、`world_pack_id`）。
- 预留可插拔 sink，使未来可从 no-op/日志实现平滑升级到 Prisma 持久化实现。

### Phase D（后续阶段，正式持久化工作流）
目标：正面拥抱软件工程复杂度，把推理和动作纳入可追踪、可重试、可审计的工作流。

计划内容：
- 引入持久化工作流对象，如 `InferenceTrace`、`ActionIntent`、`DecisionJob`。
- 实现幂等、重试、失败状态、审计记录和 replay 能力。
- 将“推理结果”与“动作执行”彻底分离，形成可观测状态流转。
- 让 runtime loop 基于正式工作流而不是临时同步调用推进 Agent 行为。
- 为 Memory Core 与 Action Dispatcher 提供稳定上游输入。

### 设计原则（当前即生效）
- 推理与执行分离：Inference 不直接等价于 Action 执行。
- API 仅作为调用壳，不承担领域拼装职责。
- Prompt 必须结构化输出，而不是只保留拼接后的长字符串。
- Decision 必须标准化，避免未来从松散 JSON 迁移时大规模返工。
- 所有新增能力默认按“未来要持久化、要审计、要回放”来约束接口。

## 快速开始

### 1. 环境准备
- Node.js 18+
- npm 或 pnpm

### 2. 初始化项目
```bash
# 安装依赖
npm install --prefix apps/server
npm install --prefix apps/web

# 统一准备后端运行前置条件（数据库迁移 + world pack 模板 + 身份策略初始化）
npm run prepare:runtime --prefix apps/server
```

### 3. 运行项目
您可以使用根目录下的启动脚本：

#### Windows
```cmd
start-dev.bat
```

#### Linux / macOS
```bash
chmod +x start-dev.sh
./start-dev.sh
```

## 开发指令
- **Server:** `npm run dev` (位于 apps/server)
- **Web:** `npm run dev` (位于 apps/web)
- **Runtime Prepare:** `npm run prepare:runtime --prefix apps/server`
- **World Pack Bootstrap:** `npm run init:world-pack --prefix apps/server`
- **Seed Identity & Policy:** `npm run seed:identity --prefix apps/server`

## 冒烟测试（启动流程与关键端点）
- **启动流程冒烟:** `npm run smoke:startup --prefix apps/server`
- **关键端点冒烟:** `npm run smoke:endpoints --prefix apps/server`
- **一键执行全部冒烟:** `npm run smoke --prefix apps/server`
- **可选端口覆盖:** `SMOKE_PORT=3101 npm run smoke --prefix apps/server`

## 启动与验收硬性说明
- **运行前置条件（硬性）:** 启动服务前需完成数据库迁移和 world pack 初始化，统一通过 `npm run prepare:runtime --prefix apps/server` 执行。
- **降级启动策略（硬性）:** 首次拉取项目内容可能为空，`health_level=degraded` 且 `runtime_ready=false` 视为允许启动，不作为冒烟测试失败条件。
- **关键端点一致性（硬性）:** 依赖 world-pack 的接口在运行时未就绪时统一返回 `503` + `WORLD_PACK_NOT_READY` 错误包络。
- **统一速度策略（硬性）:** 运行时速度按 `override > world_pack.simulation_time.step_ticks > default(1)` 解析，`/api/status` 通过 `runtime_speed` 字段暴露当前生效值。

## 运行时速度覆盖（调试）
- 覆盖速度：
  - `POST /api/runtime/speed` body: `{ "action": "override", "step_ticks": "2" }`
- 清除覆盖：
  - `POST /api/runtime/speed` body: `{ "action": "clear" }`
- 覆盖时间：
  - `/api/status.runtime_speed.override_since` 返回覆盖生效时间戳（毫秒），清除覆盖时为 `null`。
- 系统通知：
  - `/api/system/notifications` 中 `details` 字段会包含 `step_ticks` 与 `override_since`（覆盖），或清除时 `override_since: null`。

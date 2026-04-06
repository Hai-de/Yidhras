# Documentation Index / 文档导航

本目录用于承载相对稳定的详细说明文档。

> 这里不是阶段日报、验证记录或执行计划仓库；当前优先级看 `TODO.md`，验证证据看 `记录.md`，过程性计划看 `.limcode/plans/`。

## 我应该看哪里？

### 想快速了解项目

- 返回根目录 `README.md`
- 适合第一次进入仓库、只想知道项目是什么、怎么启动、去哪里继续看的人

### 想了解当前优先级和里程碑

- 看根目录 `TODO.md`
- 这里是当前阶段状态的主登记处

### 想查看验证结果或历史验收快照

- 看根目录 `记录.md`
- 这里记录已经发生且被验证过的事项，不记录未来计划

### 想理解接口契约

- 看 `API.md`
- 适合前端、调用方、联调人员

### 想理解系统结构与模块边界

- 看 `ARCH.md`
- 适合需要理解后端/前端/contract 边界与系统组成的人

### 想理解业务规则与领域语义

- 看 `LOGIC.md`
- 适合需要理解时间、权限、工作流、层级联动等规则的人

### 想了解前端当前状态与增强约束

- 看 `apps/web/README.md`
- 适合前端开发者、联调者以及需要了解 Operator UI 现状的人

### 想理解前端主题系统、默认主题规则与 provider-owned theming 约定

- 看 `THEME.md`
- 适合前端开发者、provider 集成方以及需要修改默认 workbench 主题的人

## 文档职责边界

- `API.md`：只负责当前对外接口契约、错误码、调用约束
- `ARCH.md`：只负责稳定架构边界、模块职责、设计约束
- `LOGIC.md`：只负责业务规则、领域语义、当前明确成立的逻辑边界
- `TODO.md`：只负责阶段状态、优先级、近期计划
- `记录.md`：只负责验证证据、验收边界、历史快照
- `THEME.md`：只负责前端主题 contract、默认主题规则、provider-owned theme 约定与主题开发操作手册
- `ENHANCEMENTS.md`：只负责当前不阻塞主线、但值得后续回收的增强项清单
- `apps/web/README.md`：只负责前端当前状态、Guardrails 与前端主文件导航

## 非正式文档说明

- `.limcode/plans/`：执行计划、拆解草案、历史过程资产
- `.limcode/design/`：设计草案，不默认代表已落地实现
- `.limcode/review/`：评审记录与结论

## 最近新增的开发稳定性阅读入口

如果你是来排查或理解 server 开发环境稳定性改造，建议按下面顺序阅读：

1. `README.md`
   - 看如何重置开发数据库、哪些环境变量会影响 runtime 稳定性
2. `ARCH.md`
   - 看 simulation loop 串行化、SQLite pragma 初始化、development 数据清理这几个架构约束
3. `apps/server/tests/e2e/scheduler-runtime-status.spec.ts`
   - 看 `/api/status` 对 `runtime_loop` 与 `sqlite` 的验证断言
4. `apps/server/tests/e2e/scheduler-loop-serialization.spec.ts`
   - 看“人为注入长耗时 step 也不会重入”的证明性 e2e

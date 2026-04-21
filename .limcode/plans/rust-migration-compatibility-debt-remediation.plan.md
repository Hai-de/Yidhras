<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"review","path":".limcode/review/rust-migration-compatibility-debt-assessment.md","contentHash":"sha256:51de353d88710b541fb3a6cd57eab1bd3dc641e01e32d3c68ebca8dcebafa944"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 将 WorldEngineStepCoordinator 从模块级默认单例改为注入式依赖，接入 AppContext/启动装配并补隔离测试  `#plan-coordinator-injection`
- [x] 收紧 activePackRuntime/context.sim fallback 边界，定义保留场景、告警策略与最终移除路径  `#plan-fallback-hardening`
- [x] 为 WORLD_ENGINE_USE_SIDECAR 保留受控兼容层：增加 deprecated warn、覆盖测试，并明确后续删除窗口  `#plan-legacy-env-deprecation`
- [x] 梳理历史兼容债务收尾范围与验收口径，冻结本轮只处理配置契约、状态隔离、fallback 显式化、sidecar 启动治理与同步文档  `#plan-scope-and-acceptance`
- [x] 统一 world_engine / scheduler / memory 三类 Rust sidecar 的二进制优先启动与 build:rust 脚本治理，降低 cargo run 运行时依赖  `#plan-sidecar-build-governance`
- [x] 补齐 runtime_config、sidecar client、startup/integration 测试，并同步 review/progress/TODO 的真实状态  `#plan-validation-and-sync`
- [x] 补齐 world_engine 配置到 WorldEngineSidecarClient 的完整接线，使 mode/binary_path/timeout_ms/auto_restart 全量生效并统一启动策略  `#plan-world-engine-config-plumbing`
<!-- LIMCODE_TODO_LIST_END -->

# Rust 迁移历史兼容债务收尾实施计划

## 来源文档

- 评审来源：`.limcode/review/rust-migration-compatibility-debt-assessment.md`

## 目标

本轮聚焦把“已经识别出来、但尚未完全收口”的 Rust 迁移历史兼容债务做一次工程化收尾，避免继续出现“代码已部分切换，但配置、状态、启动方式和文档事实仍不一致”的情况。

本计划优先处理以下问题：

1. `world_engine` 配置项只部分生效，`WorldEngineSidecarClient` 尚未完整消费 `binary_path / timeout_ms / auto_restart`。
2. `WORLD_ENGINE_USE_SIDECAR` 旧环境变量仍可隐式改写运行模式，但缺少 deprecated 策略与观测。
3. `WorldEngineStepCoordinator` 虽已类封装，但默认执行路径仍依赖模块级单例，测试隔离与运行时边界仍不够清晰。
4. `activePackRuntime -> context.sim` fallback 仍然存在，目前只是从“静默”变成“告警”，还未形成可控的最终收敛路径。
5. 三类 Rust sidecar 仍保留 `cargo run --quiet` 的运行时启动路径，构建与部署治理未统一。
6. 评审文档、进度文档与真实代码状态已经出现漂移。

## 非目标

本轮不处理以下内容：

- 不继续扩展新的 world rule family Rust 迁移范围。
- 不重写 world engine / scheduler / memory sidecar 的领域语义实现。
- 不引入新的 DTO codegen/protobuf 体系。
- 不在本轮直接物理删除所有 legacy fallback；优先把边界、日志、装配和验收口径先收紧。

## 设计约束与实施原则

1. **先收口契约，再移除兼容路径**：先保证配置、注入、启动方式和测试都只有一套“官方入口”，再考虑删遗留壳。
2. **保留短期兼容，但必须显式化**：允许保留过渡兼容入口，但必须带 deprecated warn、测试覆盖和删除窗口。
3. **状态必须可注入、可隔离**：避免继续依赖模块级默认实例掩盖测试污染问题。
4. **sidecar 启动策略统一**：三类 sidecar 的“binary 优先 / cargo 兜底 / auto_restart / timeout”语义要一致，避免一类一个实现。
5. **文档必须反映真实默认值和收敛状态**：评审、TODO、progress 至少要与当前默认配置和剩余风险一致。

## 工作分解

### 1. 范围冻结与验收口径

**目标**：把这轮债务收尾的完成定义说清楚，避免做到一半又扩大范围。

**涉及文件**
- `TODO.md`
- `.limcode/review/rust-migration-compatibility-debt-assessment.md`
- `.limcode/progress.md`
- 必要时补充 `docs/ARCH.md` 或 `docs/ENHANCEMENTS.md`

**计划动作**
- 重新确认本轮只覆盖：配置接线、兼容 env 退场策略、状态注入、fallback 收紧、sidecar 构建治理、文档同步。
- 明确哪些项算“完成”：
  - `world_engine` 全量配置实际生效；
  - `WORLD_ENGINE_USE_SIDECAR` 仅作为显式 deprecated 兼容入口存在；
  - `WorldEngineStepCoordinator` 从默认单例路径迁移为装配时注入；
  - fallback 仅存在于明确允许的保底场景，且有稳定 warn/诊断；
  - sidecar 启动优先走预构建二进制；
  - 文档与默认值一致。

**完成标准**
- 有一致的“本轮完成定义”，后续实现与验收不再摇摆。

---

### 2. World Engine 配置契约补齐

**目标**：让 `world_engine.mode / binary_path / timeout_ms / auto_restart` 从 schema 到 sidecar client 全链路真正生效。

**涉及文件**
- `apps/server/src/config/schema.ts`
- `apps/server/src/config/runtime_config.ts`
- `apps/server/src/index.ts`
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts`

**计划动作**
- 为 `WorldEngineSidecarClient` 增加与 scheduler/memory sidecar client 对齐的 options 结构。
- 在 `index.ts` 装配 world engine 时，把 `getWorldEngineConfig()` 的完整配置传入 sidecar client，而不是仅用 `mode` 做分支。
- 统一 world engine sidecar 的启动逻辑：
  - 有有效 `binary_path` 时优先直接执行二进制；
  - 无二进制或显式允许时才走 cargo fallback；
  - `timeout_ms` 生效到 JSON-RPC 请求层；
  - `auto_restart` 影响超时/异常后的重启策略。
- 检查 runtime config snapshot/log 输出是否已能反映 world engine 的真实运行参数。

**完成标准**
- `world_engine` 配置不再只是“声明存在”，而是对实际启动与请求行为生效。

---

### 3. 旧环境变量兼容入口退场策略

**目标**：保留短期兼容，但停止让旧变量成为“隐式真相源”。

**涉及文件**
- `apps/server/src/config/runtime_config.ts`
- 相关 runtime_config tests
- 必要时 `docs/guides/COMMANDS.md` 或 `docs/ARCH.md`

**计划动作**
- 保留 `WORLD_ENGINE_USE_SIDECAR -> world_engine.mode` 的兼容映射，但增加显式 deprecated warn。
- 约定优先级：`WORLD_ENGINE_MODE` > `WORLD_ENGINE_USE_SIDECAR`。
- 为以下场景补测试：
  - 仅新变量存在；
  - 仅旧变量存在；
  - 新旧变量同时存在；
  - 旧变量值非法。
- 在计划/文档中明确旧变量删除窗口，避免永久背着兼容债。

**完成标准**
- 旧入口从“静默生效”变成“显式兼容、可观测、可移除”。

---

### 4. WorldEngineStepCoordinator 注入化

**目标**：消除默认模块级单例在主执行路径中的事实地位，让状态管理可隔离、可测试、可扩展。

**涉及文件**
- `apps/server/src/app/runtime/world_engine_persistence.ts`
- `apps/server/src/app/context.ts` 或相关 AppContext 定义文件
- `apps/server/src/index.ts`
- 相关 unit/integration tests

**计划动作**
- 在 `AppContext` 增加 world engine step coordination/step state manager 挂点。
- 启动装配阶段显式创建 `WorldEngineStepCoordinator` 实例并注入到 `appContext`。
- `executeWorldEnginePreparedStep()` 从“默认用模块级 `defaultCoordinator`”改为：
  - 优先使用显式传入；
  - 或使用 `context` 内的注入实例；
  - 尽量移除主路径对模块级默认实例的依赖。
- 保留模块级默认实例仅作为过渡测试工具或后向兼容壳时，要明确标记 deprecated。
- 补并发/重复执行/tainted session 的隔离测试，确认不同测试之间状态不串。

**完成标准**
- 主路径的 single-flight / tainted 状态不再由模块级共享实例暗中承载。

---

### 5. fallback 边界收紧

**目标**：从“允许任何时候 fallback 到 `context.sim`”收紧为“只有明确过渡场景才允许 fallback”。

**涉及文件**
- `apps/server/src/app/runtime/world_engine_ports.ts`
- `apps/server/src/app/runtime/simulation_loop.ts`
- 相关启动/集成测试

**计划动作**
- 梳理当前 `activePackRuntime` 缺失的合法场景。
- 将 fallback 的调用点语义从通用 helper 收紧为：
  - 仅在启动早期、实验模式或明确 legacy 路径下允许；
  - 正常 runtime loop 与 PackHostApi 查询路径中，缺失时优先抛明确错误，而不是永远回退。
- 统一 warn 文案与字段，让日志能区分：
  - 过渡兼容 fallback；
  - 非预期装配缺失；
  - 需要升级为错误的调用。
- 对最终移除路径做分阶段标记，避免下一轮又重新放大 fallback 面。

**完成标准**
- `context.sim` 不再是隐性终极兜底，而是有边界、有日志、有退出路径的过渡机制。

---

### 6. Rust sidecar 构建与启动治理统一化

**目标**：统一 world engine / scheduler / memory 三类 sidecar 的构建与启动模式，减少运行时依赖 `cargo run`。

**涉及文件**
- `apps/server/package.json`
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts`
- `apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts`
- `apps/server/src/memory/blocks/rust_sidecar_client.ts`
- 可能涉及 `.github/workflows/server-tests.yml`、`.github/workflows/server-smoke.yml`

**计划动作**
- 定义统一策略：
  - 本地开发允许 cargo fallback；
  - CI/生产默认要求预构建 binary；
  - 三类 sidecar 的 binary path 解析行为一致。
- 在 `apps/server/package.json` 增加 `build:rust`（以及必要的 `check:rust` / `prepare:rust`）脚本。
- 视需要补充 CI 步骤，让 Rust sidecar 编译问题在 CI 提前暴露，而不是启动时才失败。
- 三个 sidecar client 尽量提取共通 transport/启动策略，至少保证行为一致，哪怕暂不完全抽象公共库。

**完成标准**
- sidecar 启动治理从“各写各的”变为“一致、可文档化、可 CI 验证”。

---

### 7. 测试、回归验证与文档同步

**目标**：让这轮收尾不是“只改实现”，而是有稳定验证矩阵与同步后的事实文档。

**涉及文件**
- runtime_config 相关测试
- sidecar client 相关测试
- startup / simulation_loop / world_engine 相关 integration tests
- `.limcode/review/rust-migration-compatibility-debt-assessment.md`
- `.limcode/progress.md`
- `TODO.md`
- 必要时 `docs/ARCH.md` 或 `docs/ENHANCEMENTS.md`

**计划动作**
- 补充测试矩阵：
  - runtime_config env override 优先级与 deprecated warn；
  - world engine sidecar client binary/cargo 两种启动模式；
  - timeout / auto_restart 行为；
  - coordinator 注入后的 single-flight/taint 隔离；
  - fallback 收紧后正常启动与异常路径行为。
- 更新评审文档中已过期的默认值与阻断项，例如 scheduler decision kernel 默认模式已切为 `rust_primary`。
- 根据用户这轮完成的 TODO，同步 progress 风险与下一步建议，避免文档继续漂移。

**完成标准**
- 代码状态、测试结果、评审结论和项目进度处于同一事实面。

## 推荐实施顺序

1. **范围与验收口径冻结**
2. **world_engine 配置接线补齐**
3. **旧环境变量退场策略**
4. **coordinator 注入化**
5. **fallback 边界收紧**
6. **sidecar 构建治理统一**
7. **回归测试与文档同步**

这样排序的原因是：先把“官方入口”与“状态所有权”收清，再处理 fallback 和部署治理，最后一次性同步测试与文档，避免中途结论反复变化。

## 验证清单

实施完成后至少验证以下项目：

- `world_engine` 的 `binary_path / timeout_ms / auto_restart` 改动能真实影响 sidecar 行为。
- `WORLD_ENGINE_USE_SIDECAR` 使用时会产生明确 deprecated 提示。
- world engine prepared-step 执行状态不依赖模块级共享单例。
- `activePackRuntime` 缺失时不会在核心路径被静默吞掉。
- sidecar 在本地开发和 CI/部署场景下有清晰、稳定、可重复的启动策略。
- review/progress/TODO 对默认模式、剩余风险和后续动作描述一致。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 过快移除 fallback 导致本地开发或实验路径不可用 | 中-高 | 先收紧到显式场景，不在本轮一次性物理删除 |
| sidecar binary 优先后，本地未构建用户启动失败 | 中 | 保留开发态 cargo fallback，并输出明确提示 |
| coordinator 注入改动影响现有测试装配 | 中 | 先补 helper/fixture，分层替换主路径 |
| world engine sidecar client 行为改动引入请求超时/重启差异 | 中 | 通过 unit + integration 测试覆盖 timeout/exit/error 分支 |
| 文档同步不彻底，继续产生误导 | 中 | 将 review/progress/TODO 同步纳入本轮必做验收项 |

## 里程碑式完成定义

当且仅当以下条件同时满足，本计划可视为完成：

1. `world_engine` 全量配置已在 sidecar client 生效。
2. 旧 env 兼容入口已变为可观测的 deprecated 层。
3. coordinator 主路径已注入化，默认单例不再承载正式运行时状态。
4. `context.sim` fallback 仅保留在明确过渡边界内。
5. sidecar 构建/启动治理已有统一脚本和一致语义。
6. 回归测试通过，且 review / progress / TODO 已同步到真实状态。

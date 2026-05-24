<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/generic-capability-gap-analysis.md","contentHash":"sha256:162b8ad45bea12fba9d1fd1a6e4f8e0b2c674e21b9725bc1c2dd10f5d4152ab4"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 新增 deterministic PRNG、seed derivation、stable JSON 基础模块及单元测试  `#determinism-foundation`
- [x] 抽出可手动执行的单 tick/iteration runner，避免 replay 依赖 setTimeout  `#manual-tick-runner`
- [x] 为 pack runtime 接入 deterministic seed 配置与默认 seed 解析  `#pack-seed-integration`
- [x] 替换会影响模拟状态的直接随机路径，优先 action_dispatcher 与 template defaults  `#replace-state-randomness`
- [x] 新增 replay CLI 或测试 helper，支持同 seed 多 run digest 对比  `#replay-harness`
- [x] 实现确定性状态摘要和 sha256 digest，排除观测性非确定字段  `#state-digest`
- [x] 补充 replay/随机稳定性/摘要稳定性测试并更新缺口文档状态  `#tests-and-docs`
<!-- LIMCODE_TODO_LIST_END -->

# 全模拟可复现 / 确定性实施计划

## 来源设计文档

- 源文档：`.limcode/design/generic-capability-gap-analysis.md`
- 对应缺口：§七“全模拟可复现”、§九 P3 第 9 项、§十二“全模拟可复现/确定性”
- 本计划范围：**只处理全模拟确定性**。
- 明确不处理：日志传输层、自动快照、Worker 线程插件隔离、插件热重载、数据迁移框架。这些在前项完成后另行设计和计划。

## 当前代码事实

基于当前代码核对：

1. `apps/server/src/template_engine/core/prng.ts` 已有局部 PRNG：`createPRNG(seed)`，但只服务模板宏展开，不是全模拟统一随机源。
2. `apps/server/src/app/runtime/PackSimulationLoop.ts` 使用实时调度和实时计时：`setTimeout()`、`Date.now()`。这些值进入 diagnostics 和 metrics，不应参与可复现状态判定，但会影响观测输出。
3. `apps/server/src/app/runtime/runtime_clock_projection.ts` 在 projection snapshot 中写入 `updated_at_ms: Date.now()`，这是非确定性字段。
4. `apps/server/src/packs/snapshots/snapshot_capture.ts` 的 snapshot id 使用 `new Date()` + `crypto.randomBytes(3)`；这属于快照标识非确定性。本计划不做自动快照，但需要避免 replay 判定误把 snapshot id 当模拟状态。
5. 当前代码中存在直接随机调用：
   - `apps/server/src/template_engine/defaults.ts`: fallback `Math.random`
   - `apps/server/src/ai/elasticity/backoff.ts`: retry jitter
   - `apps/server/src/ai/providers/anthropic.ts`: tool call fallback id
   - `apps/server/src/app/middleware/request_id.ts`: request id
   - `apps/server/src/app/services/action/action_dispatcher.ts`: probabilistic drop
   - `apps/server/src/utils/notifications.ts`: notification id
6. 当前 snapshot capture/restore 已存在，但不是 replay harness；`capturePackSnapshot()` 用于状态捕获，不能直接证明同一 seed + 同一输入序列得到同一状态。

## 目标

建立一个最小但可验证的“全模拟确定性”能力：

1. 每个 pack runtime 有稳定的 deterministic seed。
2. 模拟内会影响状态的随机行为不得直接使用 `Math.random()`。
3. 可为每个 tick / step / subsystem 派生稳定随机流，避免不同调用顺序轻微变动导致全局随机序列漂移。
4. 提供 replay harness：从相同初始状态、相同 seed、相同输入序列运行固定 tick 后，输出稳定状态摘要，重复运行得到相同 digest。
5. 明确区分“模拟状态确定性”和“观测/运维字段非确定性”。`Date.now()`、metrics latency、request id、snapshot id 等不纳入确定性状态摘要。

## 非目标

本计划不实现：

- 自动快照调度。
- 生产级 replay UI。
- Worker/child_process 插件隔离。
- 插件热重载。
- 世界包数据迁移框架。
- 让真实外部 LLM 调用 deterministic。真实模型服务可能不保证严格可复现；本计划只为 mock/fixed provider 与已记录响应提供 deterministic replay 路径。
- 消除所有 `Date.now()`。只从状态摘要和 replay 判定中剥离非确定性观测字段。

## 设计约束

1. **不能把单个全局 PRNG 到处传递作为唯一方案**：全局序列对执行顺序过敏。应采用 seed derivation：`pack_seed + tick + subsystem + purpose + stable_key`。
2. **插件贡献者可能引入非确定性**：本阶段只能为 Host API 暴露 deterministic random provider，并在 replay strict 模式检测/阻断已知非确定路径；无法静态证明第三方插件无 `Math.random()`。
3. **AI 真实调用不可强保证**：replay strict 模式应要求 mock provider、固定响应 provider，或后续的 inference trace replay。当前计划先覆盖 mock/fixed 路径。
4. **状态摘要必须排序稳定**：DB 查询、JSON key 顺序、数组顺序都要规范化，否则 digest 会误报。

## 实施阶段

### Phase 1 — 确定性基础设施

新增 deterministic runtime 模块，建议路径：

- `apps/server/src/determinism/prng.ts`
- `apps/server/src/determinism/seed.ts`
- `apps/server/src/determinism/context.ts`
- `apps/server/src/determinism/stable_json.ts`

内容：

1. 从现有 `template_engine/core/prng.ts` 抽出或复用 PRNG 实现，形成通用 deterministic PRNG。
2. 增加 seed 派生 API：
   - `deriveSeed(baseSeed, ...parts): string`
   - `createDeterministicRandom(seed): { nextFloat, nextInt, nextId, pick }`
3. 增加 `DeterminismContext`：
   - `packId`
   - `baseSeed`
   - `mode: 'off' | 'record' | 'replay' | 'strict'`
   - `forTick(tick).forSubsystem(name).forPurpose(purpose)` 派生随机流
4. 增加 stable JSON canonicalizer：
   - object key 排序；
   - bigint/string/date 规范化；
   - 可配置忽略字段。

验收：

- 相同 seed + parts 得到相同随机序列。
- 不同 subsystem/purpose/tick 得到不同随机流。
- stable JSON 对 key 顺序不同的对象输出相同字符串。

### Phase 2 — Pack runtime seed 接入

把 deterministic seed 挂到 pack runtime 生命周期，不侵入现有业务状态结构过深。

待确认具体落点：

- `PackRuntimePort` 或其实现中增加读取 deterministic seed 的方法；
- 初始化 pack runtime 时从配置/manifest/runtime option 解析 seed；
- 若未配置，生成稳定默认 seed：例如 `pack:${packId}`。不能使用 `Date.now()` 或随机字节作为默认模拟 seed。

建议行为：

1. 新增配置项，例如：
   - `simulation.determinism.enabled`
   - `simulation.determinism.seed`
   - `simulation.determinism.strict`
2. pack 级 seed 解析优先级：
   - 显式启动参数/测试参数；
   - pack 配置；
   - 默认 `pack:${packId}`。
3. `PackSimulationLoop` 在每轮 iteration 构造 tick 级 deterministic context，供 step 调用。

验收：

- 同一 pack 在同一 seed 下反复启动，得到相同 base seed。
- 测试可覆盖显式 seed 和默认 seed。

### Phase 3 — 替换影响模拟状态的随机路径

优先替换会影响模拟状态的随机调用。

必须处理：

1. `apps/server/src/app/services/action/action_dispatcher.ts`
   - 当前 `shouldDropIntent()` 使用 `Math.random()`。
   - 改为从 pack/tick/intent id 派生随机值。
   - 同一 intent 在同一 seed 下 drop 结果稳定。

2. `apps/server/src/template_engine/defaults.ts`
   - fallback `Math.random` 改为 deterministic random 或要求调用方传入 PRNG。
   - 模板宏展开已存在 PRNG，应统一到新模块，避免两套实现。

3. `apps/server/src/ai/elasticity/backoff.ts`
   - retry jitter 本身不应影响最终模拟状态；但在 strict replay 模式下，jitter 应可固定或关闭，避免测试运行时间和重试顺序漂移。

需分类但不一定纳入模拟状态：

1. `request_id.ts`：HTTP request id 属观测字段，不纳入模拟状态摘要；可保留非确定性。
2. `notifications.ts`：如果 notification id 会进入持久状态或测试断言，应改 deterministic；否则从摘要忽略。
3. `anthropic.ts` fallback tool id：真实 provider 不进入 strict replay；mock/fixed path 先覆盖。若该 id 会进入状态，后续应改为 deterministic。
4. `snapshot_capture.ts` snapshot id：不属于本计划核心；replay digest 不纳入 snapshot metadata 的 timestamp/id/random suffix。

验收：

- 全库模拟状态路径中不再有直接 `Math.random()`。
- `action_dispatcher` 的概率丢弃在同 seed 下稳定，在不同 seed 下可变化。

### Phase 4 — 确定性状态摘要

新增状态摘要模块，用于 replay 对比。

建议路径：

- `apps/server/src/determinism/state_digest.ts`

摘要来源：

1. Pack runtime sqlite 中影响世界状态的表：world entities、entity states、authority grants、mediator bindings、rule execution records 等。
2. Prisma 中 pack 相关状态：agents、identities、posts、relationships、memory blocks、context overlays、scenario states 等。可复用 `snapshot_capture.ts` 中 `queryPackPrismaData()` 的查询范围，但需要排序稳定和字段过滤。
3. Runtime clock projection：纳入 `current_tick`、`current_revision`，排除 `updated_at_ms`。

摘要规则：

- 所有集合按稳定主键排序。
- JSON 字段 canonicalize。
- 忽略 timestamp/diagnostics/metrics/request id/snapshot id 等非模拟状态字段，除非它们被业务逻辑读取并影响下一步状态。
- 输出：
  - canonical JSON；
  - sha256 digest；
  - 可选 diff 辅助信息。

验收：

- 同一状态不同查询顺序产生同一 digest。
- 修改实体状态会改变 digest。
- 修改 diagnostics timestamp 不改变 digest。

### Phase 5 — Replay harness / CLI / 测试辅助

提供最小 replay 工具，不做 UI。

建议新增：

- `apps/server/src/cli/replay_cli.ts`
- package script：`sim:replay`
- 测试 helper：`apps/server/tests/helpers/determinism.ts`

CLI 最小能力：

```bash
pnpm --filter yidhras-server sim:replay <packId> --seed <seed> --ticks <n> --runs 2
```

行为：

1. 准备相同初始状态。
2. 使用相同 seed 运行固定 tick 数。
3. 每次运行后计算 state digest。
4. digest 不一致则退出非 0，并输出差异定位信息。

实现时需要避免直接复用长期运行的 wall-clock loop。优先使用测试/CLI 的手动 tick runner：

- 禁止依赖 `setTimeout()`；
- 固定执行 `PackSimulationLoop` 中各 step 或抽出 `runOneIteration()`；
- 若当前 `runIteration()` 是 private，应抽出可测试的 `runPackSimulationIteration()` 函数，loop 只负责调度。

验收：

- 相同 seed + 相同 ticks 的两次 run digest 一致。
- 不同 seed 对含随机行为的场景产生不同 digest，或至少随机决策 trace 不同。
- 若插件/代码路径调用未托管随机源，strict 模式能在测试中暴露。

### Phase 6 — 单元测试与回归测试

新增测试覆盖：

1. PRNG/seed derivation 单元测试。
2. stable JSON/digest 单元测试。
3. `action_dispatcher` probabilistic drop deterministic 测试。
4. 手动 tick replay 测试：
   - 使用 mock AI provider；
   - 固定 seed；
   - 运行 2 次；
   - digest 相同。
5. 非确定字段排除测试：`updated_at_ms`、diagnostics duration 等不影响 digest。

## 风险与处理

1. **真实 AI 不可复现**
   - 处理：strict replay 只支持 mock/fixed provider；真实 provider 标记为 non-deterministic。

2. **插件内部非确定性无法完全控制**
   - 处理：Host API 提供 deterministic random；strict mode 对已知 Host API 路径强制使用 deterministic source；第三方插件的自由 `Math.random()` 只能通过测试/审计发现。

3. **DB 查询顺序导致 digest 漂移**
   - 处理：所有摘要集合必须显式排序，不依赖数据库默认顺序。

4. **时间字段混入业务状态**
   - 处理：先分类字段。观测时间排除；业务时间必须来自 tick/clock，不得来自 wall clock。

5. **抽出手动 tick runner 可能触碰现有 loop 行为**
   - 处理：保持 `PackSimulationLoop` 调度语义不变，只把 step 执行体抽出为共享函数；旧测试继续覆盖 loop diagnostics。

## 完成定义

完成本计划后，应满足：

1. 存在 pack 级 deterministic seed 和 tick/subsystem/purpose 派生随机流。
2. 已知会影响模拟状态的随机路径不再直接使用 `Math.random()`。
3. 存在 deterministic state digest。
4. 存在 CLI 或测试 helper 可执行同 seed 双运行对比。
5. 至少一个集成/单元测试证明相同 seed + 相同输入 + 固定 tick 数得到相同 digest。
6. `.limcode/design/generic-capability-gap-analysis.md` 的 §十二可把“全模拟可复现/确定性”从“未实施”更新为“基础实施，真实 AI/第三方插件强确定性仍受限制”。

## 建议执行顺序

1. 做 deterministic 基础模块和测试。
2. 接入 pack seed。
3. 替换 action dispatcher 和模板随机路径。
4. 抽出手动 tick runner。
5. 做 state digest。
6. 做 replay CLI/helper。
7. 补测试和文档状态更新。

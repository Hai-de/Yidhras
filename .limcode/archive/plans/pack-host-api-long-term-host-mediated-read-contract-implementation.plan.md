<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/pack-host-api-long-term-host-mediated-read-contract-design.md","contentHash":"sha256:fed2919365a8a80ec6c02acbd124f971d924dba5d3897bf6dc5f0e450feab57a"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 盘点 PackHostApi 当前实现与消费面，区分长期允许的 host-mediated read path 与不应继续扩张的 raw sidecar/control-plane 依赖  `#pack-host-plan-p1`
- [x] 更新 ARCH / PLUGIN_RUNTIME / 相关 world engine 设计文档，正式声明 PackHostApi 为长期 TS-host-owned read contract  `#pack-host-plan-p2`
- [x] 调整迁移状态矩阵、review 发现与增强项措辞，把 accepted host seam 与 optional Rust candidate 区分开  `#pack-host-plan-p3`
- [x] 收口代码内的类型/注释/边界表达，明确 PackHostApi=read plane、WorldEnginePort=control/compute plane、sidecar client=transport detail  `#pack-host-plan-p4`
- [x] 补充针对性测试与回归检查，验证 PackHostApi 继续读取 host projection truth，且插件/上层不被鼓励绕过 host contract  `#pack-host-plan-p5`
- [x] 同步 progress 与必要的 backlog/退出条件说明，确保后续 world engine 讨论不再把 PackHostApi 当临时迁移桥  `#pack-host-plan-p6`
<!-- LIMCODE_TODO_LIST_END -->

# PackHostApi long-term host-mediated read contract 实施计划

## 来源设计

- 源设计文档：`.limcode/design/pack-host-api-long-term-host-mediated-read-contract-design.md`
- 本计划严格以该设计为准，不再重新讨论“是否应继续推进 world engine 全量 Rust ownership”。
- 本计划默认接受以下长期前提：
  - world engine 长期为 **Rust core + TS host kernel**
  - TS host 始终拥有 control plane、observable truth、插件扩展宿主与外部 contract
  - Rust sidecar 只承担 bounded core / performance / safety / isolation 职责

---

## 目标

把 `PackHostApi` 从“看起来像迁移期桥接层”的状态，正式收口为：

> **由 TS host kernel 拥有的长期 host-mediated read contract**

并完成四类对齐：

1. **架构口径对齐**：文档与评审不再把 `PackHostApi` 描述为临时兼容壳
2. **owner 对齐**：明确 `PackHostApi` 属于 TS host read plane，而不是 Rust kernel surface
3. **代码边界对齐**：上层消费者继续依赖 host contract，不扩张 raw sidecar/client 依赖
4. **验收语义对齐**：后续 world engine 讨论不再以“删掉 PackHostApi / 让查询最终直接走 Rust”作为默认方向

---

## 范围

### 纳入本次实施的内容

- `PackHostApi` 的长期定位与 contract 语言正式化
- 相关架构文档、能力文档、迁移状态矩阵与评审措辞收口
- `world_engine_ports.ts` / 相关注释或类型边界的语义澄清
- 与插件系统、clock projection、query seam 的关系说明
- 针对性测试/回归补强，确保 host projection truth 与 host-mediated read path 继续成立

### 不纳入本次实施的内容

- 将 plugin host / contributor bridge 迁入 Rust
- 将 `PackHostApi` 扩展为写路径或 control plane API
- 将 world engine query 全量改为 sidecar-only
- 调整当前长期战略为“Rust 继续吃掉 TS host kernel”

---

## 当前问题归类

本次实施要处理的不是“功能缺失”，而是**边界表述与 owner 语义漂移**：

1. `createPackHostApi(...)` 在代码现实中已经是 host-mediated read surface，但文档与评审仍容易把它看成迁移期桥接物
2. world engine 相关 review/design 中仍残留“query / host seam 未来默认应继续迁 Rust”的语气
3. 插件、workflow、route、operator 层虽然现实中大多已通过 host contract 读取，但缺少统一、显式、可复述的长期原则
4. 如果不收口语言与类型边界，后续开发仍会反复把 raw sidecar protocol 当作潜在上层 ABI

---

## 工作流 A：盘点当前 PackHostApi 现实边界

### 目标

把当前实现与消费面梳理成明确的 owner 地图，避免“凭印象写文档”。

### 实施内容

1. 盘点 `createPackHostApi(...)` 当前承载的能力：
   - `getPackSummary(...)`
   - `getCurrentTick(...)`
   - `queryWorldState(...)`
2. 识别这些能力背后的真实数据来源：
   - host projection
   - host repository-backed read
   - host-mediated query assembly
3. 盘点当前 world engine 上层消费者：
   - plugin runtime
   - workflow host / runtime helpers
   - route / service / operator read model
4. 分类哪些路径是：
   - **长期允许的 host-mediated read path**
   - **不应继续扩张的 raw sidecar/control-plane dependency**

### 预期产出

- 一份“实现现实 → 长期 owner”映射清单
- 为后续文档与注释收口提供依据

---

## 工作流 B：正式化架构与能力文档口径

### 目标

让仓库中的稳定参考文档清晰表达：`PackHostApi` 是长期 TS-host-owned read contract。

### 计划更新的文档

至少包括：

- `docs/ARCH.md`
- `docs/capabilities/PLUGIN_RUNTIME.md`
- 需要时补充 `docs/API.md` 的边界说明（仅在公开 contract 受影响时）

### 核心调整点

1. 明确 `PackHostApi` 属于 **host-mediated read plane**
2. 明确 `WorldEnginePort` 属于 **control/compute plane**
3. 明确 `WorldEngineSidecarClient` 属于 **transport implementation detail**
4. 明确插件系统：
   - 是 TS host capability
   - 不默认设计 Rust plugin bridge
5. 明确 `getCurrentTick()` 的长期语义：
   - 认 host projection truth
   - 不认 raw sidecar session truth

### 验收标准

- 稳定参考文档中不再把 `PackHostApi` 写成临时兼容层
- 插件和上层消费者的默认读路径被清晰写为 host contract

---

## 工作流 C：收口迁移矩阵与评审措辞

### 目标

把“还在 TS”从一刀切的 migration gap，收口为更准确的 owner 分类。

### 计划调整的过程资产

至少包括：

- `.limcode/design/rust-migration-status-matrix-and-exit-criteria.md`
- `.limcode/design/rust-ts-host-runtime-kernel-boundary-and-clock-projection-design.md`
- `.limcode/review/rust-module-migration-gap-review.md`
- 必要时 `.limcode/enhancements-backlog.md`

### 调整原则

将 world engine 相关项重新分类为：

1. **accepted host seam**
   - 长期留在 TS host 的边界
2. **bounded TS-host-owned seam**
   - 当前及长期更可能归 TS，但需 contract 更清晰
3. **optional Rust deepening candidate**
   - 只有在性能/安全收益明确时才继续下沉到 Rust

### 特别关注的三类原有表述

- `host persistence still ts`
- `plugin contributor boundary unmigrated`
- `query and invocation bridge still ts`

这些不应继续被机械地表述为“主线未完成”，而应根据新战略重新定性。

### 验收标准

- 评审与设计文档不再默认暗示 `PackHostApi` 或 query seam 一定要继续 Rust 化
- accepted architecture seam 与 real implementation debt 被清晰区分

---

## 工作流 D：代码内 contract 语义硬化

### 目标

在不改变长期战略前提下，收口代码中的语义表达，使开发者更难误用这些对象。

### 计划触达的代码区域

优先关注：

- `apps/server/src/app/runtime/world_engine_ports.ts`
- `apps/server/src/app/runtime/world_engine_persistence.ts`
- `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts`
- `apps/server/src/app/runtime/world_engine_contributors.ts`
- 与 `PackHostApi` 直接耦合的 route/service 辅助代码

### 实施内容

1. 明确注释/类型语义：
   - `PackHostApi` = host-mediated read contract
   - `WorldEnginePort` = host-facing control/compute contract
   - sidecar client = transport detail
2. 如有必要，为容易误解的方法或工厂补充更强的命名/注释约束
3. 排查是否存在新代码继续鼓励：
   - route 直接贴 sidecar protocol
   - plugin/workflow 直接依赖 `WorldEnginePort`
4. 保持“先扩 host contract，再扩 sidecar visibility”原则

### 核心约束

- 不把 `PackHostApi` 扩张成写路径 API
- 不在本轮顺手引入新的 raw sidecar 暴露面
- 不把 host-owned truth 再拆成多个读取源

---

## 工作流 E：测试与回归补强

### 目标

确保 `PackHostApi` 的长期定位不仅写在文档里，而且在行为上继续被保护。

### 需要覆盖的测试方向

1. **unit：PackHostApi 读 host projection truth**
   - `getCurrentTick()` 优先读 host projection / host accepted state
2. **unit：read plane / control plane 区分**
   - `PackHostApi` 与 `WorldEnginePort` 的角色不混淆
3. **plugin/runtime regression**
   - 插件继续通过 host contract 读取世界态，而不是被鼓励接 sidecar client
4. **world engine persistence / clock projection regression**
   - commit → host projection → `PackHostApi.getCurrentTick()` 链条不回退

### 可选补强

- 增加测试或检查用例，防止未来 route/service 直接把 sidecar query 当公开 contract 使用

### 验收标准

- 关键行为路径有测试保护
- 新战略下最重要的读面语义（host projection truth / host-mediated read）可回归验证

---

## 工作流 F：同步 progress 与后续治理入口

### 目标

让项目过程资产与后续讨论入口与新结论一致。

### 实施内容

1. 如本轮形成正式结论，更新 `.limcode/progress.md` 的当前焦点 / latestConclusion / nextAction
2. 如仍有后续项，把它们放到合适的位置：
   - accepted seam -> ARCH / design
   - optional enhancement -> enhancements backlog
   - 明确实施项 -> 新计划/后续计划
3. 确保后续 world engine 讨论不再默认把 `PackHostApi` 当“临时迁移桥”

### 验收标准

- progress 与 active artifact 口径和最新设计一致
- 后续专题接手者能明确知道：`PackHostApi` 是长期 contract，不是待删除对象

---

## 里程碑建议

### M1：现实盘点完成
- 梳理 `PackHostApi` 当前实现与消费面
- 形成 owner / data-source / allowed-consumer 清单

### M2：稳定文档口径收口
- `ARCH.md` / `PLUGIN_RUNTIME.md` 明确 PackHostApi 长期定位
- 相关 world engine 边界文档同步改口径

### M3：过程资产与评审语言重分类
- 迁移状态矩阵与 review finding 完成 accepted seam / optional candidate 的区分

### M4：代码语义与测试护栏收口
- 注释/类型语义硬化
- 针对性测试补强与回归通过

---

## 风险与注意事项

1. **把“长期 host-owned seam”重新写成“还没迁完的 gap”**
   - 会继续制造错误路线预期。
2. **把 PackHostApi 设计成万能 host API**
   - 会模糊 read plane 与 write/control plane 边界。
3. **为了强调 host contract，反而绕过现有 projection / repository 分层**
   - 会在实现层制造新的耦合。
4. **在未证明收益前，又顺手把 query/plugin bridge 推进到 Rust**
   - 会破坏本轮边界治理目标。

---

## 完成判据

本计划执行完成后，应满足：

- `PackHostApi` 在代码、文档、评审口径中都被明确为长期 TS-host-owned read contract
- 插件 / workflow / route / operator 默认继续依赖 host-mediated read surface
- `WorldEnginePort` 与 `PackHostApi` 的 control-plane / read-plane 分工表达清晰
- 与 clock 相关的对外读取继续单一指向 host projection truth
- world engine 后续讨论不再默认把 `PackHostApi` 视为待删除的迁移桥，而是把它视为 TS control plane 的正式组成部分

# TODO

> 本文件只记录当前 backlog、优先级与最近一段时间的待处理事项。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### P1 模块化优先 / Modularization First

- [x] 先完成 server runtime 的模块边界收口，再讨论 Rust 架构升级顺序
- [x] 继续拆分 `SimulationManager` / runtime facade，避免继续承担过多组合根与运行时职责
- [x] 拆清 `control plane / runtime kernel / pack runtime / plugin host` 的职责与所有权边界，先让 plugin host 留在 Node/TS
- [x] 补一轮模块边界设计，明确 scheduler、pack runtime、context/memory、plugin runtime 的正式接口与 Host API 预留面
- [x] 收口 plugin runtime 对 pack runtime 的依赖面，避免后续 Rust 化时继续依赖 TS 内部对象

### P2 Rust 架构升级（后置）

- [ ] 在模块化边界稳定后，优先把 Rust 限定为“世界规则执行 + 世界状态维护”运行环境，不扩大到 plugin host / workflow host
- [ ] 将 scheduler、AI gateway、prompt workflow、plugin runtime 暂时保留在 Node/TS 宿主，避免第一阶段迁移面过大
- [ ] 为 Rust world engine 补充最小 Host API，先覆盖状态读取、规则执行、事件回传、可观测性回传
- [ ] 评估 `FFI / sidecar / RPC` 三种 Rust 集成路径，在未上线阶段优先选择迭代成本更低、接口更容易补齐的方案
- [ ] 明确现有插件扩展点（`context source / prompt workflow step / pack-local API route`）继续走 Host API，而不是直接侵入 Rust 内核

### P3 评估项

- [ ] 评估 `Event / Post / ActionIntent / InferenceTrace / DecisionJob` 的长期文档承载方式，避免继续散落在状态文档中
- [ ] 评估 relationship runtime evidence 的最终文档归属边界
- [ ] 评估是否需要把历史阶段性结论迁移到 `CHANGELOG.md` 或 `docs/history/`

## 近期文档更新 / Near-term Docs

- [ ] 更新 `docs/ARCH.md`，把 Rust 演进方向明确为 world engine 边界，而不是整个平台迁移
- [ ] 更新 `docs/capabilities/PLUGIN_RUNTIME.md`，明确 plugin runtime 继续由 Node/TS host 承接，后续通过 Host API 与 Rust world engine 交互

## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。
- 已完成工作的证据、评审与结论，优先进入 `.limcode/review/`、`.limcode/progress.md` 或后续专门历史文档。

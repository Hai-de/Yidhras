# TODO

> 本文件只记录当前 backlog、优先级与最近一段时间的待处理事项。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

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

# TODO

> 本文件只记录用户当前想要最近一段时间的待处理事项。
> 稳定架构事实看 `docs/ARCH.md`，业务语义看 `docs/LOGIC.md`，接口契约看 `docs/API.md`，设计/计划/评审过程看 `.limcode/`。

## 当前重点 / Current Focus

### 后续 Rust 迁移聚焦

- [x] World Engine / Pack Runtime Core
- [x] Scheduler Core Decision Kernel
- [x] Memory Block / Context Trigger Engine

> Rust world engine Phase 1A / 1B / 1C 与 Pack Runtime Core ownership deepening 已完成；后续非阻塞延续项统一转入 `docs/ENHANCEMENTS.md`。

### 评估处理rust代码堆积单文件情况
- [ ] apps/server/rust/world_engine_sidecar/src/main.rs 文件可能需要梳理拆分
- [ ] 评估在快速开发迁移至rust迭代过程中留下的历史性兼容的债务


### 梳理代码实现
- [ ] 看看还有什么代码内容是没有实现,只是用来占位的
- [ ] 实现docs/ENHANCEMENTS.md 文件中列出的高价值内容
- [ ] 完善并拓展当前世界包的各种内容
- [ ] 从零开始创建一个世界包，验证整个链路的可实现性

### 重构整个测试链路
- [ ] 长期整个单元测试文件存在测试面不足，写完对应代码就写测试，没有考虑后期迭代导致的维护性问题
- [ ] 寻找基准测试，通过更多视角察觉之前忽略的视角
- [ ] 制造压力性测试，创造各种极端/边缘的环境和条件，观察稳定性
- [ ] 寻找创造各种能破坏项目的形式，以攻击者的视角寻找安全漏洞，让整个项目快速失败

## 说明 / Notes

- 本文件不是 changelog，不记录完整已完成清单。
- 本文件不是架构总览，不长期保存稳定模块说明。
- 已完成工作的证据、评审与结论，优先进入 `.limcode/review/`、`.limcode/progress.md` 或后续专门历史文档。

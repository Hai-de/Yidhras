# 假未实现台账（冻结清单）

> 本台账用于冻结本轮“先清假未实现”的处理对象。
> 目标不是扩功能，而是把会误导阅读者的命名残影、占位输出、迁移口径与 experimental 表述分开处理。

## 分类标签

- `naming_residue`：命名或元数据仍保留 `stub` / `placeholder` 等历史迁移残影，但主能力已存在
- `fallback_sentinel`：失败态/安全兜底文本仍带有明显占位语气，但不等于主链路未实现
- `accepted_host_seam_mislabel`：长期 TS-host-owned seam 仍容易被表述成默认待迁移缺口
- `experimental_misread`：default-off / operator-only / test-only 的 experimental 能力容易被误解为“没做”
- `real_gap_do_not_touch`：真实功能缺口，本轮只记录，不在本计划中实现
- `test_double_leave_as_is`：测试替身中的 stub/fake 语义，默认不纳入本轮清理

---

## 冻结处理对象

| ID | 标签 | 位置 | 当前表述 / 症状 | 为什么会误导 | 本轮动作 |
|---|---|---|---|---|---|
| F1 | `naming_residue` | `apps/server/rust/memory_trigger_sidecar/src/main.rs` | handshake 过去返回 `engine_instance_id: "memory-trigger-sidecar-stub"`，并声明 `engine_capabilities: ["stub", ...]` | sidecar 已接入真实 `memory_trigger.source.evaluate`，但对外仍像 transport stub 阶段 | 已完成：改 handshake 元数据与 capability 文案；同步相关测试快照 |
| F2 | `fallback_sentinel` | `apps/server/src/narrative/resolver.ts` | 过去返回 `[ERROR_RECOVERED_STUB]` | 这是异常恢复兜底，不是“功能只写了 stub”，但字面会制造误判 | 已完成：改为中性、正式的恢复哨兵文本；已补定向测试 |
| F3 | `fallback_sentinel` | `apps/server/src/narrative/resolver.ts` | 返回 `[INVALID_TEMPLATE_CONTENT]`、`[INVALID_TEMPLATE_EXPRESSION]`、`[RESTRICTED_OR_MISSING]`、`[TEMPLATE_OUTPUT_LIMIT_EXCEEDED]` | 其中大部分属于正式宏运行时输出，不应混同为“未实现”；但需要统一解释，避免与 F2 的历史 stub 词汇混杂 | 本轮先保留现有稳定 contract，仅统一 F2；其余在文档/测试中明确为正式哨兵，不做破坏性改名 |
| F4 | `accepted_host_seam_mislabel` | `.limcode/review/rust-module-migration-gap-review.md` | 文件标题与部分段落曾以“迁移缺口”总称 world engine 中已 accepted 的 host seam | 容易让读者误以为 host persistence / plugin contributor / query host seam 默认都该继续迁 Rust | 已完成：调整标题/摘要/发现措辞，把 accepted host seam 与真实迁移 debt 分开 |
| F5 | `accepted_host_seam_mislabel` | `.limcode/progress.md` / 相关设计矩阵 | 个别进度/总结曾继承“缺口审查”语气 | 会让过程资产与当前 accepted seam 口径不一致 | 已完成：同步 summary / latestConclusion / nextAction |
| F6 | `experimental_misread` | `.limcode/review/multi-pack-runtime-experimental-assessment.md` 及相关稳定文档引用 | multi-pack 容易与“未实现”混读 | 该能力实际已有 registry / route / projection / operator API，问题是产品边界，不是空实现 | 已完成：review 状态与结论已收口为 completed/experimental-default-off-operator-only 事实 |
| F7 | `real_gap_do_not_touch` | `apps/server/src/memory/blocks/provider.ts` / `apps/server/src/context/sources/memory_blocks.ts` / 相关评审文档 | `trigger_rate_ignored: true`，并统计 `trigger_rate_ignored_count` | 这是明确真实功能缺口，不是假未实现 | 本轮只保留记录，不实现 |

---

## 明确保留，不纳入本轮清理

| 类别 | 位置 | 原因 |
|---|---|---|
| `test_double_leave_as_is` | `apps/server/tests/**` 中的 `*Stub*` / `InMemoryStubTransport` / `createObjectiveOnlyWorldEngineStub` 等 | 这些是测试替身，不是生产路径残影；除非断言绑定了错误的正式 handshake 文本，否则不做命名清理 |
| `real_gap_do_not_touch` | scheduler / memory trigger 的 fallback/shadow/TS baseline | 这是 reference/fallback debt，不是假未实现命名问题 |
| `real_gap_do_not_touch` | multi-pack 稳定化| 这些是后续架构/产品议题，不混入本轮 |

---

## 本轮冻结边界

1. **先处理 F1 + F2**：低争议、高收益、直接降低误读。
2. **F3 只做解释，不做破坏性 contract 改名**：避免把已有测试与消费者全部打碎。
3. **文档口径治理集中处理 F4 + F5 + F6**。
4. **F7 明确列为真实缺口，不在本轮顺手实现。**

---

## 完成本台账后的执行顺序

1. 清理 `memory_trigger_sidecar` handshake stub 残影
2. 清理 `NarrativeResolver` 的 `ERROR_RECOVERED_STUB`
3. 更新相关单测
4. 同步 review / progress / design 口径
5. 把真实缺口继续留在 backlog / review 中单独跟踪

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 增强 Graph root quick switch 与选中节点入口效率，减少依赖手动筛选与逐步切 root  `#graph-next-1`
- [x] 提升 Graph 搜索命中反馈、inspector 分组和结果解释能力  `#graph-next-2`
- [x] 把 Timeline → Social 与 Social → Timeline 的跳转从宽松语义入口收敛到更精确的上下文映射  `#mapping-next-1`
- [x] 保持与现有 Workflow / Graph 来源上下文链路兼容，并冻结新的手动验证清单  `#mapping-next-2`
<!-- LIMCODE_TODO_LIST_END -->

# Graph 深化 + Timeline / Social 语义映射优化执行文档

## 背景

当前 `apps/web` 已完成：

1. 前端目录与架构重构 Phase 1–9
2. Operator UI polish 第一阶段
3. 第二阶段首批产品增强：
   - Workflow detail 强化
   - Social detail 强化
   - Timeline detail pane 落地
   - 质量门禁与手动验证链路冻结

与此同时，仓库当前也在推进后端 scheduler 相关工作。因此前端的下一轮增量应继续坚持：

- **小步可交付**
- **不依赖新的后端 contract 改动**
- **不干扰 server scheduler 主线**
- **优先提升现有工作区的 operator 使用效率**

基于此，下一轮前端建议聚焦两条线：

1. **Graph 深化**：让 Graph 更像高效入口，而不只是可视化面板。
2. **Timeline / Social 语义映射优化**：把目前“能跳”的上下文入口变得更合理、更可解释。

---

## 目标

### Graph 方向
- 提高 root 切换效率
- 提高搜索 / 命中 / inspector 的可解释性
- 保持现有 `ClientOnly + Cytoscape` 约束不变

### Timeline / Social 映射方向
- 减少当前“宽松语义跳转”造成的歧义
- 让 Timeline → Social、Social → Timeline 更符合业务语义
- 不要求后端新增 read model 时也能先做前端侧上下文优化

---

## 范围

### 本轮纳入
- `apps/web/features/graph/*`
- `apps/web/features/social/*`
- `apps/web/features/timeline/*`
- `apps/web/features/shared/navigation.ts`
- 少量 `features/shared/*` 辅助展示/上下文组件

### 本轮不纳入
- 后端 schema / API 变更
- scheduler 相关 server 代码修改
- SSR / hydration 方向调整
- Graph 引擎替换
- UI 自动化测试

---

## 执行拆分

## Phase G1 — Graph Root Quick Switch 强化

### 目标
降低 Graph 中“找到点以后再切 root”的摩擦。

### 交付结果
- Graph toolbar 已新增 `Quick Roots` 区域。
- 当前 projection 的 `active_root_ids` 会映射为 root 快捷入口。
- 保留 `Use Selected as Root`，同时支持更快的 root 切换路径。
- 切 root 后保持 `root_id / selected_node_id` 与来源上下文语义一致。

### 验收结果
- 用户可通过 quick roots 与 selected-as-root 更快完成 root 切换。
- 既有 root 交互能力未回退。

---

## Phase G2 — Graph 搜索反馈与 Inspector 分组优化

### 目标
让 Graph 当前结果更可解释，Inspector 更利于 operator 扫读。

### 交付结果
- 新增 Graph `Search Context` 说明条，解释当前 keyword / filter / 空结果原因。
- Inspector 重组为：
  - `Core Fields`
  - `Refs`
  - `Metadata / Provenance`
- Agent / Workflow 动作入口已改为带 helper 的解释型 action cards。
- 空结果提示与恢复路径说明保持可见。

### 验收结果
- Graph 页面已具备更强的结果解释能力。
- Inspector 更接近 operator 定位与解释工具，而非原始字段堆叠。

---

## Phase M1 — Timeline → Social 语义映射优化

### 目标
让 Timeline 打开 Social 时，不再只依赖宽松 keyword 搜索，而是尽量形成更合理的上下文语义。

### 交付结果
- Timeline → Social 现在优先带：
  - `source_action_intent_id`
  - `from_tick`
  - `to_tick`
- 当 event 缺少 intent 时，才回退到 keyword 语义搜索。
- Timeline detail 中已明确提示：优先使用 linked workflow intent，否则才使用 semantic keyword context。
- Social 页面新增 `Social Mapping Context` 信息条，用于解释当前是精确缩圈还是语义上下文。

### 验收结果
- Timeline → Social 链路比原先仅 `event.title` 搜索更合理。
- 即便使用 keyword fallback，用户也能明确知道它不是精确主键映射。

---

## Phase M2 — Social → Timeline 映射优化

### 目标
修正当前 Social → Timeline 的上下文跳转语义，避免把不严格等价的 ID 当成 event 主键使用。

### 交付结果
- Social → Timeline 已不再把 `post.id` 作为 `event_id` 使用。
- 当前改为跳到 `timeline slice / tick-based context`：
  - `from_tick = createdAt`
  - `to_tick = createdAt`
- Timeline 页面新增 `Timeline Mapping Context` 信息条，明确该链路是时间片定位，不是精确事件映射。
- Timeline tick 过滤逻辑已改为 string-first 比较，不再重新引入 `BigInt`。

### 验收结果
- Social → Timeline 不再携带明显误导性的实体等价假设。
- 用户能区分“相关时间片”与“精确事件”。

---

## Phase V — 验证与回归清单更新

### 已执行质量门禁

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test:unit
```

### 冻结手动验证清单
- Graph：
  - select node
  - focus selected
  - use selected as root
  - quick roots switch
  - graph → agent / workflow
  - clear filters / search context / empty-result recovery
- Timeline：
  - select event
  - event → workflow
  - event → social context
  - verify intent-first / keyword-fallback hint
  - return to source
- Social：
  - select post
  - post → workflow
  - post → timeline slice
  - verify mapping hint is contextual rather than exact event mapping
  - return to source

### 回归结论
- 现有 Workflow / Graph 来源上下文链路未回退。
- 现有 freshness / notifications 未回退。
- Graph 深化与 Timeline / Social 语义映射优化已完成首轮收口。

---

## 建议顺序

1. **G1：Graph root quick switch 强化**
2. **G2：Graph 搜索反馈与 inspector 分组优化**
3. **M1：Timeline → Social 语义映射优化**
4. **M2：Social → Timeline 映射优化**
5. **V：验证链路收口**

本轮已按上述顺序完成。

---

## Guardrails

本轮继续继承前述冻结规则：

- CSR 不可回退
- tick 继续 string-first
- route-state 只保存业务定位与来源上下文
- Graph 保持 `ClientOnly + Cytoscape`
- 不为前端便利而去改动后端 scheduler 主线
- 通知只对关键动作与失败发出

---

## 完成定义

当以下条件同时满足时，可认为本轮增量完成：

1. Graph root 切换效率进一步提升
2. Graph 搜索与 inspector 可解释性更强
3. Timeline → Social 的语义映射更合理
4. Social → Timeline 的上下文跳转不再误导为主键级精确映射
5. `typecheck / lint / test:unit` 持续通过
6. 不干扰当前后端 scheduler 主线开发

## 本轮结论

Graph 深化 + Timeline / Social 语义映射优化这一轮前端增量已完成。
下一步可在不影响后端 scheduler 主线的前提下，继续考虑：

- shell 级 runtime / notification 联动深化
- feature-level composable / route-state tests
- 更丰富的 operator-facing semantic mapping read model（若未来后端提供更强 contract）

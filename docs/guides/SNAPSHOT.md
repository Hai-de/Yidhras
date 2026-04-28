# 世界包快照系统

快照（snapshot）是世界包运行时的完整存档点。与"开局"（opening）不同——开局是作者预定义的**静态初始场景**，应用开局会销毁数据并从 YAML 重新构建；快照则是**运行时状态的完整副本**，恢复时精确回到存档那一刻。

## 原理

### 数据分布在三层

世界包的运行时状态分散在三个存储层：

| 层 | 存储位置 | 内容 |
|----|---------|------|
| 世界引擎状态 | `data/world_packs/<pack_id>/runtime.sqlite` | world_entities、entity_states、authority_grants、mediator_bindings、rule_execution_records，以及 pack 作者定义的自定义集合表 |
| Domain 数据 | 中央 Prisma 数据库（SQLite） | Agent、Identity、IdentityNodeBinding、Post、Relationship、MemoryBlock、ContextOverlayEntry、MemoryCompactionState、ScenarioEntityState |
| 内存状态 | 进程内存 | 时钟 tick、revision、runtime speed policy |

快照必须同时捕获这三层，恢复时也同步还原。

### 快照目录结构

```
data/world_packs/<pack_id>/snapshots/<snapshot_id>/
  metadata.json           — 快照元信息（tick、时间戳、label、记录数等）
  runtime.sqlite          — 运行时 SQLite 数据库的完整文件副本
  prisma.json             — 中央 Prisma 中该 pack 相关的 domain 数据（JSON）
  storage-plan.json       — SQLite 表结构描述（与 runtime.sqlite 配套）
```

### 捕获流程

```
暂停模拟 → 读取时钟/内存状态 → 查询 Prisma（11 个模型） → 
复制 runtime.sqlite → 复制 storage-plan.json → 写 metadata.json → 恢复模拟
```

关键设计决策：

- **SQLite 用文件副本而非逐行 JSON 序列化**。pack 作者可以定义任意自定义集合表（`pack_collections`），文件副本自动覆盖这些动态表，无需知道 schema。
- **Prisma 只捕获 domain 数据**，排除操作审计记录（InferenceTrace、ActionIntent、DecisionJob、AiInvocationRecord、Event 等）。这些是执行日志，不属于世界状态。
- **每 pack 最多 20 个快照**，创建新快照时自动淘汰最旧的。

### 恢复流程

```
暂停 → 卸载世界引擎 sidecar → 清除当前 runtime.sqlite → 
拆除 kernel 桥接（Agent/Identity/Binding）→ 删除 pack-scoped Prisma 记录 → 
复制快照的 runtime.sqlite 和 storage-plan.json → 读取 applied_opening_id →
在事务中重建所有 Prisma 记录 → 恢复时钟 tick → 
幂等物化（materializePackRuntime）→ 从恢复后的 SQLite 构建 hydrate 请求 →
重载世界引擎 sidecar → 恢复模拟
```

关键点：

- **恢复前后都要操作 sidecar**：unload 清除旧内存状态，load 带 hydrate 请求将恢复后的 SQLite 状态注入 sidecar。
- **applied_opening_id 保留**：从恢复后的 SQLite 的 `__world__/meta` entity_state 中读取原始 applied_opening_id，传入 `materializePackRuntime`，避免覆盖。
- **Prisma 重建在事务中**：保证全部成功或全部回滚。

## 使用方式

### 通过 API

**创建快照：**

```bash
curl -X POST http://localhost:3001/api/packs/death-note/snapshots \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"label": "首次存档"}'
```

响应：
```json
{
  "snapshot_id": "a1b2c3d4-...",
  "pack_id": "death-note",
  "captured_at_tick": "15200",
  "prisma_record_count": 128,
  "runtime_db_size_bytes": 409600
}
```

**查看快照列表：**

```bash
curl http://localhost:3001/api/packs/death-note/snapshots \
  -H "Authorization: Bearer <token>"
```

**恢复快照（需确认数据丢失）：**

```bash
curl -X POST http://localhost:3001/api/packs/death-note/snapshots/<snapshot_id>/restore \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"confirm_data_loss": true}'
```

**删除快照：**

```bash
curl -X DELETE http://localhost:3001/api/packs/death-note/snapshots/<snapshot_id> \
  -H "Authorization: Bearer <token>"
```

### 典型工作流

1. **实验前存档**：调整模拟参数或手动触发事件之前创建快照，出问题直接恢复
2. **分支探索**：在关键决策点存档 → 运行一段时间观察 → 恢复 → 走另一条路径
3. **A/B 对比**：在相同初始状态下应用不同开局或操作，对比结果
4. **定期备份**：结合 cron 定时创建快照（未来可配合 scheduler）

## 与开局（Opening）的对比

| 特性 | 快照 (Snapshot) | 开局 (Opening) |
|------|----------------|----------------|
| 数据来源 | 运行时当前状态 | pack YAML 预定义 |
| 定义者 | 操作员随时创建 | 包作者提前编写 |
| 恢复行为 | 精确回到存档点 | 销毁数据，从 YAML 重新物化 |
| 保留内容 | 完整世界状态 + 社交数据 + 记忆 | 仅初始 entities/states/variables |
| 适用场景 | 保存进度、实验分支 | 选择初始场景、重置世界 |

快照可以视为"运行时的存档"，开局是"新游戏的初始条件选择"。两者互补：开局定义起点，快照保存中途。

## 限制与注意事项

- **恢复不可逆**：`confirm_data_loss: true` 后当前运行时数据被清除，无法撤销。建议恢复前先创建一个快照。
- **Sidecar 依赖**：恢复需要世界引擎 sidecar 可用且支持 unload/load。如果 sidecar 不在运行或 pack 未加载，恢复会失败。
- **Pack 定义变更**：如果 pack YAML 在快照后发生了结构性变更（实体增删、表结构变化），恢复仍会成功（因为 SQLite 自带 schema），但新 YAML 定义的实体不会出现在恢复后的状态中。如有需要，可在恢复后重新 apply opening。
- **磁盘空间**：每个快照是 runtime.sqlite 的完整副本。大包（>100MB SQLite）的快照会显著占用磁盘。上限 20 个，可手动删除不需要的快照。
- **不包含 AI 推理历史**：InferenceTrace、ActionIntent、DecisionJob 等操作审计记录不包含在快照中，恢复后这些记录不会重现。Post 和 Event 等叙事内容会被保留。

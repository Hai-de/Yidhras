## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] PromptFragmentV2 新增 permission_denied/denied_reason 字段 + write/adjust 标记 @unimplemented  `#P3-T1`
- [x] 实现 getHostAgentIds + resolveSlotPermission (inference/prompt_permissions.ts)  `#P3-T2`
- [x] 实现 applyPermissionFilter 树遍历过滤函数  `#P3-T3`
- [x] renderSlotText + buildPromptBundleV2 跳过 permission_denied fragment  `#P3-T4`
- [x] InferenceService 管线中集成权限过滤步骤  `#P3-T5`
- [x] 编写权限系统单元测试 (6 个用例)  `#P3-T6`
- [x] 全量测试验证  `#P3-T7`
<!-- LIMCODE_TODO_LIST_END -->

# Prompt Bundle 组件化重构 — Phase 3 实施计划（已完成）

> 来源设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md`

## 产出物

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `inference/prompt_permissions.ts` | 权限核心函数（146行）：`HOST_AGENT_TOKEN`、`getHostAgentIds`、`resolveSlotPermission`、`applyPermissionFilter` |
| 新增 | `tests/unit/prompt_permissions.spec.ts` | 权限测试（162行，6 个用例） |
| 修改 | `inference/prompt_fragment_v2.ts` | 新增 `permission_denied`/`denied_reason` 字段；`write`/`adjust` 标记 `@unimplemented` |
| 修改 | `inference/prompt_tree.ts` | `walkPromptBlocks` + `walkFragmentChildren` 跳过被拒绝 fragment |
| 修改 | `inference/prompt_builder_v2.ts` | `buildPromptBundleV2` 移除全部 denied 的 slot |
| 修改 | `inference/service.ts` | 集成了 `applyPermissionFilter` 步骤 |

## 验证

- 编译：零新增错误
- 测试：**51 文件 / 207 测试全部通过**（含 6 个新增权限测试）

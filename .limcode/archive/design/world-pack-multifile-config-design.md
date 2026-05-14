# 世界包多文件配置拆分设计（完成）

> 问题：当前世界包的所有配置强制收敛到单个 `config.yaml`（~560 行且仍在增长），无法按关注点拆分。修改一个实体字段需要导航巨型文件，按需加载不可能，多人协作互相踩踏。
>
> 目标：设计一套多文件拆分方案，使世界包作者可以按语义节将配置分散到多个文件，加载器在启动时做确定性合并。

---

## 1. 现状

```text
snowbound_mansion/
├─ config.yaml          ← 全部配置（metadata + variables + prompts + time + entities + identities +
│                          capabilities + authorities + rules + bootstrap + spatial + ai）
├─ plugins/             ← 插件已有独立文件系统
│  ├─ snowbound-game-loop/
│  │  ├─ plugin.manifest.yaml
│  │  └─ server.ts
│  └─ snowbound-mastermind/
│     ├─ plugin.manifest.yaml
│     └─ server.ts
```

`PackManifestLoader`（`loader.ts:16-50`）：
- 在包目录下查找 `config.yaml|config.yml|pack.yaml|pack.yml` 中的一个
- 读取整个文件内容，调用 `YAML.parse`
- 传给 `parseWorldPackConstitution` 做 Zod 校验
- 缓存的是整个 `WorldPack` 对象

无任何 include/merge/layer 机制。

---

## 2. 目标拆分模型

### 2.1 推荐目录结构

```text
snowbound_mansion/
├─ pack.yaml                    ← 入口文件（仅 metadata + 顶层声明 + include 指令）
├─ README.md
├─ CHANGELOG.md
├─ config/
│  ├─ variables.yaml            ← 变量定义
│  ├─ prompts.yaml              ← 提示词模板
│  ├─ time.yaml                 ← 时间系统 + simulation_time
│  ├─ entities.yaml             ← 全部实体（actors / artifacts / mediators / domains / institutions）
│  ├─ identities.yaml           ← 身份定义
│  ├─ capabilities.yaml         ← 能力声明
│  ├─ authorities.yaml          ← 权限授予
│  ├─ rules.yaml                ← 全部规则（perception / invocation / objective_enforcement 等）
│  ├─ bootstrap.yaml            ← 引导态
│  ├─ spatial.yaml              ← 空间配置
│  ├─ ai.yaml                   ← AI 配置
│  ├─ storage.yaml              ← 存储配置
│  └─ state_transforms.yaml     ← 状态转换
├─ docs/
├─ assets/
└─ plugins/
```

### 2.2 入口文件

`pack.yaml` 仅保留 metadata 和指向各拆分文件的引用：

```yaml
# pack.yaml — 入口文件
metadata:
  id: "snowbound_mansion"
  name: "暴风雪山庄"
  version: "1.0.0"
  description: "封闭环境下的多人悬疑推理模拟。"
  authors:
    - name: "Yidhras Team"
  license: "SEE LICENSE IN ROOT PROJECT"
  tags: ["mystery", "closed-circle", "social-deduction"]
  status: "stable"

# 语义节拆分引用
include:
  variables: "config/variables.yaml"
  prompts: "config/prompts.yaml"
  time_systems: "config/time.yaml"
  simulation_time: "config/time.yaml"      # 同文件不同 key
  entities: "config/entities.yaml"
  identities: "config/identities.yaml"
  capabilities: "config/capabilities.yaml"
  authorities: "config/authorities.yaml"
  rules: "config/rules.yaml"
  bootstrap: "config/bootstrap.yaml"
  spatial: "config/spatial.yaml"
  ai: "config/ai.yaml"
  storage: "config/storage.yaml"
```

### 2.3 按需加载策略

| 加载阶段 | 需要的节 | 加载文件 |
|----------|---------|----------|
| 包发现 / 目录列表 | metadata | `pack.yaml`（仅解析 metadata） |
| 校验 | 全部 | 全部（schema 需要跨节校验） |
| 物化 | entities + identities + bootstrap | 按需 |
| 模拟启动 | rules + authorities + capabilities | 按需 |
| AI 推理 | ai + prompts | 按需 |
| 查询 | storage + spatial | 按需 |

拆分的核心收益：不需要每次都解析 2000 行 YAML。包目录列表只需读 metadata 块。

---

## 3. 合并语义

### 3.1 确定性覆盖

```text
入口文件 key（如 entities） → 直接生效，忽略 include
include 引用文件 → 顶层 key 合并到根对象
多个 include 指向同一文件的不同 key → 只读一次
include 引用文件中的 key → 覆盖入口文件中同名的 key（报警告）
```

合并优先级：
1. 入口文件直接定义的 key（最高优先级）
2. include 文件中定义的 key（按 include 声明顺序，后声明的覆盖先声明的）
3. schema 默认值

### 3.2 数组语义

对于数组类型的 key（`entities.actors`、`capabilities`、`authorities` 等）：

**模式 A：替换（默认）**
- include 文件中定义的数组**完全替换**入口文件中的对应数组

**模式 B：追加**
- 显式声明 `merge: append`

```yaml
include:
  capabilities: 
    file: "config/capabilities.yaml"
    merge: append       # 将 config/capabilities.yaml 的能力追加到入口文件已定义的之后
```

### 3.3 嵌套对象语义

对于嵌套对象（`ai.tasks`、`ai.slots`），使用 **浅合并**：
- include 文件中的 key 覆盖同名 key
- 入口文件中存在但 include 文件中不存在的 key 保留

---

## 4. 加载器改动

### 4.1 PackManifestLoader 改动

```typescript
// 伪代码
public loadPack(folderName: string): WorldPack {
  // 1. 找到入口文件（pack.yaml | config.yaml | ...）
  // 2. 解析入口文件
  //    2a. 如果入口文件有 include 指令，递归加载 include 文件
  //    2b. 如果入口文件无 include 指令 → 保持现有行为（单文件模式）
  // 3. 按合并语义拼合为一个对象
  // 4. 传给 parseWorldPackConstitution 校验
  // 5. 缓存结果
}
```

### 4.2 兼容性

- **不破坏现有单文件配置**：无 `include` 指令的包保持现有行为
- schema 校验不变：合并后的对象校验与单文件完全一致
- validator CLI 增加检查：include 文件存在性、循环引用检测、重复 key 警告

---

## 5. 校验器扩展

在 `validate_pack_cli.ts` 中增加检查项：

| 检查 | 级别 | 说明 |
|------|------|------|
| include 文件存在 | FAIL | 引用的文件不存在 |
| 循环引用 | FAIL | A include B, B include A |
| 入口文件 key 被 include 覆盖 | WARN | 入口文件定义了 `entities`，但 include 也定义了它 |
| include 文件中有未预期的 key | WARN | 拆分文件包含了不属于该语义节的 key |
| 空文件 | WARN | include 文件解析后无内容 |

---

## 6. 备选方案对比

### 方案 A：include 指令（推荐）

优点：
- 作者显式控制拆分粒度
- 一个入口文件即可理解完整结构
- 加载器改动量可控（在 YAML parse 后、schema 校验前做合并）
- 工具友好（IDE 的 YAML 支持不变）

缺点：
- 需要改动 loader
- 增加了 include 解析和合并逻辑

### 方案 B：目录约定（隐式发现）

```text
snowbound_mansion/
├─ config/
│  ├─ 01-metadata.yaml
│  ├─ 02-entities.yaml
│  └─ 03-rules.yaml
```

加载器自动扫描 `config/` 目录并按文件名排序合并。不允许 include 指令。

优点：
- 无需 include 指令，减少配置行数
- 文件名即为排序依据

缺点：
- 隐式约定脆弱（作者不清楚哪些文件名会被识别）
- 排序靠文件名（01-、02-），容易出错
- 无法处理「多个拆分文件映射到同一个语义节」的场景
- 升级时容易漏文件

### 方案 C：YAML 锚点 + 别名（YAML 原生）

```yaml
# pack.yaml
entities: &entities
  actors: !include config/actors.yaml
```

依赖 YAML 自定义 tag `!include`。但 YAML 1.2 规范不支持自定义 tag，需要解析器扩展。

优点：
- 可混合使用（实体定义中嵌 include）
- 支持更细粒度的拆分

缺点：
- YAML 解析器 `yaml` 库需要配置自定义 tag
- 过于灵活 → 引用地狱
- 校验前的合并逻辑更复杂

---

## 7. 推荐方案

**方案 A：顶层 include 指令。**

理由：
1. entry file 作为索引，显式声明结构和拆分方式，作者意图清晰
2. include 指令在语义节层面（entities / rules / ai），而非在行级，拆分粒度合理
3. 实现复杂度可控：在 YAML parse 之后做对象合并
4. 完全向后兼容——不写 include 就是单文件模式
5. 允许渐进迁移：先从最大的节（entities、rules）开始拆分，其他节逐步迁移

### snowbound_mansion 拆分示例

保留 `config.yaml` 作为入口：

```yaml
# snowbound_mansion/config.yaml
metadata:
  id: "snowbound_mansion"
  name: "暴风雪山庄"
  version: "0.1.0"
  # ... 其余 metadata 不变

include:
  variables: "config/variables.yaml"
  prompts: "config/prompts.yaml"
  entities: "config/entities.yaml"
  identities: "config/identities.yaml"
  capabilities: "config/capabilities.yaml"
  authorities: "config/authorities.yaml"
  rules: "config/rules.yaml"
  bootstrap: "config/bootstrap.yaml"
  spatial: "config/spatial.yaml"
  simulation_time: "config/time.yaml"
  time_systems: "config/time.yaml"
  ai: "config/ai.yaml"
```

拆分后的 `config/entities.yaml` 聚焦于实体定义：

```yaml
# snowbound_mansion/config/entities.yaml
domains:
  - id: lobby
    label: "大厅"
    kind: domain
    entity_type: location
    state:
      public_description: "宽敞的大厅..."
      tags: [indoor, public, ground_floor]
  # ... 其余 location 定义

actors:
  - id: char_01
    label: "角色1"
    # ... 字符实体的完整定义
  # ... 其余 actor 定义

artifacts: []     # 后续补充
mediators: []     # 后续补充
institutions: []  # 后续补充
```

拆分的 `config/rules.yaml`：

```yaml
# snowbound_mansion/config/rules.yaml
perception:
  - id: "observe-event-same-location"
    when: { observer_at: "same", event_visibility: "public" }
    then: { level: "full" }
  # ... 其余 perception 规则

invocation:
  - id: "intent-move-to-location"
    when: { intent_semantic_type: "move_to_location" }
    then: { invoke: "move" }
  # ... invocation 规则

objective_enforcement:
  - id: "objective-investigate"
    when: { invocation_type: "invoke.investigate" }
    then:
      mutate:
        - { entity: subject, field: investigation_count, op: increment }
      emit_events: [...]
  # ... 其余客观执行规则
```

---

## 8. 实现影响面

| 模块 | 改动 |
|------|------|
| `packs/manifest/loader.ts` | 增加 include 解析 + 文件合并逻辑 |
| `packs/manifest/constitution_loader.ts` | 不变（合并后的对象仍走同一套 schema） |
| `cli/validate_pack_cli.ts` | 增加 include 相关检查项 |
| `init/scaffold_world_pack.ts` | 增加 `--split` 选项，生成多文件模板 |
| `templates/world-pack/` | 增加多文件变体模板 |

不影响：
- 物化管线（materialization）
- 模拟循环（sim loop）
- 插件运行时
- schema 定义（constitution_schema.ts 不变）

---

## 9. 迁移路径

对 snowbound_mansion：
1. 创建 `config/` 子目录
2. 将现有 `config.yaml` 的各节逐节迁移到 `config/*.yaml`
3. 在原 `config.yaml` 中添加 `include` 指令
4. 运行 `pnpm validate:pack snowbound_mansion` 确认拆分后校验通过
5. 删除入口文件中已迁移的内联内容

对 world-death-note：同理，按节拆分后配置易于对比两个包在各维度上的差异。

---

## 10. 为什么不直接在 schema 层做

YAML 本身没有官方 include 标准（不像 JSON Schema 的 `$ref`）。我们讨论过两个方向：

- **Schema 层**：在 `parseWorldPackConstitution` 中实现，Zod 校验前做对象展开。优点是不改变 loader 的公共 API —— loader 仍然返回 `WorldPack`，调用方无感。
- **Loader 层**：在 `PackManifestLoader` 中实现文件的发现与拼接，constitution_loader 只做校验。优点是职责清晰（loader 管 I/O，constitution_loader 管校验），且未来可以在不修改 constitution_loader 的情况下支持远程 HTTP include 等场景。

**推荐在 loader 层实现 include 解析**，constitution_loader 接收的 input 已经是合并后的对象。

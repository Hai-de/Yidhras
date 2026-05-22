# World-Pack 项目化与发布规范

本文档旨在为 Yidhras world-pack 作为独立项目单元提供组织、描述与发布方面的推荐标准。

Yidhras 核心只定义 world-pack 框架、合约与运行边界，不内建任何特定世界观语义。具体世界包只应作为该框架上的内容实现，不能反向成为项目级规范中心。

本规范不替代运行时合约（runtime contract）。运行时读取 `pack.yaml`（或 `pack.yml`）作为包入口文件；通过入口文件中的 `include` 指令按需加载 `config/*.yaml` 中各语义节的拆分配置。多文件拆分使包作者可以按关注点组织配置，修改实体不需要导航巨型文件。

> 说明：运行时直接消费 pack 配置文件；README、附加文档、素材目录等内容主要面向作者、发布者、协作者及使用者。
>
> 说明：项目级文档只说明通用 world-pack 规范；某个具体包的世界观、语义动作、AI 策略与设计取舍应优先收口在该包目录内。

---

## 1. 目标

将 world-pack 从“运行时可加载的配置单元”提升为“可被识别、维护、交付、复用与审阅的项目单元”。

为了便于发布与协作，建议 world-pack 明确以下信息：

1. 该包所定义的世界类型。
2. 模拟的主题、规则体系与叙事张力。
3. 所提供的核心实体、身份、能力、媒介与规则。
4. 运行所需的版本、依赖项与注意事项。
5. 使用者的安装、覆盖、修改与升级方式。
6. 版本变更记录、兼容性说明与已知限制。

---

## 1.1 发布元数据字段规范

为使 world-pack 更完整，建议在 `metadata` 区块中包含以下发布相关字段。

推荐字段列表：

- `metadata.id` — 世界包类型标识（type/template identity），多个实例可共享同一类型 ID
- `metadata.instance_id` — 实例标识（instance identity），默认等于包目录名。显式声明后不随目录重命名而改变，用于区分同一世界包的多个开发/测试/实验副本
- `metadata.authors`
- `metadata.license`
- `metadata.homepage`
- `metadata.repository`
- `metadata.tags`
- `metadata.compatibility`
- `metadata.published_at`
- `metadata.status`

示例：

```yaml
metadata:
  id: "world-example-pack"
  name: "Example World"
  version: "1.0.0"
  description: "一个用于说明 world-pack 项目化元数据结构的中性示例世界。"
  authors:
    - name: "Example Maintainer"
      role: "pack maintainer"
  license: "MIT"
  homepage: "https://example.com/world-pack"
  repository: "https://example.com/repo/world-pack"
  tags: ["example", "reference", "world-pack"]
  compatibility:
    yidhras: ">=0.5.0"
    schema_version: "world-pack/v1"
    notes: "仅作为元数据结构示例，不代表任何特定题材或内建世界。"
  published_at: "2026-04-14"
  status: "stable"
  frontend:
    type: "default"
```

`frontend` 字段声明包的前端类型：

| `frontend.type` | 说明 |
|------|------|
| `default` | 使用平台内置的通用前端（8 工作区布局）。字段缺失时隐含为此值 |
| `custom` | 包目录下的 `frontend/` 提供独立前端应用，Shell 通过动态挂载加载。需同时声明 `entry` 字段（如 `entry: "index.js"`），指向 `frontend/dist/` 下的入口文件 |

上述字段主要服务于：

- 发布信息记录
- 版本兼容性声明
- 前端界面或 operator 的信息展示
- 第三方收录与资产管理

---

## 1.2 instance_id 与 metadata.id 的分工

系统通过两个标识符区分"世界包类型"与"运行实例"：

| 字段 | 来源 | 语义 | 唯一性 |
|------|------|------|--------|
| `metadata.id` | `pack.yaml` | 世界包类型/模板身份。同一世界包的不同副本共享此值 | 不要求全局唯一 |
| `instance_id` | `metadata.instance_id` ?? 目录名 | 运行实例标识。路由、存储、权限绑定、时钟等全系统以此为操作主键 | 全局唯一 |

- **默认行为**：`instance_id` = 包目录名（文件系统天然唯一）。现有单实例 pack 零配置兼容。
- **显式覆盖**：`pack.yaml` 中声明 `metadata.instance_id` 可锁定实例标识，不受目录重命名影响。
- **API 响应**：`GET /api/packs` 返回 `instance_id` + `metadata_id` + `folder_name`。原单一的 `id` 字段已废弃。
- **路由**：`/:packId` 承载的是 `instance_id`，不再是 `metadata.id`。
- **数据库路径**：`data/world_packs/<instance_id>/runtime.sqlite`。

---

## 2. 运行时最小合约与项目化交付物

### 2.1 运行时最小要求

运行时以 `pack.yaml`（或 `pack.yml`）作为包入口文件。入口文件包含 `metadata` 和 `include` 指令，实际语义节内容按需从 `config/*.yaml` 加载。

**入口文件**（`pack.yaml`）承载：
- `schema_version`
- `metadata`
- `include` — 映射语义节到拆分文件路径

**拆分配置**（`config/*.yaml`）承载各语义节：
- `variables`、`prompts`、`time_systems`、`simulation_time`
- `entities`（actors / artifacts / mediators / domains / institutions）
- `identities`、`capabilities`、`authorities`
- `rules`（perception / capability_resolution / invocation / objective_enforcement / projection）
- `storage`、`scheduler`、`bootstrap`、`state_transforms`、`spatial`、`ai`

### 2.2 项目化发布最小要求

将 world-pack 作为项目单元进行发布时，建议包含以下文件：

- `pack.yaml`：包入口文件（metadata + include 指令）
- `config/`：拆分配置目录（各语义节 yaml 文件）
- `README.md`：项目说明文件（推荐必备）
- `CHANGELOG.md`：版本变更记录（推荐提供）
- `assets/`：插图、封面、图标等外部素材目录（按需）
- `docs/`：扩展说明文档目录（按需）

各文件用途如下：

- `pack.yaml`：面向运行时（入口 + 索引）
- `config/*.yaml`：面向运行时（各语义节的具体内容）
- `README.md`：面向人类阅读者
- `CHANGELOG.md`：面向版本管理
- `assets/`、`docs/`：面向展示、协作与长期维护

### 2.2.1 include 指令格式

`pack.yaml` 中的 `include` 字段将语义节映射到拆分配置文件。每个 key 是顶层 schema 字段名，每个 value 是相对于包目录的文件路径。

```yaml
# pack.yaml — 入口文件
metadata:
  id: "my_world"
  name: "My World"
  version: "1.0.0"
  # ...

include:
  variables: "config/variables.yaml"
  prompts: "config/prompts.yaml"
  time_systems: "config/time_systems.yaml"
  simulation_time: "config/simulation_time.yaml"
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

**合并规则**：
- 入口文件中不出现 `include` 以外的语义节内容；`metadata` 始终在入口文件中
- 每个 include 文件的内容是该 section 的直接值，不需要再嵌套 section key
- 如果一个文件恰好只有一个 key 且与 section 同名，加载器自动解包
- 同一文件被多个 section 引用时只读取一次
- include 路径必须在包目录内（不允许 `..` 穿越）

合法的 section key 列表与 §2.1 中列出的拆分配置一致。使用未识别的 key 会产生警告但不会阻断加载（内容通过 schema passthrough 透传）。

### 2.2.2 加载流程

1. 读取 `pack.yaml`，解析 `include` 指令
2. 按需加载各 `config/*.yaml`，合并为一个对象
3. 剥离 `include` 字段，将合并后的对象送入 schema 校验
4. 校验通过后进入物化管线

## 2.3 变量与宏模板

world-pack 作者可以在 `variables`、`prompts.*` 及部分 runtime/rule 文本字段中使用 Prompt Workflow 的统一模板语法。

_pack 作者视角的关键要点：_

- **优先使用命名空间写法**：`pack.*`、`actor.*`、`runtime.*`、`request.*`、`system.*`、`app.*`、`plugin.<pluginId>.*`
- **避免裸 key 别名**：旧写法如 `{{ actor_name }}`、`{{ world_name }}` 仅为兼容桥接，不推荐新增
- **支持受控宏**：基础插值 `{{ ... }}`、默认值 `| default(...)` 、条件块 `{{#if}}`、列表展开 `{{#each}}`
- **内置宏函数**：模板引擎支持以下宏，用于在物化阶段将随机性展开为确定性值
- **不支持**：任意脚本/JS 表达式/通用模板编程
- **上手建议**：静态信息放 `metadata`/`variables`，取值优先 `pack.metadata.*`/`pack.variables.*`，不稳定字段补 `default(...)`

### 2.3.1 内置宏函数

宏函数使用命名参数语法，在物化阶段（`materializePackRuntimeCoreModels`）展开为具体值，展开结果写入 runtime DB。后续推理读到的是已确定的状态，不再经过模板引擎。

| 宏 | 语法 | 返回类型 | 说明 |
|----|------|----------|------|
| `roll` | `{{roll count=2 sides=6}}` | number → string | NdN 骰子求和。`count` 默认 1 |
| `pick` | `{{pick from=a,b,c count=3}}` | string | 从列表中不放回随机选取。`count` 默认 1。`from` 接受逗号分隔字符串 |
| `int` | `{{int min=0 max=99}}` | number → string | 区间内随机整数 |
| `float` | `{{float min=0 max=1}}` | number → string | 区间内随机浮点数 |
| `seed` | `{{seed}}` | string | 返回物化阶段使用的 PRNG 种子值（只读），用于问题排查与可复现性确认 |

**设计原则**：随机性决定模拟状态，不是作为提示词噪声。AI 推理时读到的是宏展开后的确定性值。

> **类型限制**：宏处理器签名限定所有参数为 `Record<string, string>`，即所有参数值（包括 `count`、`sides`、`min`、`max` 等数值型参数）均以字符串形式传递，宏处理器内部执行 `parseInt`/`parseFloat` 转换。`pick` 宏的 `from` 参数接受逗号分隔字符串（如 `from=a,b,c`），返回结果为字符串而非数组（如 `"a"` 而非 `["a"]`）。返回值类型标注（如 "string 或 string[]"）表示语义期望，实际全部为字符串。

**可重现性**：在 `variables.seed` 中指定种子字符串，相同 YAML 配置 + 相同种子产生相同世界。未提供时使用 `crypto.randomUUID()` 自动生成并记录到世界包元数据（`meta` state 中的 `seed` 字段）。

完整的命名空间列表、alias fallback 顺序、模板语法详解与诊断方法，见 → [`../subsystems/PROMPT_WORKFLOW.md`](../subsystems/PROMPT_WORKFLOW.md) 第 7 节

宏处理器架构与扩展机制，见 → [`../subsystems/STRUCTURED_PARSER.md`](../subsystems/STRUCTURED_PARSER.md) 第 11 节

### 2.3.2 空间谓词

在 `rules.objective_enforcement[*].when` 中可使用以下空间条件，执行引擎在调用世界引擎侧车前做预过滤：

```yaml
rules:
  objective_enforcement:
    - id: investigate_rule
      when:
        invocation_type: invoke.investigate
        location:
          in: [kitchen, library]       # subject 必须在指定地点之一
          adjacent_to: basement         # subject 必须与指定地点邻接（或在其内）
      then:
        emit_events:
          - title: 发现线索
            description: 你在房间里发现了可疑的痕迹
```

| 谓词 | 语法 | 说明 |
|------|------|------|
| `location.in` | `in: [location_id, ...]` | subject 所在地必须是数组中之一 |
| `location.adjacent_to` | `adjacent_to: location_id` | subject 必须在该地点的邻接节点上（含该地点本身） |

两者可组合使用（AND 语义）。未声明 `location` 条件的规则不受影响，保持现有行为。无空间配置的世界包不触发预过滤。

### 2.3.3 变量类型支持

`variables` 段的值类型为 `WorldPackVariableValue`，支持以下类型：

| 类型 | 示例 |
|------|------|
| `string` | `name: "张三"` |
| `number` | `max_players: 12` |
| `boolean` | `debug_mode: false` |
| `array` | `names: ["张三", "李娜", "王刚"]` |
| `record` | `config: { key: "value" }` |

`pick` 宏的 `from` 参数使用数组字面量语法：`{{pick from=["a","b","c"]}}`。macro handler 签名 `args: Record<string, MacroValue>` 支持 number、boolean、array 等完整类型。

---

## 2.4 权限与 target_selector

### 2.4.1 target_selector 类型

`authorities[].target_selector` 的 `kind` 字段支持以下值，用于匹配授权目标：

| kind | 必需字段 | 匹配逻辑 |
|------|----------|----------|
| `direct_entity` | `entity_id` | 精确匹配单个 entity |
| `holder_of` | `entity_id` | 匹配持有指定物品的实体 |
| `subject_entity` | `entity_id` 或 `identity_id` | 匹配指定 entity 或 identity |
| `all_actors` | 无 | 匹配所有 `entity_kind: actor` 的实体 |
| `entity_type_is` | `entity_type` | 匹配指定 `entity_type` 的所有实体 |
| `binding_of` | `entity_id` | 匹配通过 mediator 绑定的实体 |
| `domain_owner` | `entity_id` | 匹配 domain 所有者 |
| `ritual_participant` | — | 匹配 ritual 参与者 |

`subject_entity` 支持 `entity_id` 匹配路径，允许直接对实体授权而不需要通过 identity 映射。

`all_actors` 和 `entity_type_is` 支持批量授权场景。示例：

```yaml
# 替换逐角色逐一授权（12 条 → 1 条）
authorities:
  - id: "grant-investigate-all"
    source_entity_id: "__world__"
    target_selector: { kind: "all_actors" }
    capability_key: "invoke.investigate"
    grant_type: "intrinsic"
    priority: 100
```

```yaml
# 按 entity_type 批量授权
authorities:
  - id: "grant-location-access"
    source_entity_id: "__world__"
    target_selector: { kind: "entity_type_is", entity_type: "location" }
    capability_key: "perceive.environment"
    grant_type: "intrinsic"
    priority: 100
```

### 2.4.2 感知解析器扩展

感知管线（sim loop step 6）默认使用平台内置的 `spatial_proximity` 解析器（同地点 public 事件 → full，private 事件仅 target → full，其他 → none）。

插件可通过 `host.registerPerceptionResolver()` 注册自定义感知解析器，实现声学衰减传播、社交网络传播、光速延迟等非标准感知模型。管线在运行时优先使用插件注册的解析器，未注册时回退默认实现。

详见 → [`../subsystems/PLUGIN_RUNTIME.md`](../subsystems/PLUGIN_RUNTIME.md) 第 9 节

---

## 2.5 Schema 校验规则

运行时 schema 对 pack constitution 执行以下跨字段校验：

- `identities[].subject_entity_id` 必须引用一个已声明的 `entities.actors[].id`
  - 若引用不存在的 actor ID，schema 校验将失败并返回自定义错误
  - 此校验确保 pack identity 与 pack actor 之间的显式绑定关系在加载时即被验证

此外，独立的 `entities.actors[].kind` 字段支持以下枚举值：
`actor`、`artifact`、`mediator`、`domain`、`institution`、`abstract_authority`、`relay`、`persona`。该字段在 materialization 时会流入 `InferenceActorRef.entity_kind`，供 prompt 与 policy 层识别 actor 类型。

---

## 3. 推荐目录结构

推荐的 world-pack 项目目录结构如下：

```text
<pack-dir>/
├─ pack.yaml                # 包入口（metadata + include 指令）
├─ config/                  # 拆分配置目录
│  ├─ variables.yaml
│  ├─ prompts.yaml
│  ├─ time_systems.yaml
│  ├─ simulation_time.yaml
│  ├─ entities.yaml
│  ├─ identities.yaml
│  ├─ capabilities.yaml
│  ├─ authorities.yaml
│  ├─ rules.yaml
│  ├─ bootstrap.yaml
│  ├─ ai.yaml
│  ├─ spatial.yaml
│  └─ storage.yaml
├─ README.md
├─ CHANGELOG.md
├─ LICENSE                  # 可选，公开发布时建议提供
├─ assets/                  # 可选
│  ├─ cover.png
│  └─ icon.png
├─ docs/                    # 可选
│  ├─ setting.md
│  ├─ rules.md
│  └─ release-notes.md
├─ frontend/                # 可选，custom 包前端源码（type: "custom" 时必需）
│  ├─ index.ts              # 入口，导出 mount(target, context) 和 unmount(app)
│  ├─ App.vue               # 根组件
│  └─ dist/                 # 构建产物目录（由 Vite 等工具生成）
├─ plugins/                 # 可选，pack-local 插件工件目录
└─ examples/                # 可选
   └─ overrides.example.yaml
```

### 目录职责说明

- `pack.yaml`
  - 包入口文件，包含 `metadata` 和 `include` 指令
  - `include` 将各语义节映射到 `config/*.yaml` 文件路径
  - 用于包发现（仅需解析 metadata）和配置加载
- `config/`
  - 存放按语义节拆分的 YAML 配置文件
  - 一个 section 对应一个文件，便于按关注点修改和按需加载
- `README.md`
  - 作为 pack 的外部入口文档
  - 使首次接触者能够快速了解 pack 的用途与边界
- `CHANGELOG.md`
  - 记录版本变更、兼容性变化及破坏性变更
- `assets/`
  - 存放非代码、非配置的展示素材
- `docs/`
  - 存放超出 README 范围的详细说明文档
- `frontend/`
  - 存放 custom 包前端源码与构建产物。入口文件导出 `mount(target, context)` 接收 ShellContext 并返回 Vue App 实例，`unmount(app)` 负责销毁
  - `dist/` 子目录存放构建产物，由服务端静态资源路由 serving
- `plugins/`
  - 存放 pack-local 插件工件；不会因随 pack 分发而自动启用
- `examples/`
  - 存放覆盖配置（override）示例、调用示例或配置片段

---

## 4. README.md 规范

### 4.1 必要性说明

如果未提供 README.md，使用者通常需要通过直接阅读 `pack.yaml` 和 `config/*.yaml` 来获取 pack 信息，这可能带来一些不便：

1. YAML 格式更适合机器解析，不适合作为项目说明入口。
2. 发布者的设计意图、题材背景、使用方式难以被快速理解。
3. 使用者难以判断 pack 是否适用于其运行环境。
4. 协作者难以在不完全阅读合约内容的前提下参与维护。
5. 缺少版本升级、兼容性变更、注意事项的稳定记录位置。

因此，README.md 适合作为 world-pack 面向人类读者的说明性入口。

### 4.2 内容要求

建议 README.md 涵盖以下章节内容：

1. **Pack 名称与一句话简介**
2. **题材 / 世界背景前提**
3. **核心机制摘要**
4. **版本与兼容性说明**
5. **目录结构说明**
6. **安装、使用与启动方式**
7. **关键实体、身份、能力、媒介、规则概览**
8. **已知限制**
9. **变更记录索引**
10. **作者与发布信息**

### 4.3 能力边界说明

README.md 宜明确区分：

- **已实现**的 pack 级能力
- **计划支持**的能力
- **仍由 kernel 管理**、pack 不可声明的能力

推荐避免在 README.md 中将尚未在 pack schema 或 loader 中开放的功能描述为可由 pack 作者直接声明的能力。

---

## 5. README.md 模板结构

```markdown
# <World-Pack Name>

> 一句话说明该 world-pack 所模拟的世界特征。

## 概览
- Pack ID:
- Version:
- 题材:
- 状态:
- 兼容的 Yidhras 版本:

## 世界前提
描述该世界的核心设定、冲突与叙事张力。

## 核心机制
- 实体
- 身份
- 能力
- 媒介
- 客观规则

## 目录结构
说明 `pack.yaml`、`config/`、`assets/`、`docs/` 等目录的用途。

## 使用方式
说明将 pack 放入 `data/world_packs/<pack>` 并启动的方法。

## 插件
- 如果 pack 目录内包含 `plugins/` 子目录，运行时会扫描其中的 `plugin.manifest.yaml` / `plugin.manifest.yml`。
- 仅支持 pack-local 插件；扫描后创建为 `pending_confirmation`，需先 confirm import 再 enable。
- 插件治理流程、acknowledgement 语义、Web runtime 与同源路由详见 → [`../subsystems/PLUGIN_RUNTIME.md`](../subsystems/PLUGIN_RUNTIME.md)。
- 推荐插件目录结构：
  - `plugins/<plugin-dir>/plugin.manifest.yaml`
  - `plugins/<plugin-dir>/src/` 或 `plugins/<plugin-dir>/dist/`

## 设计边界
说明哪些行为由 pack 声明控制，哪些仍由平台或 kernel 控制。

## 已知限制
列出未覆盖的规则、前端能力缺口、暂未实现的功能等。

## 版本记录
链接至 `CHANGELOG.md`。

## 作者 / 发布
记录作者、发布日期、许可证及发布说明。
```

---

## 6. 发布者配套内容建议

若 world-pack 预期被下载、评估、试用或二次修改，除 README.md 外，建议补充以下内容。

### 6.1 CHANGELOG.md

用于记录：

- 新增的能力、规则、实体
- 世界状态字段的调整
- prompts 或 AI 任务组织的变更
- 客观规则执行（objective enforcement）行为的修改
- 破坏性变更

### 6.2 LICENSE

若 pack 计划用于开放共享、二次分发或商业用途，建议明确许可证。

### 6.3 docs/

当 README.md 篇幅过长时，可将以下内容拆分至 `docs/` 目录：

- 详细的世界设定
- 阵营或角色说明
- 能力与权限矩阵
- 媒介机制详解
- operator 观察视角说明
- 作者的设计理念与扩展计划

### 6.4 assets/

若 pack 用于分发页面、作品页或商店式展示，素材目录建议包含：

- 封面图像
- 图标
- 角色或物件示意图
- 宣传图像
- 授权素材清单

---

## 7. 仓库落地规范

基于仓库结构，建议采用以下分层方式。

### 7.1 版本管理模板

存放位置：

- `apps/server/templates/world-pack/`

该目录可放置由仓库正式维护的默认模板，例如：

- `pack.entry.yaml.template` — 多文件入口模板
- `section.<name>.yaml.template` — 各语义节模板
- `pack.README.template.md`
- `pack.CHANGELOG.template.md`
- `example_pack.yaml` / `example_pack.README.md` / `example_pack.CHANGELOG.md`
- `death_note.yaml` / `death_note.README.md` / `death_note.CHANGELOG.md`

其中 bundled example 可以是 `death_note` 或 `example_pack`；它们是示例资源，而不是项目核心默认世界。

### 7.2 运行时脚手架镜像

存放位置：

- `data/configw/templates/world-pack/`

该目录为启动时会被脚手架复制至本地运行目录的模板镜像。

### 7.3 实际 pack 目录

存放位置：

- `data/world_packs/<pack-dir>/`

该目录建议以项目单元形式存在，至少包含：

- `pack.yaml`（入口文件）
- `config/*.yaml`（拆分配置）
- `README.md`

若计划公开发布，建议补充：

- `CHANGELOG.md`
- `docs/`
- `assets/`

---

## 7.4 新建 world-pack 项目脚手架命令

仓库提供基础脚手架命令，完整参数列表与使用说明见 → [`docs/guides/COMMANDS.md`](guides/COMMANDS.md) 第 2.5 节 / 第 3.5 节。

```bash
pnpm scaffold:world-pack -- --dir my_pack --name "My Pack" --author "Your Name"
```

该命令将在 `data/world_packs/<pack-dir>/` 下创建多文件结构（`pack.yaml` + `config/*.yaml`）、`README.md`、`CHANGELOG.md` 及空目录 `docs/`、`assets/`、`examples/`，并对合并后的配置执行 schema 校验。

## 8. 参考实现与 bundled example

仓库可以包含一个或多个 bundled example world-pack，用来展示完整 contract 的一种实现方式。它们的定位是参考实例，不是宿主核心默认语义。

- 例如 `death_note` 可以作为参考实例（目录名 = instance_id，`metadata.id` = `world-death-note`）：
  - 入口文件：`data/world_packs/death_note/pack.yaml`
  - 拆分配置：`data/world_packs/death_note/config/*.yaml`
  - 模板来源：`apps/server/templates/world-pack/death_note.yaml`
  - 包内说明建议收口在：`data/world_packs/death_note/README.md`、`CHANGELOG.md`

项目级文档只应说明 world-pack 的通用建议；具体包的世界观、题材语义、动作链与设计取舍，应以该包目录中的文档为准。
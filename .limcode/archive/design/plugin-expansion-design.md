# 插件拓展 设计

> 状态: 已实现 (阶段 1-3 完成)
> 关联: TODO.md — 插件拓展 + 数据的策略性清洗接口
> 评估时间: 2026-05-02
> 实施时间: 2026-05-02

## 1. 背景

当前插件系统 (`apps/server/src/plugins/`) 已有完整的基础设施：discovery → lifecycle state machine → runtime registry → contribution injection。但存在两个结构性空白：

1. **插件之间没有顺序保证** — `PluginRuntimeRegistry` 用 `Map<string, RegisteredServerPluginRuntime[]>` 存储，数组顺序取决于 readdir 返回顺序，不可控也不可声明
2. **插件之间没有依赖机制** — manifest (`packages/contracts/src/plugins.ts`) 无 `dependencies` 字段，无依赖解析/校验逻辑

同时 TODO.md 列出了 8 个数据策略性清洗接口，要求以插件形式实现，接口本身作为插件的依赖而存在。

## 2. 设计目标

- **加载顺序表**：插件可声明 priority，pack 作者可覆盖，runtime 按顺序加载
- **依赖确定**：接口依赖为主（声明需要什么 capability/interface），硬依赖为辅（声明需要某个具体插件）
- **DataCleaner 统一抽象**：将 8 个清洗接口统一为一个 `DataCleaner` 接口，不同实现覆盖不同策略
- **端到端验证**：落地 "基础字符串方法" 和 "正则引擎" 两个最小实现，贯通整个流程

## 3. 核心设计

### 3.1 插件加载顺序

#### 3.1.1 优先级来源（优先级从高到低）

| 层级 | 来源 | 说明 |
|------|------|------|
| 1 (最高) | pack 级 `plugins/order.yaml` | pack 作者显式排序，覆盖 manifest 声明 |
| 2 | manifest `load.priority` | 插件自声明默认优先级 |
| 3 (最低) | discovery 顺序 | 文件系统 readdir 顺序，无声明时的 fallback |

#### 3.1.2 Manifest 扩展

```yaml
# plugin.manifest.yaml 新增字段
load:
  priority: 100          # 整数，默认 0，越大越先加载
  after: []              # 字符串数组，plugin_id 列表，声明"必须在这些插件之后加载"
```

`after` 是相对顺序约束，解决"我不用管全局 priority 数字，只需要排在某插件后面"的场景。

#### 3.1.3 Pack 级顺序覆盖（可选）

```yaml
# <pack>/plugins/order.yaml
# 格式: plugin_id 列表，排前面的先加载
order:
  - "regex-engine"
  - "string-methods"
  - "nlp-fuzzy"
```

此文件不是必须的。不提供时，完全由 manifest 的 `load.priority` + `load.after` 决定顺序。

#### 3.1.4 排序算法

Kahn 拓扑排序：
1. 读取 pack 级 order.yaml（如存在），将其中的 plugin_id 赋予绝对位置
2. 对每个插件，解析 manifest 中的 load.priority（默认 0）
3. 构建拓扑图：load.after 建立有向边（依赖项 → 依赖者）
4. 排序键: (order.yaml 位置 ASC, load.priority DESC, 字母序)
5. 检测循环 — 拓扑排序失败时抛出 `PLUGIN_LOAD_CYCLE_DETECTED`
6. 输出排序后的列表

#### 3.1.5 排序的执行位置

在 `refreshPackPluginRuntime()` (`apps/server/src/plugins/runtime.ts`) 中，获取 enabled installations 之后、创建 runtime 对象之前，调用 `resolveLoadOrder()` 执行排序。

### 3.2 插件依赖解析

#### 3.2.1 依赖模型

采用 **"接口依赖为主、硬依赖为辅"** 的模型：

**接口依赖（Interface Dependency）**：
- 插件声明自己**提供了**哪些接口（`provides`）
- 插件声明自己**需要**哪些接口（`dependencies.interfaces`）
- 接口是抽象的 capability key，如 `data_cleaner.regex`、`data_cleaner.string`
- 任意提供了该接口的 enabled 插件都可满足依赖

**硬依赖（Hard Dependency）**：
- 插件声明自己依赖某个具体的 `plugin_id`（`dependencies.plugins`）
- 用于版本耦合场景（如 "必须用 my-parser v2.x"）
- 使用 semver range 约束版本

#### 3.2.2 Manifest 扩展

```yaml
# plugin.manifest.yaml 新增字段
dependencies:
  interfaces:                    # 接口依赖
    - key: "data_cleaner.string"       # 接口 key
      version: ">=1.0.0"              # 可选，接口版本约束
      optional: false                  # 可选，默认 false（硬依赖）
    - key: "data_cleaner.regex"
      optional: true                   # 可选依赖：有则增强，无则降级
  plugins:                        # 硬依赖（可选）
    - plugin_id: "some-specific-plugin"
      version: ">=2.0.0"
      optional: false

provides:                        # 本插件提供的接口
  - key: "data_cleaner.regex"
    version: "1.0.0"
```

#### 3.2.3 接口 key 命名约定

```
<category>.<name>
```

示例：
- `data_cleaner.regex`
- `data_cleaner.string`
- `data_cleaner.structured_parser`
- `data_cleaner.nlp`
- `data_cleaner.rule_engine`
- `data_cleaner.ml`
- `data_cleaner.vector`

#### 3.2.4 依赖校验时机

**实际实现位置**: `apps/server/src/app/services/plugins.ts` 的 `enablePackPlugin()`（app 层服务），而非设计初期计划的 `PluginManagerService.enableInstallation()`（core 层）。原因是依赖检查需要访问全局的 enabled installations 和 manifests，这些上下文在 app 层更易获取。

校验逻辑：
1. `assertPluginEnableAllowed` → 确认生命周期状态允许
2. `checkDependencies()` → 新增依赖检查
   - 收集当前 pack 的 pack_local enabled installations + 所有 global enabled installations
   - 检查所有硬依赖的 plugin_id 是否已 enabled 且版本匹配
   - 检查所有接口依赖是否有 enabled 插件提供且版本匹配
   - 可选依赖缺失 → 记录但不阻塞
   - 必需依赖缺失 → 拒绝 enable，返回 `PLUGIN_DEPENDENCIES_UNSATISFIED` 错误
3. enable_warning 确认（如配置要求）
4. 写入 enabled 状态

#### 3.2.5 依赖重校验

当插件 A 被 disable 时，调用 `checkReverseDependencies()` 检查是否有其他 enabled 插件硬依赖于 A（可选依赖不计入）。

- **非严格模式**（`plugins.dependency.strict: false`，默认）：警告但允许 disable，日志记录依赖者列表
- **严格模式**（`plugins.dependency.strict: true`）：拒绝 disable，返回 `PLUGIN_HAS_DEPENDENTS` 错误，列出被阻塞的插件

### 3.3 DataCleaner 接口

#### 3.3.1 设计原则

不引入新的插件贡献类型（step_contributor / rule_contributor / query_contributor），因为 DataCleaner 的语义与现有贡献点不同：

- `StepContributor` 是模拟步骤的执行器，作用于 world engine tick
- `RuleContributor` 是规则评估器
- `QueryContributor` 是查询扩展

DataCleaner 是一个**数据处理管道**的抽象，它在提示词构建流程中使用（数据清洗 → 上下文构建）。第一版在 `packages/contracts` 定义数据 schema，运行时接口和注册表在 `apps/server` 中。

#### 3.3.2 接口定义（contracts）

```typescript
// packages/contracts/src/data_cleaner.ts

// Zod schemas + 推断的 TypeScript 类型
const dataCleanerInputSchema = z.object({
  text: z.string(),
  options: z.record(z.string(), z.unknown()).optional()
})

const dataCleanerOutputSchema = z.object({
  cleaned: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional()
})

const dataCleanerInterfaceKeySchema = z.string().regex(/^data_cleaner\.\w+$/)
```

实际实现使用 Zod schema（而非纯 TypeScript interface），与 contracts 包中其他模块风格一致。

#### 3.3.3 运行时注册（server）

```typescript
// apps/server/src/plugins/extensions/data_cleaner_registry.ts

interface DataCleaner {
  readonly key: string;
  readonly version: string;
  clean(input: DataCleanerInput): Promise<DataCleanerOutput>;
}

class DataCleanerRegistry {
  register(cleaner: DataCleaner): void     // 同名 key 后者覆盖
  get(key: string): DataCleaner | undefined
  list(): DataCleaner[]
  keys(): string[]
  clean(key: string, input: DataCleanerInput): Promise<DataCleanerOutput>
  clear(): void
}

export const dataCleanerRegistry = new DataCleanerRegistry();
```

插件通过 server entrypoint（`activate(host)` 函数）调用 `host.registerDataCleaner(impl)` 注册自身。`registerDataCleaner` 已添加为 `ServerPluginHostApi` 的新方法，其实现直接写入全局 `dataCleanerRegistry`。

#### 3.3.4 与现有 PluginRuntimeRegistry 的关系

`DataCleanerRegistry` 是一个独立的、功能特定的注册表，不合并到 `PluginRuntimeRegistry`。理由：
- `PluginRuntimeRegistry` 管理的是 pack-scoped 贡献（按 packId 分组）
- `DataCleanerRegistry` 是全局的（所有 pack 的 cleaner 在同一命名空间下）
- 未来可能有更多此类全局扩展点（如 `EmbedderRegistry`），保持模式一致

### 3.4 系统 Pack

#### 3.4.1 定位

内置 system pack 是一个特殊的 world pack，存放 Yidhras 内置的基础插件实现。与普通 pack 的区别：

| 属性 | 普通 pack | system pack |
|------|-----------|-------------|
| 位置 | `data/world_packs/<name>/` | `apps/server/builtin/system_pack/` |
| 加载方式 | 手动激活 | 启动时自动加载 |
| scope_type | `pack_local` | **`global`**（实际采用，确保跨 pack 可见） |
| 可禁用 | 是 | 否（核心功能） |

> **实施偏差说明**：设计初期计划 system pack 用 `pack_local` scope + 特殊处理。实际实现采用 `scope_type: 'global'`，因为：
> - `scope_type` 枚举中已有 `global` 值，无需新增
> - `refreshPackPluginRuntime` 已合并查询 `pack_local` + `global` 两种 scope
> - 语义更清晰：全局插件对所有 pack 可见，无需特殊判断

#### 3.4.2 目录结构

```
apps/server/builtin/system_pack/
  config.yaml                        # 系统 pack manifest (system: true)
  README.md
  plugins/
    order.yaml                       # 加载顺序（含 ReDoS 安全警告注释）
    string-methods/
      plugin.manifest.yaml           # 提供 data_cleaner.string
      server.ts                      # 7 种清洗模式
    regex-engine/
      plugin.manifest.yaml           # 提供 data_cleaner.regex
      server.ts                      # ReDoS 防护实现
```

#### 3.4.3 启动时的加载

`initSystemPackPlugins()` (`apps/server/src/plugins/system_pack_init.ts`) 负责：
1. 扫描 `apps/server/builtin/system_pack/plugins/` 目录
2. 为每个插件创建 PluginArtifact + PluginInstallation 记录（`scope_type: 'global'`）
3. 自动 confirm + enable（跳过 enable_warning）
4. 幂等操作 — 重复调用不会产生重复记录

在 `index.ts` 中，`syncActivePackPluginRuntime()` 之前调用。

### 3.5 两个最小实现

#### 3.5.1 基础字符串方法 (`data_cleaner.string`)

通过 `options.mode` 选择策略，支持 7 种模式：
- `trim` — 去除首尾空白（默认）
- `lowercase` — 转小写
- `uppercase` — 转大写
- `collapse_whitespace` — 合并连续空白
- `strip_html` — 去除 HTML 标签
- `strip_control` — 去除控制字符
- `strip_punctuation` — 去除标点符号

#### 3.5.2 正则引擎 (`data_cleaner.regex`)

通过 `options` 配置：
- `pattern` — 正则表达式（默认 `.*`）
- `replacement` — 替换字符串（默认 `''`）
- `flags` — 正则标志（默认 `'g'`）

ReDoS 防护（多层纵深）：
1. 模式长度限制（默认 4096 字符，可通过 `max_pattern_length` 调整）
2. 嵌套量词检测 — 拒绝含有 `(.*)*` / `(.+)+` 等危险模式的表达式（可设置 `allow_nested_quantifiers: true` 跳过，但需自担风险）
3. 执行超时（默认 5s，可通过 `timeout_ms` 调整）
4. 匹配次数上限（默认 100,000，超出抛出错误）

所有限制参数均可在 `options` 中覆盖。`order.yaml` 中包含警告注释，告知部署者修改顺序和防护参数的风险。暂不引入 `re2`。

## 4. 实际变更清单

### 4.1 Contracts 层

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/contracts/src/data_cleaner.ts` | 新建 | DataCleanerInput/Output Zod schema、interface key schema、capability schema |
| `packages/contracts/src/plugins.ts` | 修改 | manifest 新增 `load`(priority/after)、`dependencies`(interfaces/plugins)、`provides` schema |
| `packages/contracts/src/index.ts` | 修改 | 导出 data_cleaner 模块 |

### 4.2 Server 插件核心

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/plugins/dependency_resolver.ts` | 新建 | 拓扑排序、接口/硬依赖检查、反向依赖检查、semver 匹配、order.yaml 读取 |
| `apps/server/src/plugins/extensions/data_cleaner_registry.ts` | 新建 | 全局 DataCleaner 注册表 |
| `apps/server/src/plugins/system_pack_init.ts` | 新建 | 系统 pack 插件发现、DB 记录创建、自动 confirm+enable |
| `apps/server/src/plugins/runtime.ts` | 修改 | ServerPluginHostApi 新增 registerDataCleaner；refreshPackPluginRuntime 增加 global scope 查询 + load order 排序 + server entrypoint 动态导入 |
| `apps/server/src/plugins/service.ts` | 修改 | assertPackLocalScope → assertSupportedScope（允许 global scope） |

### 4.3 App 层集成

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/app/services/plugins.ts` | 修改 | enablePackPlugin 增加依赖检查；disablePackPlugin 增加反向依赖警告 |
| `apps/server/src/index.ts` | 修改 | 启动时调用 initSystemPackPlugins |

### 4.4 配置

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/server/src/config/domains/plugins.ts` | 修改 | 新增 dependency.strict 配置（默认 false） |

### 4.5 系统 Pack 文件

| 文件 | 说明 |
|------|------|
| `builtin/system_pack/config.yaml` | yidhras-system pack manifest |
| `builtin/system_pack/README.md` | 说明文档 |
| `builtin/system_pack/plugins/order.yaml` | 加载顺序配置 |
| `builtin/system_pack/plugins/string-methods/plugin.manifest.yaml` | 提供 data_cleaner.string |
| `builtin/system_pack/plugins/string-methods/server.ts` | 7 种清洗模式实现 |
| `builtin/system_pack/plugins/regex-engine/plugin.manifest.yaml` | 提供 data_cleaner.regex |
| `builtin/system_pack/plugins/regex-engine/server.ts` | ReDoS 防护正则实现 |

### 4.6 测试

| 文件 | 操作 | 测试数 |
|------|------|--------|
| `tests/unit/dependency_resolver.spec.ts` | 新建 | 16 tests |
| `tests/unit/data_cleaner_registry.spec.ts` | 新建 | 7 tests |

## 5. 设计 vs 实施偏差

| 项目 | 设计 | 实际实现 | 原因 |
|------|------|----------|------|
| 依赖检查位置 | `service.ts` 的 `enableInstallation()` | app 层 `plugins.ts` 的 `enablePackPlugin()` | 依赖检查需要访问全局 enabled installations + manifests 上下文，app 层更易获取 |
| scope_type | system pack 用 `pack_local` | system pack 用 `global` | `global` 语义更清晰，且 schema 已有此枚举值；`refreshPackPluginRuntime` 已支持合并查询两种 scope |
| 反向依赖 disable 行为 | strict 模式拒绝；默认 warn + 允许 | 同设计 | |
| Prisma 迁移 | PluginInstallation 新增 load_priority/load_after/resolved_deps 列 | 未实施 | 这些数据从 manifest 运行时派生，无需持久化快照；后续如需审计缓存再加 |
| contracts 格式 | 纯 TypeScript interface | Zod schema + 推断类型 | 与 contracts 包现有风格一致 |
| string-methods 模式数 | 5 种 | 7 种 | 额外加了 strip_punctuation 和 collapse_whitespace（collapse_ws 别名） |
| `discovery.ts` 修改 | 需要修改以解析新字段 | 未修改 | manifest 解析使用 YAML.parse + parsePluginManifest，新增字段自动包含在解析结果中 |
| `contracts.ts` 修改 | 需要新增解析函数 | 未修改 | Zod schema 的 parse 已覆盖所有字段 |
| `types.ts` 修改 | PluginStore 类型扩展 | 未修改 | 无需新 CRUD 操作 |

## 6. 测试覆盖

### 6.1 dependency_resolver (16 tests)

- resolveLoadOrder: 空输入、单插件、priority 排序、after 约束、循环检测、pack order 覆盖
- checkDependencies: 无依赖声明、缺失硬依赖、可选硬依赖、缺失接口依赖、接口依赖匹配、版本约束不满足/满足
- checkReverseDependencies: 无依赖者、找到依赖者、忽略可选依赖

### 6.2 data_cleaner_registry (7 tests)

- 注册/检索、未注册 key、列表、执行清洗、缺项报错、去重、清空

### 6.3 预存在失败（非本次引入）

`runtime_config.spec.ts` 中 4 个测试因 YAML 模板文件缺失而失败 — 与本次变更完全无关。

## 7. 后续工作

### 7.1 必须跟进

- [x] **dependency.strict 接入 disable 流程** — 已在 `disablePackPlugin` 中接入，strict 模式拒绝 disable，非严格模式 warn + allow
- [x] **集成测试** — 10 个集成测试覆盖依赖检查 enable/disable/global-scope/load-order 全流程
- [ ] **端到端** — 通过 HTTP API 或 CLI 验证完整的 enable/disable 流程包含依赖检查

### 7.2 后续增强

- [ ] **全局 scope 插件在 web 端的可见性** — 当前 `refreshPackPluginRuntime` 合并了 global + pack_local，但 web runtime snapshot (`plugin_runtime_web.ts`) 可能只查询 pack_local
- [ ] **Prisma 迁移** — 如需持久化 load_priority/load_after/resolved_deps 用于审计
- [ ] **`dependency.strict` 模式** — 完整实现 disable 时反向依赖阻断
- [x] **CLI 中的插件命令** — 已实现 `pnpm plugin [list|confirm|enable|disable]`，离线操作 Prisma + 服务层，含依赖检查

### 7.3 未覆盖的 TODO 项（6 个数据清洗接口）

| # | 接口 | 后续需考虑的差异 |
|---|------|------------------|
| 2 | 结构化语法解析器 | 输出 `AST` 而非 `cleaned` 字符串，需要泛化 `DataCleanerOutput` |
| 3 | 语义提取/验证库 | 输入可能需要 schema 定义，输出是提取的结构化值 |
| 5 | NLP/模糊技术 | 可能需要异步模型加载，输入 token 限制 |
| 6 | 规则引擎/决策流 | 可能不是 "清洗" 语义，而是 "决策"，可能需要独立接口 |
| 7 | ML 辅助清洗 | 模型生命周期管理（加载/卸载/预热） |
| 8 | 向量化字符串 | 输出是 `number[]` 而非字符串，与清洗语义差异最大 |

这些接口落地时，可能需要从 `DataCleaner` 分化出更特化的接口（如 `StructuredParser`、`Embedder`、`RuleEngine`），但当前统一抽象足够覆盖前两个实现。

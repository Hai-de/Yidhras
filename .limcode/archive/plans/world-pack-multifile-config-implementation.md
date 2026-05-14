# 世界包多文件配置拆分 — 实施计划（完成）

> 对应设计文档：`.limcode/design/world-pack-multifile-config-design.md`
>
> 目标：使世界包作者可以将配置按语义节拆分到多个 YAML 文件，加载器在启动时做确定性合并。
> 不保留向后兼容。项目未上线。

---

## 1. 影响面总览

| 模块 | 文件 | 改动类型 |
|------|------|----------|
| Schema | `apps/server/src/packs/schema/constitution_schema.ts` | 新增 `include` 字段定义 |
| Include 解析器 | `apps/server/src/packs/manifest/include_resolver.ts` | **新文件** |
| Constitution Loader | `apps/server/src/packs/manifest/constitution_loader.ts` | 暴露合并入口 |
| Manifest Loader | `apps/server/src/packs/manifest/loader.ts` | 集成 include 解析 |
| Validator CLI | `apps/server/src/cli/validate_pack_cli.ts` | 新增 include 检查项 |
| Scaffold 实现 | `apps/server/src/init/world_pack_project_scaffold.ts` | 支持多文件生成 |
| Scaffold CLI | `apps/server/src/init/scaffold_world_pack.ts` | 新增 `--flat` 标志 |
| 模板目录 | `apps/server/templates/world-pack/` | 新增多文件模板 |
| 测试 | `apps/server/tests/unit/` | 新增 include_resolver 单测 |
| 包迁移 | `data/world_packs/snowbound_mansion/` | 拆分为多文件 |
| 包迁移 | `data/world_packs/world-death-note/` | 拆分为多文件 |

---

## 2. Schema 改动

### 2.1 文件：`apps/server/src/packs/schema/constitution_schema.ts`

在 `worldPackConstitutionSchema` 根对象中新增 `include` 字段：

```typescript
// 新增：include 字段 schema
const includeValueSchema = z.union([
  z.string().min(1),                                          // 简单形式："config/entities.yaml"
  z.object({                                                  // 扩展形式（预留）
    file: z.string().min(1),
    required: z.boolean().optional().default(true)
  }).strict()
]);

const includeSchema = z.record(
  z.string().min(1),   // section key
  includeValueSchema
).optional();
```

根 schema 改动位置：在 `worldPackConstitutionSchema` 对象的 `.object({...})` 调用中，在 `spatial` 之后、`.superRefine(...)` 之前新增一行：

```typescript
include: includeSchema,
```

完整 root object 键序列变为：

```typescript
schema_version  → metadata → constitution → variables → prompts → ai →
time_systems → simulation_time → entities → identities → capabilities →
authorities → rules → storage → scheduler → bootstrap → state_transforms →
spatial → include   // ← 新增
```

**注意**：`include` 字段不入库、不参与物化。它在 schema 校验前由 loader 消费后剥离，schema 的 `superRefine` 不检查它。但 schema 定义它的原因是：入口 YAML 中写 `include:` 应该在 parse 阶段被识别为合法字段而非被 passthrough 丢弃；同时它需要被 Zod 类型推导捕获以便 loader 层使用。

实际剥离时机：loader 调用 `parseWorldPackConstitution` **之前**，从合并后对象中 `delete merged.include`。所以 schema 实际不会见到 `include` 字段。

### 2.2 类型导出

`constitution_schema.ts` 末尾新增导出：

```typescript
export type WorldPackInclude = z.infer<typeof includeSchema>;
```

---

## 3. Include 解析器

### 3.1 新文件：`apps/server/src/packs/manifest/include_resolver.ts`

```typescript
import path from 'path';
import * as YAML from 'yaml';

import { createLogger } from '../../utils/logger.js';
import { safeFs } from '../../utils/safe_fs.js';
import type { WorldPackInclude } from '../schema/constitution_schema.js';

const logger = createLogger('include-resolver');

export interface IncludeResolveResult {
  merged: Record<string, unknown>;
  diagnostics: IncludeDiagnostic[];
}

export interface IncludeDiagnostic {
  severity: 'ERROR' | 'WARN';
  message: string;
  section?: string;
}

const VALID_SECTION_KEYS = new Set([
  'schema_version',
  'metadata',
  'constitution',
  'variables',
  'prompts',
  'ai',
  'time_systems',
  'simulation_time',
  'entities',
  'identities',
  'capabilities',
  'authorities',
  'rules',
  'storage',
  'scheduler',
  'bootstrap',
  'state_transforms',
  'spatial'
]);
```

#### 3.1.1 主函数签名

```typescript
export function resolveIncludes(
  entryYaml: Record<string, unknown>,
  packDir: string
): IncludeResolveResult
```

#### 3.1.2 解析流程（精确步骤）

1. **提取 include 指令**
   ```
   const include = entryYaml.include as WorldPackInclude | undefined
   如果 include === undefined → 直接返回 { merged: entryYaml, diagnostics: [] }
   ```

2. **浅拷贝入口对象**
   ```
   const merged = { ...entryYaml }
   delete merged.include
   ```

3. **遍历 include 条目**
   ```
   for (const [sectionKey, includeValue] of Object.entries(include)):
   ```

   a. **校验 sectionKey 合法性**
      ```
      如果 sectionKey 不在 VALID_SECTION_KEYS 中：
        diagnostics.push({ severity: 'WARN', message: `Unknown section key: "${sectionKey}"`, section: sectionKey })
        继续下一个条目（不阻断）
      ```

   b. **解析文件路径**
      ```
      filePath = typeof includeValue === 'string' ? includeValue : includeValue.file
      absolutePath = path.resolve(packDir, filePath)
      ```

   c. **路径安全检查**
      ```
      尝试 path.relative(packDir, absolutePath)
      如果结果以 '..' 开头 → ERR: "Include file path traversal rejected: {filePath}"
      跳过该条目
      ```

   d. **文件存在性检查**
      ```
      如果 !safeFs.existsSync(packDir, absolutePath) → ERR
      ```

   e. **重复加载检测**
      ```
      维护已加载文件路径 Set。同一文件被多个 section 引用不重复读取、不报错。
      ```

   f. **读取 + YAML 解析**
      ```
      content = safeFs.readFileSync(packDir, absolutePath, 'utf-8')
      parsed = YAML.parse(content)
      如果 parsed 为 null/undefined/非对象 → ERR: "Include file resolved to non-object value"
      ```

   g. **冲突检测**
      ```
      如果 entryYaml 中存在 sectionKey（即入口文件中内联定义了该节）：
        diagnostics.push({ severity: 'WARN',
          message: `Section "${sectionKey}" defined both inline and via include "${filePath}". Include value takes precedence.` })
      ```

   h. **合并**
      ```
      merged[sectionKey] = parsed
      ```

4. **返回**
   ```
   return {
     merged,
     diagnostics
   }
   ```

#### 3.1.3 不支持的特性

- **嵌套 include**：被 include 的文件中如果也包含 `include` 字段，该字段会被当作普通配置内容透传（可能被 schema 的 passthrough 接受或 reject），不会触发递归解析。
- **跨文件引用**：不支持 `$ref`、锚点、别名等跨文件引用机制。
- **细粒度合并**：不支持和 entry file 内联内容做 deep merge。整个 section 要么来自 include，要么来自内联，二选一。

---

## 4. Loader 集成

### 4.1 文件：`apps/server/src/packs/manifest/constitution_loader.ts`

新增导出，从 schema 层透出 include 类型：

```typescript
export type { WorldPackInclude } from '../schema/constitution_schema.js';
```

### 4.2 文件：`apps/server/src/packs/manifest/loader.ts`

`loadPack` 方法改造。改动前的流程：

```
1. 找到入口文件（config.yaml | pack.yaml | ...）
2. 读取 → YAML.parse
3. parseWorldPackConstitution(parsed) → WorldPack
4. 缓存
```

改动后的流程：

```
1. 找到入口文件（config.yaml | pack.yaml | ...）
2. 读取 → YAML.parse → entryYaml
3. resolveIncludes(entryYaml, packDir) → { merged, diagnostics }
4. 如果 diagnostics 中有 ERROR → throw Error（汇总所有 ERROR 消息）
5. WARN → logger.warn
6. parseWorldPackConstitution(merged) → WorldPack
7. 缓存
```

具体代码改动点（`loader.ts` 第 36-48 行）：

```typescript
// 原代码
const content = safeFs.readFileSync(this.packsDir, packPath, 'utf-8');
const parsedYaml = YAML.parse(content) as unknown;
const parsed = parseWorldPackConstitution(parsedYaml, packPath);

// 改为
const content = safeFs.readFileSync(this.packsDir, packPath, 'utf-8');
const entryYaml = YAML.parse(content) as Record<string, unknown>;
if (!entryYaml || typeof entryYaml !== 'object') {
  throw new Error(`[PackManifestLoader] ${folderName}: entry YAML resolved to non-object`);
}

import { resolveIncludes } from './include_resolver.js';
const packDirAbs = path.resolve(this.packsDir, folderName);
const { merged, diagnostics } = resolveIncludes(entryYaml, packDirAbs);

for (const d of diagnostics) {
  if (d.severity === 'ERROR') {
    logger.error(`[include] ${d.section ? `[${d.section}] ` : ''}${d.message}`);
  } else {
    logger.warn(`[include] ${d.section ? `[${d.section}] ` : ''}${d.message}`);
  }
}

const errors = diagnostics.filter(d => d.severity === 'ERROR');
if (errors.length > 0) {
  throw new Error(
    `[PackManifestLoader] ${folderName}: include resolution failed:\n` +
    errors.map(e => `  - ${e.section ? `[${e.section}] ` : ''}${e.message}`).join('\n')
  );
}

const parsed = parseWorldPackConstitution(merged, packPath);
```

### 4.3 入口文件命名优先级

当前 `potentialFiles` 顺序：`['config.yaml', 'config.yml', 'pack.yaml', 'pack.yml']`

**改为**：`['pack.yaml', 'pack.yml', 'config.yaml', 'config.yml']`

`pack.yaml` 作为多文件拆分的推荐入口文件名（更符合 "这个文件是包的索引而非完整配置" 的语义）。如果包目录下同时存在 `pack.yaml` 和 `config.yaml`，优先使用 `pack.yaml`。

---

## 5. Validator CLI 改动

### 5.1 文件：`apps/server/src/cli/validate_pack_cli.ts`

在 `validateConfig` 函数中，`YAML 解析成功` 之后、`Schema 校验` 之前，插入 include 检查步骤：

```typescript
// 新增：include 文件检查
const includeCheckIssues = validateIncludes(parsed, packDir);
issues.push(...includeCheckIssues);
```

新增函数 `validateIncludes`：

```typescript
const validateIncludes = (
  parsed: unknown,
  packDir: string
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return issues;
  }

  const obj = parsed as Record<string, unknown>;
  const include = obj.include as Record<string, unknown> | undefined;
  if (!include || typeof include !== 'object') {
    return issues; // 无 include 指令，正常
  }

  const includeEntries = Object.entries(include);
  issues.push({
    severity: 'PASS',
    message: `include 指令: ${includeEntries.length} 个文件引用`
  });

  const validKeys = new Set([
    'schema_version', 'metadata', 'constitution', 'variables', 'prompts',
    'ai', 'time_systems', 'simulation_time', 'entities', 'identities',
    'capabilities', 'authorities', 'rules', 'storage', 'scheduler',
    'bootstrap', 'state_transforms', 'spatial'
  ]);

  for (const [sectionKey, includeValue] of includeEntries) {
    // 检查 section key 合法性
    if (!validKeys.has(sectionKey)) {
      issues.push({
        severity: 'WARN',
        message: `include: 未知 section key "${sectionKey}"`
      });
    }

    // 提取文件路径
    const filePath = typeof includeValue === 'string'
      ? includeValue
      : (includeValue as Record<string, unknown>)?.file as string | undefined;

    if (!filePath || typeof filePath !== 'string') {
      issues.push({
        severity: 'FAIL',
        message: `include.${sectionKey}: 文件路径无效或缺失`
      });
      continue;
    }

    // 检查文件存在
    const absolutePath = path.resolve(packDir, filePath);
    if (!existsSync(absolutePath)) {
      issues.push({
        severity: 'FAIL',
        message: `include.${sectionKey}: 文件不存在 "${filePath}"`
      });
      continue;
    }

    // 尝试解析
    try {
      const subContent = YAML.parse(readFileSync(absolutePath, 'utf-8'));
      if (subContent === null || subContent === undefined) {
        issues.push({
          severity: 'WARN',
          message: `include.${sectionKey}: "${filePath}" 解析结果为空`
        });
      } else {
        issues.push({
          severity: 'PASS',
          message: `include.${sectionKey}: "${filePath}" 解析成功`
        });
      }
    } catch (error) {
      issues.push({
        severity: 'FAIL',
        message: `include.${sectionKey}: "${filePath}" YAML 解析失败: ${error instanceof Error ? error.message : String(error)}`
      });
    }

    // 检查冲突：entry YAML 中是否也内联定义了该 section
    if (sectionKey in obj && sectionKey !== 'include') {
      issues.push({
        severity: 'WARN',
        message: `include.${sectionKey}: 入口文件内联定义了 "${sectionKey}"，include 值将覆盖`
      });
    }
  }

  return issues;
};
```

---

## 6. Scaffold 改动

### 6.1 新模板文件

在 `apps/server/templates/world-pack/` 下新增以下模板文件（一个 section 一个模板）：

| 模板文件 | 内容 | 对应 section |
|----------|------|-------------|
| `pack.entry.yaml.template` | metadata + include 指令 | 入口文件 |
| `section.variables.yaml.template` | 空变量记录 `{}` | variables |
| `section.prompts.yaml.template` | 空提示词 `{}` | prompts |
| `section.entities.yaml.template` | 五类实体空数组 | entities |
| `section.identities.yaml.template` | 空数组 `[]` | identities |
| `section.capabilities.yaml.template` | 空数组 `[]` | capabilities |
| `section.authorities.yaml.template` | 空数组 `[]` | authorities |
| `section.rules.yaml.template` | 五类规则空数组 | rules |
| `section.bootstrap.yaml.template` | 基础 __world__ initial state | bootstrap |
| `section.ai.yaml.template` | 默认插槽 + 空 tasks | ai |
| `section.time.yaml.template` | 默认时钟 + 零值 simulation_time | time |
| `section.spatial.yaml.template` | 空 spatial 配置 | spatial |
| `section.storage.yaml.template` | 空 storage 配置 | storage |

### 6.2 新入口模板：`pack.entry.yaml.template`

```yaml
metadata:
  id: "{{PACK_ID}}"
  name: "{{PACK_NAME}}"
  version: "{{PACK_VERSION}}"
  description: "{{PACK_DESCRIPTION}}"
  authors:
{{PACK_AUTHORS_YAML}}
  license: "{{PACK_LICENSE}}"
  homepage: "{{PACK_HOMEPAGE}}"
  repository: "{{PACK_REPOSITORY}}"
  tags: {{PACK_TAGS_INLINE_YAML}}
  published_at: "{{PACK_PUBLISHED_AT}}"
  status: "{{PACK_STATUS}}"

include:
  variables: "config/variables.yaml"
  prompts: "config/prompts.yaml"
  time_systems: "config/time.yaml"
  simulation_time: "config/time.yaml"
  entities: "config/entities.yaml"
  identities: "config/identities.yaml"
  capabilities: "config/capabilities.yaml"
  authorities: "config/authorities.yaml"
  rules: "config/rules.yaml"
  bootstrap: "config/bootstrap.yaml"
  ai: "config/ai.yaml"
  spatial: "config/spatial.yaml"
  storage: "config/storage.yaml"
```

注意 `time_systems` 和 `simulation_time` 都指向 `config/time.yaml`。该文件内容结构中同时包含两个 key：

```yaml
# section.time.yaml.template
time_systems:
  - id: "default_clock"
    name: "默认时钟"
    is_primary: true
    tick_rate: 1000
    units:
      - name: "second"
        ratio: 1
      - name: "minute"
        ratio: 60
      - name: "hour"
        ratio: 60
      - name: "day"
        ratio: 24

simulation_time:
  initial_tick: 0
  min_tick: 0
  step_ticks: 1
```

loader 解析时，该文件被读一次，缓存。然后 `merged.time_systems = parsed` 和 `merged.simulation_time = parsed`。但这里有一个问题：`parsed` 是整个文件的内容（包含 `time_systems` 和 `simulation_time` 两个 key）。如果直接赋值 `merged.time_systems = parsed`，那么 `merged.time_systems` 的值会是 `{ time_systems: [...], simulation_time: {...} }`，而 schema 期望 `time_systems` 是一个数组。这会导致校验失败。

**解决方案**：在 `resolveIncludes` 中做智能解包。规则：

- 如果被 include 文件的 YAML 顶层对象的 key 集合是 `{ sectionKey }`（恰好一个 key，且与当前 section 同名），则自动解包：`merged[sectionKey] = parsed[sectionKey]`
- 否则，直接赋值：`merged[sectionKey] = parsed`

这样 `config/time.yaml` 被 include 两次（分别对应 `time_systems` 和 `simulation_time`），每次执行规则 2（文件有多个 key，不自动解包），所以 `merged.time_systems = { time_systems: [...], simulation_time: {...} }`。这不对！

需要更精确的语义。两个选择：

**选择 A**：不允许一个文件对应多个 section。`time.yaml` 拆成 `time_systems.yaml` 和 `simulation_time.yaml`。

```yaml
include:
  time_systems: "config/time_systems.yaml"
  simulation_time: "config/simulation_time.yaml"
```

**选择 B**：在 include 值中支持 `section` 提取器。

```yaml
include:
  time_systems:
    file: "config/time.yaml"
    section: "time_systems"
  simulation_time:
    file: "config/time.yaml"
    section: "simulation_time"
```

选择 A 更简单，选择 B 更灵活。

**决策：采用选择 A。** 一个文件 = 一个 section 的值，不使用共享文件。额外收益：文件内容与 section 一一对应，可读性强，无歧义。

因此，入口模板中：

```yaml
include:
  time_systems: "config/time_systems.yaml"
  simulation_time: "config/simulation_time.yaml"
```

模板文件 `section.time.yaml.template` 拆为两个：`section.time_systems.yaml.template` 和 `section.simulation_time.yaml.template`。

### 6.3 更新 `includeValueSchema`

在 `constitution_schema.ts` 中简化 `includeValueSchema`：

```typescript
const includeValueSchema = z.string().min(1);
// 就是文件路径字符串，不支持扩展对象
```

因为选择 A 消除了对 `section` 提取器的需求。

### 6.4 Scaffold 实现改动：`world_pack_project_scaffold.ts`

新增 `split` 选项（默认 `true`）：

```typescript
export interface WorldPackProjectScaffoldOptions {
  // ... 现有字段
  split?: boolean;  // 默认 true：生成多文件结构。false：生成单文件。
}
```

改动 `scaffoldWorldPackProject` 函数：

- 当 `options.split === false`（或 `--flat` 标志）时：保持现有行为，生成单文件 `config.yaml`
- 当 `options.split !== false`（默认）时：
  1. 用 `pack.entry.yaml.template` 生成 `pack.yaml`
  2. 创建 `config/` 子目录
  3. 对每个 section 模板生成对应的 `config/<section>.yaml`
  4. 不再生成 `config.yaml`

生成的完整文件清单（split 模式）：

```
<pack-dir>/
├─ pack.yaml
├─ README.md
├─ CHANGELOG.md
├─ LICENSE
├─ config/
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
├─ docs/
│  └─ setting.md
├─ assets/
└─ examples/
   └─ overrides.example.yaml
```

### 6.5 Scaffold CLI 改动：`scaffold_world_pack.ts`

新增标志：

```
--flat    生成单文件 config.yaml（不拆分多文件）
```

默认行为变更为多文件拆分。`--flat` 回到旧的单文件行为。

```typescript
case '--flat':
  options.split = false;
  break;
```

---

## 7. 模板文件内容

### 7.1 `pack.entry.yaml.template`

```yaml
schema_version: 1

metadata:
  id: "{{PACK_ID}}"
  name: "{{PACK_NAME}}"
  version: "{{PACK_VERSION}}"
  description: "{{PACK_DESCRIPTION}}"
  authors:
{{PACK_AUTHORS_YAML}}
  license: "{{PACK_LICENSE}}"
  homepage: "{{PACK_HOMEPAGE}}"
  repository: "{{PACK_REPOSITORY}}"
  tags: {{PACK_TAGS_INLINE_YAML}}
  published_at: "{{PACK_PUBLISHED_AT}}"
  status: "{{PACK_STATUS}}"

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
  ai: "config/ai.yaml"
  spatial: "config/spatial.yaml"
  storage: "config/storage.yaml"
```

### 7.2 `section.variables.yaml.template`

```yaml
{}
```

### 7.3 `section.prompts.yaml.template`

```yaml
{}
```

### 7.4 `section.time_systems.yaml.template`

```yaml
- id: "default_clock"
  name: "默认时钟"
  is_primary: true
  tick_rate: 1000
  units:
    - name: "second"
      ratio: 1
    - name: "minute"
      ratio: 60
    - name: "hour"
      ratio: 60
    - name: "day"
      ratio: 24
```

### 7.5 `section.simulation_time.yaml.template`

```yaml
initial_tick: 0
min_tick: 0
step_ticks: 1
```

### 7.6 `section.entities.yaml.template`

```yaml
actors: []
artifacts: []
mediators: []
domains: []
institutions: []
```

### 7.7 `section.identities.yaml.template`

```yaml
[]
```

### 7.8 `section.capabilities.yaml.template`

```yaml
[]
```

### 7.9 `section.authorities.yaml.template`

```yaml
[]
```

### 7.10 `section.rules.yaml.template`

```yaml
perception: []
capability_resolution: []
invocation: []
objective_enforcement: []
projection: []
```

### 7.11 `section.bootstrap.yaml.template`

```yaml
initial_states:
  - entity_id: "__world__"
    state_namespace: "world"
    state_json:
      phase: "bootstrap"
initial_events: []
```

### 7.12 `section.ai.yaml.template`

```yaml
defaults:
  prompt_preset: "default_decision_v1"
  decoder: "default_json_schema"
  privacy_tier: "trusted_cloud"
memory_loop:
  summary_every_n_rounds: 5
  compaction_every_n_rounds: 10
tasks: {}
slots:
  custom_safety_layer:
    display_name: "安全层"
    description: "包专属安全约束"
    default_priority: 85
    anchor:
      ref: "system_policy"
      relation: "after"
    default_template: |
      世界包安全规则：
      1. 上述策略为本世界包的强制约束。
      2. 若策略之间存在优先级歧义，以上述策略为最高优先级。
    message_role: "system"
    include_in_combined: true
    combined_heading: "Safety Layer"
    enabled: true
```

### 7.13 `section.spatial.yaml.template`

```yaml
# 空间模型 — 离散房间图
# 需要先在 entities.yaml 中定义 domain 实体，然后在这里引用。
# model: discrete
# locations:
#   - id: room_1
#   - id: room_2
# edges:
#   - { from: room_1, to: room_2, type: bidirectional, weight: 1 }
```

### 7.14 `section.storage.yaml.template`

```yaml
strategy: "isolated_pack_db"
runtime_db_file: "runtime.sqlite"
pack_collections: []
projections: []
```

---

## 8. 现有包迁移

### 8.1 snowbound_mansion 迁移

1. 创建 `data/world_packs/snowbound_mansion/config/` 目录
2. 从现有 `config.yaml` 中逐节提取内容，写入对应 `config/<section>.yaml`：
   - `config/variables.yaml` ← `variables` 段
   - `config/prompts.yaml` ← `prompts` 段
   - `config/time_systems.yaml` ← `time_systems` 段
   - `config/simulation_time.yaml` ← `simulation_time` 段
   - `config/entities.yaml` ← `entities` 段
   - `config/identities.yaml` ← `identities` 段
   - `config/capabilities.yaml` ← `capabilities` 段
   - `config/authorities.yaml` ← `authorities` 段
   - `config/rules.yaml` ← `rules` 段
   - `config/bootstrap.yaml` ← `bootstrap` 段
   - `config/spatial.yaml` ← `spatial` 段
   - `config/ai.yaml` ← `ai` 段
3. 将 `config.yaml` 重写为入口文件（仅 metadata + include）
4. 运行 `pnpm validate:pack snowbound_mansion` 确认通过
5. 运行 `pnpm test:unit` 确认相关单测通过

### 8.2 world-death-note 迁移

同理，逐节拆分到 `config/` 子目录。

---

## 9. 测试计划

### 9.1 新文件：`apps/server/tests/unit/include_resolver.spec.ts`

测试用例：

```
describe('resolveIncludes')
  describe('无 include 指令')
    it('入口文件无 include 字段时直接返回原对象')
    it('include 为 null 时直接返回原对象')
    it('include 为空对象时直接返回原对象')

  describe('基本解析')
    it('单个 include 文件被正确读取和合并')
    it('多个 include 文件被正确读取和合并')
    it('include 文件路径相对于 pack 目录解析')

  describe('section key 校验')
    it('未知 section key 产生 WARN 不阻断')
    it('合法 section key 正常解析')

  describe('错误处理')
    it('include 文件不存在 → ERROR')
    it('include 文件 YAML 解析失败 → ERROR')
    it('include 文件路径遍历攻击被拒绝 → ERROR')
    it('include 文件解析为 null → ERROR')
    it('include 文件解析为数组 → ERROR')

  describe('冲突处理')
    it('section 同时在入口文件和 include 中定义 → WARN，include 优先')
    it('同一文件被多个 section 引用不重复读取')

  describe('合并正确性')
    it('include 不影响入口文件中的其他 section')
    it('metadata 不参与 include 合并（始终来自入口文件）')
    it('合并后对象中不存在 include 字段')

  describe('template_context 智能解包')
    it('文件恰好只有一个 key 且与 section 同名，自动解包')
    it('文件有多个 key，不解包直接赋值')
```

### 9.2 更新现有测试

`apps/server/tests/unit/pack_snowbound_mansion_load.spec.ts` — 确认多文件拆分后 pack 加载仍然通过。

`apps/server/tests/unit/perception_resolver.spec.ts` — 确认不受影响。

---

## 10. 实施顺序

| 步骤 | 文件 | 依赖 |
|------|------|------|
| 1 | `constitution_schema.ts` — 新增 `include` schema | 无 |
| 2 | `include_resolver.ts` — 新建解析器 | 步骤 1 |
| 3 | `constitution_loader.ts` — 透出类型 | 步骤 1 |
| 4 | `loader.ts` — 集成 include 解析 | 步骤 2,3 |
| 5 | `include_resolver.spec.ts` — 单测 | 步骤 2 |
| 6 | `validate_pack_cli.ts` — 新增检查项 | 步骤 2 |
| 7 | 模板文件 — 创建 14 个新模板 | 无 |
| 8 | `world_pack_project_scaffold.ts` — 支持 split 模式 | 步骤 7 |
| 9 | `scaffold_world_pack.ts` — 新增 `--flat` 标志 | 步骤 8 |
| 10 | snowbound_mansion 迁移 | 步骤 4 |
| 11 | world-death-note 迁移 | 步骤 4 |
| 12 | 全量测试 (`pnpm test && pnpm typecheck && pnpm lint`) | 所有步骤 |

步骤 1-4 串行（有依赖），步骤 5-6 可与 7-9 并行。

---

## 11. 风险与约束

1. **YAML 库限制**：`yaml` npm 包不支持自定义 tag（如 `!include`）。当前方案采用 loader 层文件合并，不碰 YAML 解析器扩展。
2. **路径安全**：include 路径必须是 pack 目录下的相对路径，不允许 `..` 穿越。`safe_fs` 已有路径遍历防护，include 解析器额外做一次 `path.relative` 检查。
3. **大型文件重读**：同一 pack 启动时只加载一次，结果缓存。热加载场景需要单独考虑（不在本计划范围内）。
4. **循环引用**：不支持嵌套 include，因此不存在循环引用问题。
5. **跨 section 引用一致性**：schema 层跨字段校验（如 identity 引用 entity、spatial 引用 domain）在合并后的对象上执行，不受拆分影响。

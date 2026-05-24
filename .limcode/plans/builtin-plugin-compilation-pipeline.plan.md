<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/eslint-bypass-analysis.md","contentHash":"sha256:d6cf06535dffe73de431d8cb72044cff1bc56c0f4c151cd72fb72caf1a660fd4"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 确认 builtin ESLint 采用非类型感知覆盖，并记录取舍  `#confirm-eslint-strategy`
- [ ] 在 apps/server/package.json 直接声明 esbuild devDependency  `#declare-esbuild`
- [ ] 修复 regex-engine、template-engine、slot-condition-builtin 的已知类型安全/行为问题  `#fix-plugin-source-issues`
- [ ] 加固 build.mjs 的插件发现、order/manifest/source 校验和错误输出  `#harden-build-script`
- [ ] 新增 typecheck.mjs 或等价机制，避免 typecheck:plugins 盲扫所有子目录  `#harden-plugin-typecheck`
- [ ] 补充 runtime smoke，验证四个 builtin 插件 import/activate/register/basic call  `#runtime-smoke`
- [ ] 同步计划状态与当前实现，修正过时描述  `#sync-plan-status`
- [ ] 补齐 plugins/.gitignore 的 dist/js/map/d.ts 忽略规则  `#update-plugin-gitignore`
- [ ] 验证并确定 @yidhras/contracts external 策略  `#verify-contracts-external`
- [ ] 验证 dev watch 或实现 build.mjs --watch / dev supervisor  `#verify-dev-watch`
- [ ] 在 CI 中加入 server typecheck/build 或插件专项 typecheck/build  `#wire-ci`
- [ ] 将 server build/typecheck 串联 typecheck:plugins 和 build:plugins  `#wire-package-scripts`
<!-- LIMCODE_TODO_LIST_END -->

# builtin/ 插件独立编译流水线计划（方案 C，修订版）

**日期**: 2026-05-24  
**关联分析**: `.limcode/design/eslint-bypass-analysis.md` #1, #2  
**主计划**: `.limcode/plans/eslint-coverage-and-enforcement.plan.md` 阶段 2  
**当前状态**: 已部分实施；本计划现在以“补齐、加固、验证”为主。

---

## 目标

为 `apps/server/builtin/system_pack/plugins/` 下每个 builtin 插件建立独立的 TypeScript 类型检查与 esbuild 编译流水线，使其满足：

1. 插件源码纳入 ESLint 覆盖。
2. 插件源码纳入独立 `tsc --noEmit` 类型检查。
3. 插件运行入口统一为 `dist/server.js`，dev 和 production 行为一致。
4. production `build` 必须先通过插件类型检查，再生成插件 bundle。
5. CI 必须覆盖插件 lint/typecheck/build，防止 builtin 插件再次绕过质量门禁。
6. 构建脚本必须只处理有效插件目录，并对 manifest/source/build artifact 做一致性校验。
7. 插件 runtime smoke 必须验证 `dist/server.js` 能被实际导入并注册。

---

## 当前代码状态核对

以下内容已在当前代码中落地：

- `apps/server/builtin/system_pack/plugins/build.mjs` 已存在。
- `apps/server/builtin/system_pack/plugins/tsconfig.base.json` 已存在。
- 四个插件目录均已有 `tsconfig.json`：
  - `regex-engine/tsconfig.json`
  - `slot-condition-builtin/tsconfig.json`
  - `string-methods/tsconfig.json`
  - `template-engine/tsconfig.json`
- 四个 manifest 已指向 `dist/server.js`：
  - `string-methods/plugin.manifest.yaml`
  - `regex-engine/plugin.manifest.yaml`
  - `template-engine/plugin.manifest.yaml`
  - `slot-condition-builtin/plugin.manifest.yaml`
- `apps/server/package.json` 已包含：
  - `build:plugins`
  - `typecheck:plugins`
  - `dev:plugins`
  - `lint` 覆盖 `builtin/**/*.ts`
  - `build` 串联 `build:plugins`
- `apps/server/eslint.config.mjs` 已包含 `files: ['builtin/**/*.ts']` 的 builtin 插件 ESLint 配置。
- 根 `package.json` 的 `lint-staged` 已覆盖 `apps/server/builtin/**/*.ts`。

仍需补齐或修正：

- `apps/server/package.json` 没有直接声明 `esbuild`，但 `build.mjs` 直接 `import * as esbuild from 'esbuild'`。
- `build` 只执行 `tsc && build:plugins`，未执行 `typecheck:plugins`。
- server `typecheck` 只执行 `tsc --noEmit`，未执行 `typecheck:plugins`。
- `typecheck:plugins` 使用 shell glob 遍历所有子目录，未过滤有效插件目录。
- `build.mjs` 直接扫描所有子目录，未检查 `plugin.manifest.yaml` / `server.ts` / `order.yaml`。
- `dev:plugins` 使用 `tsx watch build.mjs`，不能从当前代码直接保证会监听所有插件 `server.ts` 修改。
- CI workflow 当前只执行 server lint、Rust 检查、测试、smoke，未显式执行插件 typecheck/build。
- ESLint builtin 配置当前 `projectService: false`，和“ESLint 类型感知检查”目标不同；需要明确取舍。
- `template-engine/server.ts` 当前缺少分号，且 catch 中吞掉模板渲染错误，计划原先要求记录失败原因但代码尚未落实。
- `regex-engine/server.ts` 中 `allow_nested_quantifiers` 逻辑当前在 ReDoS 检查之后，实际无法允许嵌套量词通过。
- `slot-condition-builtin/server.ts` 仍存在 `as ConditionParam` 和 evaluator 函数类型断言，未完成 Zod/运行时 schema 校验方案。

---

## 插件现状

```text
apps/server/builtin/system_pack/plugins/
  order.yaml
  build.mjs
  tsconfig.base.json
  .gitignore
  string-methods/
    plugin.manifest.yaml       # source: "dist/server.js"
    tsconfig.json
    server.ts                  # 仅导入类型
  regex-engine/
    plugin.manifest.yaml       # source: "dist/server.js"
    tsconfig.json
    server.ts                  # 仅导入类型
  template-engine/
    plugin.manifest.yaml       # source: "dist/server.js"
    tsconfig.json
    server.ts                  # 导入 render() 运行时值
  slot-condition-builtin/
    plugin.manifest.yaml       # source: "dist/server.js"
    tsconfig.json
    server.ts                  # 导入四个 evaluator 运行时值
```

关键事实：

- 主服务 `tsconfig.json` 的 `include` 仅为 `src/**/*`，不覆盖 builtin 插件源码。
- builtin 插件现在通过单独的插件级 `tsconfig.json` 做类型检查。
- `template-engine` 和 `slot-condition-builtin` 从 `src/` 导入运行时值；生产环境不能依赖 `src/**/*.js` 存在。
- 因此插件运行产物必须由 esbuild bundle 生成，而不能依赖 tsc 普通 emit。
- `@yidhras/contracts` 是 workspace 包，当前 `packages/contracts/package.json` exports 指向 `./src/index.ts`。如果插件 bundle 将其 external 掉，production 运行时是否能解析 TS 源入口必须单独验证。

---

## 最终设计

### 编译策略

统一采用：

1. `tsc -p <plugin>/tsconfig.json --noEmit` 做检查。
2. `esbuild` 将 `<plugin>/server.ts` bundle 到 `<plugin>/dist/server.js`。
3. manifest 固定指向 `dist/server.js`。
4. 主服务 dev 和 production 都只加载 `dist/server.js`。

不使用 tsc emit 作为插件运行产物，原因：

- tsc 在 `rootDir` 限制下无法自然处理插件跨目录导入 `src/` 运行时值。
- 去掉 `rootDir` 会把 `src/` 传递依赖纳入 emit 路径，产出目录结构不可控。
- esbuild bundle 能把 `src/` 运行时值打入插件产物，避免 production 下 `src/**/*.js` 不存在的问题。

### TypeScript 配置

`apps/server/builtin/system_pack/plugins/tsconfig.base.json` 保持类型检查用途：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

每个插件：

```json
{
  "extends": "../tsconfig.base.json",
  "include": ["server.ts"]
}
```

约束：

- 插件 `tsconfig.json` 不设置 `rootDir`。
- 插件 `tsconfig.json` 不负责 emit。
- 类型检查和 bundle 是两个独立步骤。

### esbuild 依赖声明

`apps/server/builtin/system_pack/plugins/build.mjs` 直接 import `esbuild`，所以 `apps/server/package.json` 必须直接声明：

```json
"devDependencies": {
  "esbuild": "<固定或兼容版本>"
}
```

不能依赖 `tsx`、`vitest` 的传递依赖。pnpm 不保证未声明的 transitive dependency 可被业务包直接 import。

### esbuild external 策略

当前计划中的 external：

```js
external: ['node:*', '@yidhras/contracts']
```

需要复核：

- `node:*` 保持 external 合理。
- `@yidhras/contracts` 是否 external 需要 runtime smoke 验证。

风险点：

- `packages/contracts/package.json` 当前 exports 的 default/types 都指向 `./src/index.ts`。
- production 执行 `node dist/index.js` 时，Node 原生 ESM 不会直接执行 TS 源文件。
- 如果插件 bundle 中保留 `import '@yidhras/contracts'`，运行时可能无法解析或执行该 TS entry。

处理策略：

1. 优先运行 smoke 验证当前 external 策略。
2. 如果失败，改为将 `@yidhras/contracts` 也 bundle 进插件产物，或先为 `packages/contracts` 建立正式 build 输出并调整 exports。
3. 不能在未验证的情况下假定 `@yidhras/contracts` external 在 production 可用。

### sourcemap 策略

需要明确选择：

- 如果需要生产错误定位到 `server.ts`，`build.mjs` 应启用：

```js
sourcemap: true
```

- 如果不启用 sourcemap，则计划必须接受：插件运行时错误堆栈主要指向 `dist/server.js`。

建议：启用 `sourcemap: true`，并在 `.gitignore` 忽略 `**/*.js.map`。

---

## 构建脚本加固设计

当前 `build.mjs` 扫描所有子目录并尝试构建 `server.ts`。需要改为只处理有效插件目录。

有效插件目录判定：

1. 位于 `apps/server/builtin/system_pack/plugins/<plugin-id>/`。
2. 目录下存在 `plugin.manifest.yaml`。
3. 目录下存在 `server.ts`。
4. 目录名存在于 `order.yaml` 的 `order` 列表中。
5. manifest 的 `id` 与目录名一致。
6. manifest 的 `entrypoints.server.source` 为 `dist/server.js`。

构建顺序：

- 按 `order.yaml` 顺序构建。
- 如果 `order.yaml` 引用了不存在的插件目录，应失败。
- 如果存在未列入 `order.yaml` 但含 manifest 的插件目录，应失败或至少警告；本计划建议失败，避免新插件绕过顺序治理。

构建输出要求：

- 每个插件输出构建开始和成功信息：`Building <plugin-id> -> <plugin-dir>/dist/server.js`。
- 失败时错误信息必须包含插件 id 和目录。
- 构建结束后校验每个插件 `dist/server.js` 存在。

建议 `build.mjs` 增加以下能力：

- 读取并解析 `order.yaml`。
- 读取并解析每个 `plugin.manifest.yaml`。
- 校验 manifest/source/order/server.ts 一致性。
- 对每个插件调用 esbuild。
- 可选支持 `--watch`，替代依赖 `tsx watch build.mjs` 的隐式行为。

---

## typecheck 脚本加固设计

当前：

```json
"typecheck:plugins": "bash -c 'for dir in builtin/system_pack/plugins/*/; do echo \"Checking $dir...\" && tsc -p \"$dir/tsconfig.json\" --noEmit || exit 1; done'"
```

问题：

- 遍历所有子目录，未区分有效插件目录和辅助目录。
- 依赖 Bash；当前 Linux 环境可用，但项目存在 `start-dev.bat`，说明跨平台使用不是完全无关。
- 错误信息只包含目录，不校验 manifest/order/source。

修正方案：

- 新增 `builtin/system_pack/plugins/typecheck.mjs`，复用和 `build.mjs` 相同的插件发现/校验逻辑。
- 对每个有效插件运行：

```bash
tsc -p <plugin-dir>/tsconfig.json --noEmit
```

- `apps/server/package.json` 改为：

```json
"typecheck:plugins": "node builtin/system_pack/plugins/typecheck.mjs"
```

如果不新增 `typecheck.mjs`，最低限度也要过滤 `tsconfig.json`：

```bash
for dir in builtin/system_pack/plugins/*/; do
  [ -f "$dir/plugin.manifest.yaml" ] || continue
  [ -f "$dir/server.ts" ] || continue
  [ -f "$dir/tsconfig.json" ] || exit 1
  echo "Checking $dir..."
  tsc -p "$dir/tsconfig.json" --noEmit || exit 1
done
```

推荐新增 Node 脚本，避免 shell 兼容性和重复插件发现逻辑。

---

## package scripts 目标状态

`apps/server/package.json` 应调整为：

```json
{
  "scripts": {
    "build": "tsc && pnpm run typecheck:plugins && pnpm run build:plugins",
    "build:plugins": "node builtin/system_pack/plugins/build.mjs",
    "typecheck": "tsc --noEmit && pnpm run typecheck:plugins",
    "typecheck:plugins": "node builtin/system_pack/plugins/typecheck.mjs",
    "dev:plugins": "node builtin/system_pack/plugins/build.mjs --watch",
    "dev": "pnpm run dev:plugins & tsx watch src/index.ts"
  },
  "devDependencies": {
    "esbuild": "<version>"
  }
}
```

注意：`dev` 中的 `&` 仍是脆弱方案，见 dev watch 章节。若不实现 `build.mjs --watch`，则必须先验证 `tsx watch build.mjs` 是否实际监听插件源码。

根 `package.json` 不需要直接知道插件细节，只要 server 包的 `typecheck` 和 `build` 串好即可：

```json
"typecheck": "pnpm --filter yidhras-server typecheck && pnpm --filter web typecheck",
"build": "pnpm --filter yidhras-server build && pnpm --filter web build"
```

---

## dev watch 策略

当前：

```json
"dev": "pnpm run dev:plugins & tsx watch src/index.ts",
"dev:plugins": "tsx watch --clear-screen=false builtin/system_pack/plugins/build.mjs"
```

不能从当前 `build.mjs` 代码直接推导出 `tsx watch` 一定会监听每个插件的 `server.ts`。`build.mjs` 只是通过 `readdirSync` 发现目录，未静态导入插件源码。

必须补充验证：

1. 启动 `pnpm --filter yidhras-server dev:plugins`。
2. 修改任一插件 `server.ts`。
3. 确认 `dist/server.js` 时间戳更新。
4. 确认错误修改会让 watcher 输出构建失败。
5. 确认修复后 watcher 可恢复成功构建。

推荐实现：

- `build.mjs --watch` 使用 esbuild context/watch API 显式 watch 每个插件 entry。
- 不再依赖 `tsx watch build.mjs` 的隐式文件追踪。

`dev` 并发风险：

```json
"dev": "pnpm run dev:plugins & tsx watch src/index.ts"
```

存在：

- `dev:plugins` 失败时主服务仍可能继续运行。
- 主服务退出时后台插件 watcher 可能残留。
- Bash `&` 不是跨平台进程管理方案。

可选方案：

1. 接受 POSIX-only 临时方案，并在文档中写明限制。
2. 新增 Node dev supervisor 脚本，启动并管理插件 watcher 与主服务 watcher，任一进程退出则清理另一个。
3. 引入并发管理依赖，但这会增加依赖面。
4. 要求开发者手动开两个终端，避免伪并发脚本。

本计划建议后续实现 Node dev supervisor；在本阶段最低限度需记录 `&` 的失败传播和清理缺陷。

---

## ESLint 覆盖策略

当前 builtin ESLint 配置为：

```js
{
  files: ['builtin/**/*.ts'],
  languageOptions: {
    parserOptions: {
      projectService: false,
      tsconfigRootDir: import.meta.dirname
    }
  },
  rules: {
    'prefer-const': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-prototype-builtins': 'error',
    'no-path-concat': 'error',
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { "argsIgnorePattern": "^_" }]
  }
}
```

这意味着：

- ESLint 对 builtin 插件提供语法级、安全规则、import sort、unused vars 等覆盖。
- 类型感知规则不在 builtin ESLint 中执行。
- 类型正确性由 `typecheck:plugins` 负责。

需要明确取舍：

### 方案 A：保持 `projectService: false`

优点：

- 配置简单。
- 不需要让 ESLint project service 识别多个插件级 tsconfig。
- 和当前代码一致。

缺点：

- 无法在 builtin 插件上执行类型感知 ESLint 规则。
- `@typescript-eslint/no-unsafe-*` 等规则不能覆盖插件。

### 方案 B：启用 builtin 类型感知 ESLint

需要处理：

- 每个插件有独立 `tsconfig.json`。
- ESLint 需要能定位这些 project。
- 需要验证 `projectService: true` 是否能正确包含 `builtin/**/*.ts`。
- 如果不能，需要考虑 `parserOptions.project` 指定插件 tsconfig glob，但 typescript-eslint flat config 对多 project 的性能和兼容性要验证。

本计划建议当前阶段采用方案 A：ESLint 做非类型感知覆盖，类型检查交给 `typecheck:plugins`。如果后续主计划要求 `no-unsafe-*` 覆盖 builtin，再单独做 ESLint 类型感知升级。

另外，builtin 的 `no-restricted-syntax` 当前只检查 `ImportDeclaration`，主 `src` 配置还检查：

- `ExportNamedDeclaration`
- `ExportAllDeclaration`

如果 builtin 插件后续出现 re-export，也应补齐 export 检查。

---

## 插件源码待修复项

### `string-methods/server.ts`

当前状态：

- 已使用 `import type`。
- 已用 `typeof options?.mode === 'string'` 替代直接类型断言。

仍需验证：

- `pnpm --filter yidhras-server typecheck:plugins`
- `pnpm --filter yidhras-server lint`
- `pnpm --filter yidhras-server build:plugins`

### `regex-engine/server.ts`

当前问题：

```ts
if (/\([^)]*\*[^)]*\)[\s]*[*+{]/.test(pattern) || /\([^)]*\+[^)]*\)[\s]*[*+{]/.test(pattern)) {
  throw new Error(...);
}

const allowNestedQuantifiers = options?.allow_nested_quantifiers === true;
if (allowNestedQuantifiers) {
  // Override the nested quantifier block — caller accepts the risk
}
```

`allowNestedQuantifiers` 在 throw 之后计算，因此无法实际 override。需要改为：

1. 先读取 `allowNestedQuantifiers`。
2. 如果检测到嵌套量词且 `allowNestedQuantifiers !== true`，才 throw。
3. 如果允许，则继续依赖 timeout 和 match count 限制。

还需要：

- 读取 `max_match_count`，当前代码错误信息提到 `max_match_count`，但实际使用常量 `DEFAULT_MAX_MATCH_COUNT`。
- 校验 `timeout_ms`、`max_pattern_length`、`max_match_count` 为正数，避免负数/NaN/Infinity。
- 捕获 `new RegExp(pattern, flags)` 的错误时是否要包装为插件错误，需要明确。

### `template-engine/server.ts`

当前问题：

- 文件缺少分号，可能触发格式/风格规则或与现有代码风格不一致。
- `catch { rendered = text }` 吞掉渲染错误，没有记录失败原因。
- 计划原先要求 `runtimeLogger.warn(...)`，但当前插件没有 logger 注入来源。

需要先确认插件 host API 是否提供 logger。如果没有，不能凭空使用 `runtimeLogger`。

可选处理：

1. 如果 `ServerPluginHostApi` 有 logger：通过 host 注入或闭包保存 logger 后在 catch 中 warn。
2. 如果没有 logger：在 metadata 中记录 `render_error: true`，但这会改变输出 metadata 行为。
3. 保持 fallback 静默，但在计划中明确这是有意行为。

不能继续写“增加 `runtimeLogger.warn`”而不确认 API 存在。

### `slot-condition-builtin/server.ts`

当前问题：

```ts
return fn(options as ConditionParam, context);
```

以及 evaluator 调用处仍有函数签名断言：

```ts
evaluateKeywordMatch as (c: { type: string; [key: string]: unknown }, ctx: SlotConditionContext) => SlotConditionResult
```

计划目标是消除不安全断言，需要补齐运行时 schema：

- `keyword_match` options schema
- `logic_match` options schema
- `conversation_turn` options schema
- `context_length` options schema

如果 evaluator 已有内部校验，可以复用其公开类型/guard；如果没有，需要在插件层用 Zod 或手写 guard 校验。

注意：`zod` 已是 `apps/server` dependency，可用于 runtime schema。

---

## manifest 与路径解析

当前 manifest 已统一：

```yaml
entrypoints:
  server:
    source: "dist/server.js"
    runtime: "node_esm"
```

路径拼接逻辑无需改动，前提是：

- `system_pack_init.ts` 将 `source_path` 设置为插件目录绝对路径。
- runtime 使用 `path.join(artifact.source_path, serverEntrypoint.source)`。

需要执行验证，而不是修改 runtime：

1. manifest source 为 `dist/server.js`。
2. 构建后文件存在于 `<pluginDir>/dist/server.js`。
3. runtime import 路径解析为 `<pluginDir>/dist/server.js`。
4. dev 和 production 使用同一入口。

原计划“移除 `system_pack_init.ts` 中的 `resolveWorkspacePath` 依赖”标题不准确。正确步骤是：

```md
验证 system pack manifest source 到 dist/server.js 的路径拼接，无需修改 system_pack_init.ts 或 runtime.ts。
```

---

## `.gitignore` 规则

`apps/server/builtin/system_pack/plugins/.gitignore` 应明确忽略构建产物：

```gitignore
**/dist/
**/*.js
**/*.js.map
**/*.d.ts
```

注意：

- 这会忽略插件目录下所有 JS 文件。
- 如果未来需要手写 JS 辅助脚本，不应放在该目录层级，或需要改 ignore 规则。
- 当前插件源统一为 TypeScript，因此可以接受。

---

## CI 接入

当前 `.github/workflows/server-tests.yml`：

- 执行 `pnpm --filter yidhras-server lint`
- 执行 Rust check
- 执行 server unit/integration tests
- 未显式执行 `typecheck`
- 未显式执行 `typecheck:plugins`
- 未显式执行 `build:plugins`

当前 `.github/workflows/server-smoke.yml`：

- 执行 lint
- 执行 Rust build
- 执行 `prepare:runtime`
- 执行 smoke/e2e/CLI smoke
- 未显式执行插件 typecheck/build

需要补充 CI 步骤，至少在 `server-tests.yml` 增加：

```yaml
- name: Typecheck server and builtin plugins
  run: pnpm --filter yidhras-server typecheck

- name: Build builtin plugins
  run: pnpm --filter yidhras-server build:plugins
```

如果 server `build` 已串联 `typecheck:plugins` 和 `build:plugins`，也可以直接：

```yaml
- name: Build server
  run: pnpm --filter yidhras-server build
```

需要注意：server `build` 当前只构建 TypeScript 和插件，不构建 Rust；Rust 已有独立步骤。

CI 最低要求：

- PR 修改 `apps/server/builtin/**` 时，必须触发 workflow。
- workflow 必须失败于：
  - 插件 TS 类型错误
  - 插件 bundle 失败
  - manifest source 不一致
  - 缺失 `dist/server.js` 构建产物

---

## runtime smoke 验证

必须增加或执行现有 smoke，覆盖插件实际加载：

1. 删除所有插件构建产物：

```bash
find apps/server/builtin/system_pack/plugins -path '*/dist' -type d -prune -exec rm -rf {} +
```

2. 执行：

```bash
pnpm --filter yidhras-server build
```

3. 确认四个产物存在：

```text
apps/server/builtin/system_pack/plugins/string-methods/dist/server.js
apps/server/builtin/system_pack/plugins/regex-engine/dist/server.js
apps/server/builtin/system_pack/plugins/template-engine/dist/server.js
apps/server/builtin/system_pack/plugins/slot-condition-builtin/dist/server.js
```

4. 执行 runtime smoke：

```bash
pnpm --filter yidhras-server smoke
```

5. 如果现有 smoke 没有断言 builtin 插件注册成功，需要补充测试断言：

- `data_cleaner.string` 可注册并调用。
- `data_cleaner.regex` 可注册并调用。
- `data_cleaner.template` 可注册并调用。
- 四个 slot condition evaluator 可注册并调用。

仅验证文件存在不够，必须验证 runtime import + activate + registry registration。

---

## 执行步骤

### 步骤 1：同步计划状态与当前实现

- 标记已完成文件和已落地脚本。
- 删除或修正已经过时的 `server.js` manifest 描述。
- 修正“步骤 9 移除 resolveWorkspacePath 依赖”的标题。

### 步骤 2：直接声明 `esbuild` 依赖

在 `apps/server/package.json` 的 `devDependencies` 中加入 `esbuild`。

验证：

```bash
pnpm --filter yidhras-server exec node -e "import('esbuild').then(() => console.log('ok'))"
```

### 步骤 3：加固插件发现与 manifest 校验

更新 `build.mjs`：

- 解析 `order.yaml`。
- 只构建 `order.yaml` 中列出的插件。
- 校验目录存在。
- 校验 `plugin.manifest.yaml` 存在。
- 校验 manifest id 等于目录名。
- 校验 `entrypoints.server.source === 'dist/server.js'`。
- 校验 `server.ts` 存在。
- 构建后校验 `dist/server.js` 存在。
- 失败时输出插件 id。

### 步骤 4：新增或加固 `typecheck:plugins`

推荐新增：

```text
apps/server/builtin/system_pack/plugins/typecheck.mjs
```

复用步骤 3 的插件发现逻辑，对每个插件执行 `tsc -p <plugin>/tsconfig.json --noEmit`。

避免 shell glob 扫描所有目录。

### 步骤 5：串联 package scripts

更新 `apps/server/package.json`：

```json
"build": "tsc && pnpm run typecheck:plugins && pnpm run build:plugins",
"typecheck": "tsc --noEmit && pnpm run typecheck:plugins",
"typecheck:plugins": "node builtin/system_pack/plugins/typecheck.mjs"
```

如果实现 `build.mjs --watch`：

```json
"dev:plugins": "node builtin/system_pack/plugins/build.mjs --watch"
```

否则保留现有 `tsx watch` 前必须完成 watch 验证。

### 步骤 6：明确并处理 `@yidhras/contracts` external 策略

执行 production-like 验证：

```bash
pnpm --filter yidhras-server build
pnpm --filter yidhras-server start
```

或通过 smoke 测试触发插件 import。

如果 external 失败，二选一：

1. 从 esbuild external 中移除 `@yidhras/contracts`，让其 bundle 进插件产物。
2. 为 `packages/contracts` 建立 build 输出并修正 package exports。

不得在未验证的情况下保留不可运行的 external 配置。

### 步骤 7：修复插件源码问题

按“插件源码待修复项”修复：

- `regex-engine` 的 `allow_nested_quantifiers` 顺序错误。
- `regex-engine` 的 max/timeout 数值校验和 `max_match_count` 选项。
- `template-engine` 的 catch 处理策略。
- `template-engine` 的格式/分号一致性。
- `slot-condition-builtin` 的 `as ConditionParam` 和 evaluator 签名断言。

### 步骤 8：确认 ESLint 策略

当前阶段采用：

- builtin ESLint `projectService: false`
- 类型检查由 `typecheck:plugins` 负责

需要在计划和主计划中明确这是有意取舍，不是遗漏。

如果后续要求类型感知 lint，再新增专项任务。

### 步骤 9：补齐 `.gitignore`

确认 `apps/server/builtin/system_pack/plugins/.gitignore` 至少包含：

```gitignore
**/dist/
**/*.js
**/*.js.map
**/*.d.ts
```

### 步骤 10：补充 CI

在 server workflow 中加入：

```yaml
- name: Typecheck server and builtin plugins
  run: pnpm --filter yidhras-server typecheck

- name: Build server and builtin plugins
  run: pnpm --filter yidhras-server build
```

如果担心重复耗时，至少加入：

```yaml
- name: Typecheck builtin plugins
  run: pnpm --filter yidhras-server typecheck:plugins

- name: Build builtin plugins
  run: pnpm --filter yidhras-server build:plugins
```

### 步骤 11：补充 runtime smoke 断言

确认现有 smoke 是否实际触发 builtin 插件导入和注册。

如果没有，新增测试覆盖：

- system pack 初始化后四个插件处于可加载状态。
- data cleaner registry 中存在三个 cleaner。
- slot condition registry 中存在四个 evaluator。
- 每类插件至少执行一次基本调用。

### 步骤 12：验证 dev watch

执行 watch 验证矩阵：

| 场景 | 期望 |
|---|---|
| 修改 `string-methods/server.ts` | 自动重建 `string-methods/dist/server.js` |
| 修改 `template-engine/server.ts` | 自动重建并包含 `render` bundle |
| 插入 TS 错误 | watcher 报错 |
| 修复 TS 错误 | watcher 恢复成功 |
| 删除 dist 后启动 dev | 自动生成 dist |
| 主服务启动早于插件构建 | 行为明确：等待、失败重试，或文档要求先构建 |

---

## 验证命令

本地验证顺序：

```bash
pnpm install
pnpm --filter yidhras-server lint
pnpm --filter yidhras-server typecheck
pnpm --filter yidhras-server build:plugins
pnpm --filter yidhras-server build
pnpm --filter yidhras-server smoke
```

插件专项验证：

```bash
pnpm --filter yidhras-server typecheck:plugins
pnpm --filter yidhras-server build:plugins
find apps/server/builtin/system_pack/plugins -path '*/dist/server.js' -type f
```

production-like 验证：

```bash
pnpm --filter yidhras-server build
pnpm --filter yidhras-server start
```

如果 `start` 需要数据库/运行时前置条件，先执行现有：

```bash
pnpm --filter yidhras-server prepare:runtime
```

---

## 盲点与风险清单

### 1. `@yidhras/contracts` external 可能导致 production import TS 源

证据：`packages/contracts/package.json` exports 指向 `./src/index.ts`。Node production 直接执行 JS 时通常不能直接执行 TS 源。

必须通过 smoke 或移除 external 解决。

### 2. esbuild bundle 可能把服务内部实现复制进插件

`template-engine` 和 `slot-condition-builtin` 会 bundle `src/` 中的运行时实现。风险：

- 插件 bundle 与主服务内部实现版本绑定。
- 如果主服务内部模块包含副作用，可能在插件 import 时重复执行。
- 如果内部模块依赖运行时路径、`import.meta.url`、文件系统相对路径，bundle 后可能改变行为。

需要通过 runtime smoke 和针对性单测验证。

### 3. 插件与主服务共享单例/registry 的边界

如果被 bundle 的 `src/` 模块内部持有单例状态，bundle 后会产生插件内副本，而不是主服务副本。

当前四个插件导入的 `render()` 和 evaluator 看似是纯函数方向，但不能仅凭计划假定。需要检查被 bundle 依赖是否包含全局状态。

### 4. dev 主服务可能先于插件 dist 生成

如果 `dev` 并发启动：

```bash
pnpm run dev:plugins & tsx watch src/index.ts
```

主服务可能在插件 dist 尚未生成时扫描 manifest 并 import 失败。

需要明确处理：

- dev 启动前先同步执行一次 `build:plugins`；或
- 主服务插件加载失败可重试；或
- dev supervisor 等待首次插件构建完成再启动主服务。

### 5. plugin watch 不等于 runtime 热重载

即使 `dist/server.js` 自动重建，主服务已 import 的 ESM 模块不会自动替换。

当前计划不实现插件热重载。需要写明：

- dev watch 只保证 dist 文件更新。
- 运行中的主服务是否重新加载插件，取决于现有 runtime refresh 机制。
- 文件级热替换不在本计划范围内。

### 6. ESLint 非类型感知覆盖存在边界

当前 builtin ESLint 不执行类型感知规则。风险：

- unsafe assignment/member access 等只能靠 `tsc` 和源码 review。
- 如果主计划目标是 `no-unsafe-*` 全覆盖，当前方案不满足。

本计划将其列为明确取舍，而非已解决项。

### 7. CI smoke 可能没有覆盖 system pack 插件实际执行

现有 smoke 启动服务和测试端点，不等于所有 builtin 插件都被 import、activate、调用。

必须检查测试断言，否则需要新增插件 registry 级 smoke。

### 8. manifest/order/source 校验缺失会让新插件绕过流水线

如果未来新增插件目录但未加入 `order.yaml` 或缺少 `tsconfig.json`，当前 glob 或扫描策略可能误构建、误跳过或给出不清晰错误。

构建和 typecheck 必须共享严格插件发现逻辑。

### 9. `.gitignore` 过宽可能隐藏手写 JS

`**/*.js` 会忽略所有插件目录下 JS。如果未来引入手写 JS 辅助文件，可能被误忽略。

当前计划接受这个限制，因为插件源码目标是 TS-only。

### 10. source map 策略影响生产排障

不启用 sourcemap 会让错误栈指向 bundled JS。启用 sourcemap 会产生额外产物并需要 ignore/部署策略。

建议启用，但要确认部署是否包含 `.map` 文件。

---

## 完成定义

本计划完成必须同时满足：

- `apps/server/package.json` 直接声明 `esbuild`。
- `pnpm --filter yidhras-server typecheck` 会执行插件类型检查。
- `pnpm --filter yidhras-server build` 会执行插件类型检查和插件 bundle。
- `build.mjs` 只构建 manifest/order/server.ts 一致的有效插件。
- `typecheck:plugins` 不再盲扫所有子目录。
- 四个插件 manifest source 均为 `dist/server.js`。
- 四个插件均能生成 `dist/server.js`。
- CI 覆盖插件 typecheck/build。
- runtime smoke 证明四个 builtin 插件能被 import、activate、注册并至少基本调用。
- dev watch 行为已验证或替换为显式 watch 实现。
- 文档明确：本计划不实现插件文件级热重载。

---

## 有意不覆盖项

- **第三方插件发布系统**：当前四个插件在 monorepo 内，且属于 system pack。外部插件打包、发布、签名、安装不在本计划范围。
- **插件 ABI 稳定化**：本计划不定义长期插件 ABI，只处理当前 builtin 插件的编译和检查。
- **插件文件级热重载**：构建产物更新不等于 runtime 自动替换已 import 模块。
- **`packages/contracts` 正式构建体系**：仅在 `@yidhras/contracts` external 验证失败时作为后续方案处理。
- **ESLint 类型感知 builtin 覆盖**：当前阶段由 `typecheck:plugins` 承担类型检查；类型感知 ESLint 可作为后续专项。

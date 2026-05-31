import boundaries from 'eslint-plugin-boundaries';
import eslintConfigPrettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import security from 'eslint-plugin-security';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**']
  },

  // Boundaries — must be in a global (non-files-scoped) entry for settings to work
  // Phase 15-16: 25-element granularity, default: 'disallow', severity: 'error'
  {
    languageOptions: {
      parser: tseslint.parser
    },
    plugins: {
      boundaries,
      '@typescript-eslint': tseslint.plugin
    },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      'import/resolver': {
        typescript: true,
        node: true
      },
      'boundaries/elements': [
        { type: 'utils',              pattern: 'src/utils/**', mode: 'full' },
        { type: 'core',               pattern: 'src/core/**', mode: 'full' },
        { type: 'domain',             pattern: 'src/domain/**', mode: 'full' },
        { type: 'inference',          pattern: 'src/inference/**', mode: 'full' },
        { type: 'ai',                 pattern: 'src/ai/**', mode: 'full' },
        { type: 'packs',              pattern: 'src/packs/**', mode: 'full' },
        { type: 'infra-persist',      pattern: 'src/db/**', mode: 'full' },
        { type: 'infra-config',       pattern: 'src/config/**', mode: 'full' },
        { type: 'infra-op',           pattern: 'src/operator/**', mode: 'full' },
        { type: 'infra-id',           pattern: 'src/identity/**', mode: 'full' },
        { type: 'infra-memory',       pattern: 'src/memory/**', mode: 'full' },
        { type: 'infra-context',      pattern: 'src/context/**', mode: 'full' },
        { type: 'infra-plugins',      pattern: 'src/plugins/**', mode: 'full' },
        { type: 'infra-clock',        pattern: 'src/clock/**', mode: 'full' },
        { type: 'infra-conversation', pattern: 'src/conversation/**', mode: 'full' },
        { type: 'infra-template',     pattern: 'src/template_engine/**', mode: 'full' },
        { type: 'infra-det',          pattern: 'src/determinism/**', mode: 'full' },
        { type: 'infra-obs',          pattern: 'src/observability/**', mode: 'full' },
        { type: 'infra-dynamics',     pattern: 'src/dynamics/**', mode: 'full' },
        { type: 'infra-access',       pattern: 'src/access_policy/**', mode: 'full' },
        { type: 'infra-permission',   pattern: 'src/permission/**', mode: 'full' },
        { type: 'infra-world',        pattern: 'src/world/**', mode: 'full' },
        { type: 'infra-kernel',       pattern: 'src/kernel/**', mode: 'full' },
        { type: 'infra-perception',   pattern: 'src/perception/**', mode: 'full' },
        { type: 'app-services',       pattern: 'src/app/services/**', mode: 'full' },
        { type: 'app-runtime',        pattern: 'src/app/runtime/**', mode: 'full' },
        { type: 'transport',          pattern: ['src/app/routes/**', 'src/app/middleware/**', 'src/app/http/**'], mode: 'full' },
        { type: 'app-wiring',         pattern: ['src/app/context/**', 'src/app/composition/**', 'src/bootstrap/**', 'src/index.ts'], mode: 'full' }
      ]
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          rules: (() => {
            // Helpers: convert array of type strings to [{ to: { type }}] format
            const toRules = (types) => types.map(t => ({ to: { type: t } }));
            const toTypeRules = (types) => types.map(t => ({ to: { type: t }, dependency: { kind: 'type' } }));

            return [
            // ═══ Self-referencing: every element can import from its own type ═══
            { from: { type: 'utils' }, allow: [{ to: { type: 'utils' } }] },
            { from: { type: 'core' }, allow: [{ to: { type: 'core' } }] },
            { from: { type: 'domain' }, allow: [{ to: { type: 'domain' } }] },
            { from: { type: 'inference' }, allow: [{ to: { type: 'inference' } }] },
            { from: { type: 'ai' }, allow: [{ to: { type: 'ai' } }] },
            { from: { type: 'packs' }, allow: [{ to: { type: 'packs' } }] },
            { from: { type: 'infra-persist' }, allow: [{ to: { type: 'infra-persist' } }] },
            { from: { type: 'infra-config' }, allow: [{ to: { type: 'infra-config' } }] },
            { from: { type: 'infra-op' }, allow: [{ to: { type: 'infra-op' } }] },
            { from: { type: 'infra-id' }, allow: [{ to: { type: 'infra-id' } }] },
            { from: { type: 'infra-memory' }, allow: [{ to: { type: 'infra-memory' } }] },
            { from: { type: 'infra-context' }, allow: [{ to: { type: 'infra-context' } }] },
            { from: { type: 'infra-plugins' }, allow: [{ to: { type: 'infra-plugins' } }] },
            { from: { type: 'infra-clock' }, allow: [{ to: { type: 'infra-clock' } }] },
            { from: { type: 'infra-conversation' }, allow: [{ to: { type: 'infra-conversation' } }] },
            { from: { type: 'infra-template' }, allow: [{ to: { type: 'infra-template' } }] },
            { from: { type: 'infra-det' }, allow: [{ to: { type: 'infra-det' } }] },
            { from: { type: 'infra-obs' }, allow: [{ to: { type: 'infra-obs' } }] },
            { from: { type: 'infra-dynamics' }, allow: [{ to: { type: 'infra-dynamics' } }] },
            { from: { type: 'infra-access' }, allow: [{ to: { type: 'infra-access' } }] },
            { from: { type: 'infra-permission' }, allow: [{ to: { type: 'infra-permission' } }] },
            { from: { type: 'infra-world' }, allow: [{ to: { type: 'infra-world' } }] },
            { from: { type: 'infra-kernel' }, allow: [{ to: { type: 'infra-kernel' } }] },
            { from: { type: 'infra-perception' }, allow: [{ to: { type: 'infra-perception' } }] },
            { from: { type: 'app-services' }, allow: [{ to: { type: 'app-services' } }] },
            { from: { type: 'app-runtime' }, allow: [{ to: { type: 'app-runtime' } }] },
            { from: { type: 'transport' }, allow: [{ to: { type: 'transport' } }] },
            { from: { type: 'app-wiring' }, allow: [{ to: { type: 'app-wiring' } }] },

            // All element types may import role interfaces (DataContext,
            // PortContext, RuntimeContext, AppContext) from app-wiring.
            { from: { type: '*' }, allow: [{ to: { type: 'app-wiring' } }] },

            // ═══════════════ LEAF LAYERS ═══════════════
            {
              from: [
                { type: 'infra-persist' }, { type: 'infra-config' }, { type: 'infra-id' },
                { type: 'infra-clock' }, { type: 'infra-template' }, { type: 'infra-det' },
                { type: 'infra-obs' }, { type: 'infra-permission' }, { type: 'infra-kernel' }
              ],
              allow: toRules(['utils'])
            },
            {
              from: { type: 'infra-conversation' },
              allow: toRules(['utils', 'infra-persist'])
            },
            {
              from: { type: 'infra-op' },
              allow: toRules(['utils', 'infra-persist', 'infra-id'])
            },
            {
              from: { type: 'infra-access' },
              allow: toRules(['utils', 'infra-persist'])
            },
            { from: { type: 'infra-access' }, allow: toTypeRules(['domain']) },

            // ═══════════════ INFRA-MEMORY ═══════════════
            {
              from: { type: 'infra-memory' },
              allow: toRules(['utils', 'infra-persist'])
            },
            {
              from: { type: 'infra-memory' },
              allow: toRules(['domain', 'inference', 'ai', 'packs', 'infra-context', 'infra-plugins',
                'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport']),
              
            },

            // ═══════════════ INFRA-CONTEXT ═══════════════
            {
              from: { type: 'infra-context' },
              allow: toRules(['utils', 'infra-persist', 'infra-memory'])
            },
            {
              from: { type: 'infra-context' },
              allow: toRules(['domain', 'inference', 'ai', 'packs', 'infra-plugins', 'infra-op',
                'infra-id', 'app-services', 'app-runtime', 'transport']),
              
            },

            // ═══════════════ INFRA-PLUGINS ═══════════════
            {
              from: { type: 'infra-plugins' },
              allow: toRules(['utils', 'infra-persist', 'infra-context', 'infra-memory'])
            },
            {
              from: { type: 'infra-plugins' },
              allow: toRules(['domain', 'inference', 'ai', 'packs', 'infra-op', 'infra-id',
                'app-services', 'app-runtime', 'transport']),
              
            },

            // ═══════════════ INFRA-DYNAMICS ═══════════════
            { from: { type: 'infra-dynamics' }, allow: toRules(['utils']) },
            { from: { type: 'infra-dynamics' }, allow: toTypeRules(['core', 'packs']) },

            // ═══════════════ INFRA-WORLD ═══════════════
            { from: { type: 'infra-world' }, allow: toRules(['utils']) },
            { from: { type: 'infra-world' }, allow: toTypeRules(['core']) },

            // ═══════════════ INFRA-PERCEPTION ═══════════════
            { from: { type: 'infra-perception' }, allow: toRules(['utils']) },
            { from: { type: 'infra-perception' }, allow: toTypeRules(['domain']) },

            // ═══════════════ DOMAIN ═══════════════
            {
              from: { type: 'domain' },
              allow: toRules(['utils', 'infra-op', 'infra-id'])
            },
            {
              from: { type: 'domain' },
              allow: toRules(['infra-persist', 'core', 'inference', 'ai', 'packs', 'infra-memory',
                'infra-context', 'infra-plugins', 'app-services', 'app-runtime', 'transport',
                'infra-access', 'infra-perception', 'infra-conversation']),
              
            },

            // ═══════════════ INFERENCE ═══════════════
            {
              from: { type: 'inference' },
              allow: toRules(['utils', 'infra-persist', 'infra-memory', 'infra-context', 'ai'])
            },
            {
              from: { type: 'inference' },
              allow: toRules(['domain', 'core', 'packs', 'infra-plugins', 'infra-op', 'infra-id',
                'app-services', 'app-runtime', 'transport']),
              
            },

            // ═══════════════ AI ═══════════════
            {
              from: { type: 'ai' },
              allow: toRules(['utils', 'infra-persist', 'inference'])
            },
            {
              from: { type: 'ai' },
              allow: toRules(['domain', 'core', 'packs', 'infra-memory', 'infra-context', 'infra-plugins',
                'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport']),
              
            },

            // ═══════════════ PACKS ═══════════════
            {
              from: { type: 'packs' },
              allow: toRules(['utils', 'infra-persist', 'core', 'domain'])
            },
            {
              from: { type: 'packs' },
              allow: toRules(['inference', 'ai', 'infra-memory', 'infra-context', 'infra-plugins',
                'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport']),
              
            },

            // ═══════════════ CORE ═══════════════
            {
              from: { type: 'core' },
              allow: toRules(['utils', 'infra-clock', 'packs'])
            },
            {
              from: { type: 'core' },
              allow: toRules(['domain', 'inference', 'ai', 'infra-memory', 'infra-context',
                'infra-plugins', 'infra-op', 'infra-id', 'app-services', 'app-runtime', 'transport']),
              
            },

            // ═══════════════ APP-SERVICES ═══════════════
            {
              from: { type: 'app-services' },
              allow: toRules(['utils', 'infra-persist', 'infra-memory', 'infra-context',
                'infra-plugins', 'infra-op', 'infra-id'])
            },
            {
              from: { type: 'app-services' },
              allow: toRules(['domain', 'inference', 'ai', 'packs', 'core', 'app-runtime',
                'transport', 'infra-conversation', 'infra-template', 'infra-det', 'infra-obs',
                'infra-perception']),
              
            },

            // ═══════════════ APP-RUNTIME ═══════════════
            {
              from: { type: 'app-runtime' },
              allow: toRules(['utils', 'core', 'packs', 'infra-memory', 'infra-plugins',
                'infra-persist', 'infra-context'])
            },
            {
              from: { type: 'app-runtime' },
              allow: toRules(['domain', 'inference', 'ai', 'infra-op', 'infra-id',
                'app-services', 'transport', 'infra-perception', 'infra-det', 'infra-obs',
                'infra-conversation']),
              
            },

            // ═══════════════ TRANSPORT ═══════════════
            {
              from: { type: 'transport' },
              allow: toRules(['utils', 'app-services', 'app-runtime', 'infra-persist', 'infra-op',
                'infra-id', 'infra-memory', 'infra-context', 'infra-plugins'])
            },
            {
              from: { type: 'transport' },
              allow: toRules(['domain', 'inference', 'ai', 'core', 'packs']),
              
            },



            // ═══ Phase 16: Known exceptions (→ TODO: refactor to type-only) ═══
            { from: { type: "infra-access" }, allow: toRules(["app-services"]) },       // access_policy imports resolvePackTick
            { from: { type: "infra-op" }, allow: toRules(["app-services"]) },            // operator audit/token imports resolvePackTick
            { from: { type: "core" }, allow: toRules(["infra-persist"]) },               // runtime_database_bootstrap imports applySqliteRuntimePragmas
            // ═══ Phase 16: additional cross-element rules ═══
            { from: { type: "packs" }, allow: toRules(["infra-template","infra-permission","infra-clock","infra-kernel","infra-config"]) },
            { from: { type: "infra-kernel" }, allow: toRules(["packs","app-services"]) },
            { from: { type: "app-services" }, allow: toRules(["infra-config","infra-kernel","infra-access"]) },
            { from: { type: "app-runtime" }, allow: toRules(["infra-config","infra-clock"]) },
            { from: { type: "infra-conversation" }, allow: toRules(["ai","inference","infra-config","infra-template"]) },
            { from: { type: "inference" }, allow: toRules(["infra-template","infra-conversation","infra-config","infra-access","infra-obs"]) },
            { from: { type: "infra-context" }, allow: toRules(["infra-conversation","infra-perception","infra-config","infra-template"]) },
            { from: { type: "ai" }, allow: toRules(["infra-config","infra-conversation"]) },
            { from: { type: "infra-plugins" }, allow: toRules(["infra-obs","infra-perception","infra-config"]) },
            { from: { type: "domain" }, allow: toRules(["infra-template","infra-permission"]) },
            { from: { type: "infra-template" }, allow: toRules(["infra-det","infra-permission"]) },
            { from: { type: "infra-persist" }, allow: toRules(["infra-op","infra-config"]) },
            { from: { type: "infra-access" }, allow: toRules(["infra-id"]) },
            { from: { type: "transport" }, allow: toRules(["infra-obs","infra-config"]) },
            { from: { type: "infra-world" }, allow: toRules(["infra-config"]) },
            { from: { type: "infra-memory" }, allow: toRules(["infra-config"]) },
            { from: { type: "infra-clock" }, allow: toRules(["packs"]) },
            { from: { type: "infra-op" }, allow: toRules(["infra-config","domain"]) },
            { from: { type: "infra-id" }, allow: toRules(["infra-op"]) },
            { from: { type: "infra-plugins" }, allow: toRules(["core"]) },
            { from: { type: "infra-config" }, allow: toRules(["infra-conversation"]) },
            { from: { type: "core" }, allow: toRules(["infra-config"]) },
            { from: { type: "infra-conversation" }, allow: toTypeRules(["inference","ai"]) },
            { from: { type: "infra-context" }, allow: toTypeRules(["infra-conversation"]) },
            { from: { type: "inference" }, allow: toTypeRules(["infra-conversation","infra-access"]) },
            { from: { type: "infra-plugins" }, allow: toTypeRules(["infra-perception"]) },
            { from: { type: "infra-access" }, allow: toTypeRules(["infra-id","app-services"]) },
            { from: { type: "core" }, allow: toTypeRules(["infra-persist"]) },
            { from: { type: "infra-persist" }, allow: toTypeRules(["infra-op"]) },
            { from: { type: "infra-kernel" }, allow: toTypeRules(["app-services"]) },
            { from: { type: "ai" }, allow: toTypeRules(["infra-conversation"]) },
            { from: { type: "domain" }, allow: toTypeRules(["infra-permission"]) },
            // ═══════════════ APP-WIRING — can import any ═══════════════
            {
              from: { type: 'app-wiring' },
              allow: [{ to: { type: '*' } }]
            }
            ];
          })()
        }
      ]
    }
  },

  // TypeScript type-checked rules — scoped to src (has projectService)
  ...tseslint.configs.recommendedTypeChecked.map((rc) => ({
    ...rc,
    files: ['src/**/*.ts']
  })),

  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  security.configs.recommended,
  eslintConfigPrettier,

  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
        node: true
      }
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-empty': ['error', { allowEmptyCatch: false }],
      'prefer-const': 'error',
      'no-case-declarations': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-prototype-builtins': 'error',
      'no-path-concat': 'error',
      'import-x/no-named-as-default-member': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/extensions': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative imports in server must end with .js'
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative exports in server must end with .js'
        },
        {
          selector: "ExportAllDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative exports in server must end with .js'
        }
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/no-unnecessary-type-parameters': 'error',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'error',
      '@typescript-eslint/no-unnecessary-type-conversion': 'error',
      '@typescript-eslint/no-unnecessary-template-expression': 'error',
      '@typescript-eslint/no-useless-default-assignment': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: false }]
    }
  },

  // Logger — permitted to use console.* directly
  {
    files: ['src/utils/logger.ts'],
    rules: {
      'no-console': 'off'
    }
  },

  // CLI scripts and init — console.* is the user interface
  {
    files: ['src/cli/**/*.ts', 'src/init/**/*.ts'],
    rules: {
      'no-console': 'off'
    }
  },

  // Tests — no boundaries constraints, tests may import from any layer.
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort
    },
    rules: {
      'no-console': 'off',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-prototype-builtins': 'error',
      'no-path-concat': 'error',
      'import-x/no-named-as-default-member': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/extensions': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative imports in tests must end with .js'
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative exports in tests must end with .js'
        },
        {
          selector: "ExportAllDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative exports in tests must end with .js'
        }
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ],
      'security/detect-non-literal-fs-filename': 'off'
    }
  },

  // Scripts — no boundaries constraints, security rules apply (scripts manipulate processes/files).
  {
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort
    },
    rules: {
      'no-console': 'off',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-prototype-builtins': 'error',
      'no-path-concat': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative imports must end with .js'
        }
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },

  // Builtin system pack plugins — no boundaries constraints, plugins import from src/
  {
    files: ['builtin/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'simple-import-sort': simpleImportSort
    },
    rules: {
      'no-console': 'off',
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-prototype-builtins': 'error',
      'no-path-concat': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
          message: 'NodeNext relative imports in plugins must end with .js'
        }
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
);

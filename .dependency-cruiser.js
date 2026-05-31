/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    /* ------------------------------------------------------------------ */
    /*  no-circular                                                       */
    /*  Runtime-level circular dependencies are forbidden.                */
    /*  tsPreCompilationDeps: false ensures only value-level deps are     */
    /*  tracked — type-only imports cannot cause initialization issues.   */
    /* ------------------------------------------------------------------ */
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'This dependency is part of a circular relationship. ' +
        'Circular dependencies make refactoring brittle and can cause initialization deadlocks.',
      from: {},
      to: {
        circular: true
      }
    },

    /* ------------------------------------------------------------------ */
    /*  no-orphans                                                        */
    /*  Flags files that nothing imports. Entry points and framework-     */
    /*  autowired files are excluded.                                     */
    /* ------------------------------------------------------------------ */
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        "This is an orphan module — it's likely not used. If it's an entry point " +
        'or framework-wired file, add an exception to the pathNot list.',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          '[.]d[.]ts$',
          '(^|/)tsconfig[.]json$',
          '(^|/)(?:babel|webpack|nuxt|i18n|tailwind|vitest)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          // Server entry points (entry file, CLI, init scripts, seed scripts)
          '^src/index\\.ts$',
          '^src/cli/',
          '^src/init/',
          '^src/db/seed_',
          // Nuxt framework-autowired files (web)
          '^pages/',
          '^layouts/',
          '^middleware/',
          '^plugins/',
          '^server/',
          '^app\\.vue$'
        ]
      },
      to: {}
    },

    /* ------------------------------------------------------------------ */
    /*  no-deprecated-core                                                */
    /*  Deprecated Node.js core modules.                                  */
    /* ------------------------------------------------------------------ */
    {
      name: 'no-deprecated-core',
      severity: 'warn',
      comment:
        'A module depends on a node core module that has been deprecated. ' +
        'Find an alternative.',
      from: {},
      to: {
        dependencyTypes: ['core'],
        path: [
          '^v8/tools/codemap$',
          '^v8/tools/consarray$',
          '^v8/tools/csvparser$',
          '^v8/tools/logreader$',
          '^v8/tools/profile_view$',
          '^v8/tools/profile$',
          '^v8/tools/SourceMap$',
          '^v8/tools/splaytree$',
          '^v8/tools/tickprocessor-driver$',
          '^v8/tools/tickprocessor$',
          '^node-inspect/lib/_inspect$',
          '^node-inspect/lib/internal/inspect_client$',
          '^node-inspect/lib/internal/inspect_repl$',
          '^async_hooks$',
          '^punycode$',
          '^domain$',
          '^constants$',
          '^sys$',
          '^_linklist$',
          '^_stream_wrap$'
        ]
      }
    },

    /* ------------------------------------------------------------------ */
    /*  not-to-deprecated                                                 */
    /*  Flags use of deprecated npm packages.                             */
    /* ------------------------------------------------------------------ */
    {
      name: 'not-to-deprecated',
      severity: 'warn',
      comment:
        'This module uses a deprecated npm package. Either upgrade or find an alternative.',
      from: {},
      to: {
        dependencyTypes: ['deprecated']
      }
    },

    /* ------------------------------------------------------------------ */
    /*  no-duplicate-dep-types                                            */
    /*  Same package in deps AND devDeps.                                 */
    /* ------------------------------------------------------------------ */
    {
      name: 'no-duplicate-dep-types',
      severity: 'warn',
      comment:
        'This module depends on an npm package that occurs in both dependencies ' +
        'and devDependencies.',
      from: {},
      to: {
        moreThanOneDependencyType: true,
        dependencyTypesNot: ['type-only']
      }
    }
  ],

  options: {
    doNotFollow: {
      path: ['node_modules']
    },

    exclude: {
      path: [
        '(^|/)dist/',
        '(^|/)coverage/',
        '(^|/)\\.nuxt/',
        '(^|/)\\.output/',
        '(^|/)\\.nitro/',
        '(^|/)\\.cache/',
        '(^|/)tests/',
        '\\.spec\\.ts$',
        '\\.test\\.ts$',
        '(^|/)builtin/'
      ]
    },

    // tsPreCompilationDeps: false — only follow runtime deps.
    // Type-only imports do not cause runtime initialization deadlocks.
    // This is set false so that cycle detection focuses on actual
    // runtime circular dependencies, not type-level structural cycles.
    tsPreCompilationDeps: false,

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.mjs', '.js', '.json']
    },

    reporterOptions: {
      text: {
        highlightFocused: true
      }
    }
  }
};

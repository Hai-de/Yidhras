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
  {
    plugins: {
      boundaries
    },
    settings: {
      'boundaries/root-path': import.meta.dirname,
      'import/resolver': {
        typescript: true,
        node: true
      },
      'boundaries/elements': [
        { type: 'transport', pattern: 'src/app/routes/**', mode: 'full' },
        { type: 'transport', pattern: 'src/app/middleware/**', mode: 'full' },
        { type: 'transport', pattern: 'src/app/http/**', mode: 'full' },
        { type: 'app', pattern: 'src/app/services/**', mode: 'full' },
        { type: 'app', pattern: 'src/app/runtime/**', mode: 'full' },
        { type: 'app', pattern: 'src/app/context.*', mode: 'full' },
        { type: 'core', pattern: 'src/core/**', mode: 'full' },
        { type: 'domain', pattern: 'src/domain/**', mode: 'full' },
        { type: 'inference', pattern: 'src/inference/**', mode: 'full' },
        { type: 'ai', pattern: 'src/ai/**', mode: 'full' },
        { type: 'packs', pattern: 'src/packs/**', mode: 'full' },
        { type: 'infra', pattern: 'src/config/**', mode: 'full' },
        { type: 'infra', pattern: 'src/operator/**', mode: 'full' },
        { type: 'infra', pattern: 'src/identity/**', mode: 'full' },
        { type: 'infra', pattern: 'src/memory/**', mode: 'full' },
        { type: 'infra', pattern: 'src/db/**', mode: 'full' },
        { type: 'infra', pattern: 'src/init/**', mode: 'full' },
        { type: 'infra', pattern: 'src/clock/**', mode: 'full' },
        { type: 'infra', pattern: 'src/narrative/**', mode: 'full' },
        { type: 'infra', pattern: 'src/dynamics/**', mode: 'full' },
        { type: 'infra', pattern: 'src/world/**', mode: 'full' },
        { type: 'infra', pattern: 'src/access_policy/**', mode: 'full' },
        { type: 'infra', pattern: 'src/permission/**', mode: 'full' },
        { type: 'infra', pattern: 'src/plugins/**', mode: 'full' },
        { type: 'infra', pattern: 'src/context/**', mode: 'full' },
        { type: 'utils', pattern: 'src/utils/**', mode: 'full' }
      ]
    },
    rules: {
      'boundaries/dependencies': [
        'warn',
        {
          default: 'allow',
          rules: [
            {
              // core is the bottom simulation layer; packs orchestration is a legitimate runtime dependency
              from: { type: 'core' },
              disallow: [
                {
                  to: { type: ['transport', 'domain', 'inference', 'ai'] },
                  dependency: { kind: 'value' }
                },
                {
                  to: { type: ['transport', 'domain', 'inference', 'ai'] },
                  dependency: { kind: 'type' }
                },
                {
                  to: { type: ['app'] },
                  dependency: { kind: 'value' }
                }
              ]
            },
            {
              // utils must not depend on any business layer
              from: { type: 'utils' },
              disallow: [
                {
                  to: { type: ['transport', 'app', 'domain', 'inference', 'ai', 'packs', 'core', 'infra'] },
                  dependency: { kind: 'value' }
                },
                {
                  to: { type: ['transport', 'app', 'domain', 'inference', 'ai', 'packs', 'core', 'infra'] },
                  dependency: { kind: 'type' }
                }
              ]
            },
            {
              // transport should not directly depend on inner layers (domain, ai, core)
              from: { type: 'transport' },
              disallow: [
                {
                  to: { type: ['domain', 'ai', 'core'] },
                  dependency: { kind: 'value' }
                },
                {
                  to: { type: ['domain', 'ai', 'core'] },
                  dependency: { kind: 'type' }
                }
              ]
            }
          ]
        }
      ]
    }
  },

  ...tseslint.configs.recommendedTypeChecked,
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
      'no-console': 'off',
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
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ]
    }
  }
);

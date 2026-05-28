import { existsSync } from 'node:fs';

import boundaries from 'eslint-plugin-boundaries';
import eslintConfigPrettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import noUnsanitized from 'eslint-plugin-no-unsanitized';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import pluginVue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

const nuxtTsConfigExists = existsSync('.nuxt/tsconfig.app.json');

export default tseslint.config(
  {
    ignores: [
      '.nuxt/**',
      '.output/**',
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '.eslintrc.cjs',
      'eslint.config.mjs'
    ]
  },

  // Vue flat configs
  ...pluginVue.configs['flat/recommended'],

  // Vue files — wire TypeScript as the script parser
  {
    files: ['*.vue', '**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue']
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ]
    }
  },

  // TypeScript files — type-checked rules
  {
    files: [
      'composables/**/*.ts',
      'features/**/*.ts',
      'pages/**/*.ts',
      'stores/**/*.ts',
      'lib/**/*.ts',
      'plugins/**/*.ts',
      'components/**/*.ts',
      '*.ts'
    ],
    extends: nuxtTsConfigExists
      ? [tseslint.configs.recommendedTypeChecked]
      : [tseslint.configs.recommended],
    languageOptions: {
      parserOptions: nuxtTsConfigExists
        ? {
            projectService: true,
            tsconfigRootDir: import.meta.dirname
          }
        : {}
    }
  },

  // Shared plugin configs
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  noUnsanitized.configs.recommended,
  eslintConfigPrettier,

  // Global custom rules
  {
    plugins: {
      boundaries,
      '@typescript-eslint': tseslint.plugin,
      'simple-import-sort': simpleImportSort
    },
    settings: {
      'import-x/resolver': {
        typescript: true,
        node: true
      },
      'import-x/core-modules': ['#imports'],
      'import-x/ignore': ['^#imports$', '^~/'],
      'boundaries/elements': [
        { type: 'pages', pattern: 'pages/**', mode: 'full' },
        { type: 'features', pattern: 'features/**', mode: 'full' },
        { type: 'composables-api', pattern: 'composables/api/**', mode: 'full' },
        { type: 'composables', pattern: 'composables/app/**', mode: 'full' },
        { type: 'composables', pattern: 'composables/ui/**', mode: 'full' },
        { type: 'stores', pattern: 'stores/**', mode: 'full' },
        { type: 'lib', pattern: 'lib/**', mode: 'full' },
        { type: 'ui', pattern: 'components/ui/**', mode: 'full' }
      ]
    },
    rules: {
      'no-console': 'off',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-prototype-builtins': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-unresolved': ['error', { ignore: ['^#imports$', '^~/'] }],
      'import-x/extensions': [
        'warn',
        'ignorePackages',
        { js: 'never', ts: 'never', vue: 'never' }
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' }
      ],
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'error',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'boundaries/dependencies': [
        'warn',
        {
          default: 'allow',
          rules: [
            {
              from: { type: 'composables-api' },
              disallow: [
                { to: { type: 'features' }, dependency: { kind: 'value' } },
                { to: { type: 'features' }, dependency: { kind: 'type' } }
              ]
            },
            {
              from: { type: 'lib' },
              disallow: [
                { to: { type: ['features', 'pages', 'stores'] }, dependency: { kind: 'value' } },
                { to: { type: ['features', 'pages', 'stores'] }, dependency: { kind: 'type' } }
              ]
            },
            {
              from: { type: 'ui' },
              disallow: [
                { to: { type: ['features', 'pages', 'stores'] }, dependency: { kind: 'value' } },
                { to: { type: ['features', 'pages', 'stores'] }, dependency: { kind: 'type' } }
              ]
            }
          ]
        }
      ]
    }
  }
);

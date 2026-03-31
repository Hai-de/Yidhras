module.exports = {
  root: true,
  env: {
    es2022: true,
    browser: true,
    node: true
  },
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 'latest',
    sourceType: 'module',
    extraFileExtensions: ['.vue']
  },
  plugins: ['vue', '@typescript-eslint', 'import', 'simple-import-sort'],
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier'
  ],
  settings: {
    'import/core-modules': [
      '#imports'
    ],
    'import/resolver': {
      typescript: true,
      node: true
    },
    'import/ignore': [
      '^#imports$',
      '^~/'
    ]
  },
  ignorePatterns: ['.nuxt/**', '.output/**', 'node_modules/**', 'coverage/**', 'dist/**'],
  rules: {
    'no-console': 'off',
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'import/extensions': [
      'warn',
      'ignorePackages',
      {
        js: 'never',
        ts: 'never',
        vue: 'never'
      }
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'vue/multi-word-component-names': 'off'
  }
};

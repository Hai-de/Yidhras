module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
    project: true,
    tsconfigRootDir: __dirname
  },
  plugins: ['@typescript-eslint', 'import', 'simple-import-sort', 'security'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:security/recommended-legacy',
    'prettier'
  ],
  settings: {
    'import/resolver': {
      typescript: true,
      node: true
    }
  },
  ignorePatterns: ['dist/**', 'node_modules/**', 'coverage/**'],
  rules: {
    'no-console': 'off',
    'prefer-const': 'error',
    'no-case-declarations': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-prototype-builtins': 'error',
    'no-path-concat': 'error',
    'import/no-named-as-default-member': 'off',
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'import/extensions': 'off',
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
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  }
};

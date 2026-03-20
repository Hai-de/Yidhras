module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint', 'import', 'simple-import-sort'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
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

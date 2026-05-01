import boundaries from 'eslint-plugin-boundaries';

export default [
  {
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'everything', pattern: 'src/**' }
      ]
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', rules: [] }]
    }
  }
];

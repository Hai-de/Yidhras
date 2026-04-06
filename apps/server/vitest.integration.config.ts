import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'server-integration',
      include: ['tests/integration/**/*.spec.ts'],
      fileParallelism: false
    }
  })
);

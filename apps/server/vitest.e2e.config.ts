import { defineConfig, mergeConfig } from 'vitest/config';

import baseConfig from './vitest.config.js';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      name: 'server-e2e',
      include: ['tests/e2e/**/*.spec.ts'],
      fileParallelism: false,
      hookTimeout: 180_000,
      testTimeout: 180_000
    }
  })
);

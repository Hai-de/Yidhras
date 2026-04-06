import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  test: {
    name: 'web-unit',
    environment: 'node',
    include: ['tests/unit/**/*.spec.ts'],
    clearMocks: true,
    restoreMocks: true
  }
});

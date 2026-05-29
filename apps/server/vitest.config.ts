import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const projectRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  test: {
    environment: 'node',
    clearMocks: true,
    restoreMocks: true,
    passWithNoTests: true,
    hookTimeout: 120_000,
    testTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli/**',
        'src/init/**',
        'src/index.ts',
        'src/db/seed*.ts',
        '**/*.d.ts'
      ],
      thresholds: {
        lines: 60,
        branches: 45,
        functions: 50,
        statements: 60
      }
    }
  }
});

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'apps/web/vitest.config.ts',
  'apps/server/vitest.unit.config.ts',
  'apps/server/vitest.integration.config.ts',
  'apps/server/vitest.e2e.config.ts'
]);

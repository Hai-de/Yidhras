import { buildRuntimeConfigScaffoldReport,printInitReport } from './report.js';
import { ensureRuntimeConfigScaffold,logRuntimeConfigScaffoldResult } from './runtime_scaffold.js';

const main = (): void => {
  const result = ensureRuntimeConfigScaffold();
  logRuntimeConfigScaffoldResult(result);
  printInitReport({
    kind: 'configw',
    timestamp: new Date().toISOString(),
    scaffold: buildRuntimeConfigScaffoldReport(result)
  });
};

main();

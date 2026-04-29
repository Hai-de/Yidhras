import { getRuntimeConfigMetadata, getWorldPacksDir } from '../config/runtime_config.js';
import { buildRuntimeMetadataReport, printInitReport } from './report.js';
import {
  logWorldPackProjectScaffoldResult,
  scaffoldWorldPackProject,
  type WorldPackProjectScaffoldOptions
} from './world_pack_project_scaffold.js';

const parseArgs = (argv: string[]): WorldPackProjectScaffoldOptions => {
  const options: WorldPackProjectScaffoldOptions = {
    packDirName: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
// eslint-disable-next-line security/detect-object-injection -- 从内部枚举构造的键
    const current = argv[index];
    const next = argv[index + 1];

    switch (current) {
      case '--dir':
      case '--pack-dir':
        options.packDirName = next ?? '';
        index += 1;
        break;
      case '--id':
        options.packId = next;
        index += 1;
        break;
      case '--name':
        options.name = next;
        index += 1;
        break;
      case '--version':
        options.version = next;
        index += 1;
        break;
      case '--description':
        options.description = next;
        index += 1;
        break;
      case '--author':
        options.author = next;
        index += 1;
        break;
      case '--homepage':
        options.homepage = next;
        index += 1;
        break;
      case '--repository':
        options.repository = next;
        index += 1;
        break;
      case '--license':
        options.license = next;
        index += 1;
        break;
      case '--tags':
        options.tags = (next ?? '')
          .split(',')
          .map(item => item.trim())
          .filter(Boolean);
        index += 1;
        break;
      case '--status':
        options.status = next;
        index += 1;
        break;
      case '--compat':
      case '--yidhras-compat':
        options.yidhrasCompatibility = next;
        index += 1;
        break;
      case '--overwrite':
        options.overwrite = true;
        break;
      case '--set-preferred':
        options.setPreferredPack = true;
        break;
      case '--set-bootstrap-template':
        options.setBootstrapTemplate = true;
        break;
      case '--disable-bootstrap':
        options.disableBootstrap = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        throw new Error([
          'Usage: pnpm --filter yidhras-server scaffold:world-pack -- --dir <pack-dir> [options]',
          'Options:',
          '  --dir, --pack-dir <name>      目标目录名（必填）',
          '  --id <pack-id>                metadata.id',
          '  --name <display-name>         metadata.name',
          '  --version <semver>            metadata.version',
          '  --description <text>          metadata.description',
          '  --author <a,b>                作者列表，逗号分隔',
          '  --homepage <url>',
          '  --repository <url>',
          '  --license <license>',
          '  --tags <a,b,c>',
          '  --status <draft|stable|template>',
          '  --compat, --yidhras-compat <range>',
          '  --overwrite                   覆盖已存在文件',
          '  --set-preferred              把该 pack 写入 data/configw/default.yaml 的 world.preferred_pack',
          '  --set-bootstrap-template     把 bootstrap.target_pack_dir/template_file 指向新 pack',
          '  --disable-bootstrap          将 bootstrap.enabled 写为 false',
          '  --dry-run                    仅预览将创建/覆盖的文件与配置修改，不写入磁盘'
        ].join('\n'));
      default:
        break;
    }
  }

  if (!options.packDirName.trim()) {
    throw new Error('缺少必填参数 --dir <pack-dir>');
  }

  return options;
};

const main = (): void => {
  const rawArgs = process.argv.slice(2);
  const normalizedArgs = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const options = parseArgs(normalizedArgs);
  const result = scaffoldWorldPackProject(options);
  logWorldPackProjectScaffoldResult(result);
  printInitReport({
    kind: 'world_pack',
    timestamp: new Date().toISOString(),
    runtime: buildRuntimeMetadataReport(getRuntimeConfigMetadata(), {
      worldPacksDir: getWorldPacksDir()
    }),
    world_pack_bootstrap: undefined,
    scaffold: {
      created_count: result.createdFiles.length,
      existing_count: result.skippedFiles.length,
      created_files: [...result.createdFiles, ...result.overwrittenFiles, ...result.plannedFiles],
      existing_files: result.skippedFiles
    }
  });
};

main();

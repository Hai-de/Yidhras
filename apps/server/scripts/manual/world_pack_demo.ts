import path from 'path';

import { WorldPackLoader } from '../../src/world/loader.js';

const packsDir = path.resolve('../../data/world_packs');

const loader = new WorldPackLoader(packsDir);

console.log(`--- 扫描 World Packs 目录: ${packsDir} ---`);
const available = loader.listAvailablePacks();
console.log(`可用包 (文件夹): ${available.join(', ')}`);

if (available.length > 0) {
  const folderToLoad = available[0];
  console.log(`\n--- 按需加载: ${folderToLoad} ---`);
  const p = loader.loadPack(folderToLoad);

  console.log(`\n[${p.metadata.name}] 详情:`);
  console.log(`- ID: ${p.metadata.id}`);
  console.log(`- 版本: ${p.metadata.version}`);
  console.log(`- 变量数: ${Object.keys(p.variables || {}).length}`);
  console.log(`- 历法数: ${p.time_systems?.length || 0}`);

  if (p.time_systems && p.time_systems.length > 0) {
    console.log(`- 首个历法: ${p.time_systems[0].name} (Tick Rate: ${p.time_systems[0].tick_rate})`);
  }

  console.log('\n--- 聚合变量池 ---');
  const mergedVars = loader.getMergedVariables();
  console.log('Currency:', mergedVars.currency);
  console.log('Governance:', mergedVars.governance);
} else {
  console.log('\n未发现可用的世界包文件夹。');
}

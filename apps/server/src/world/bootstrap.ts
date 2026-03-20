import fs from 'fs';
import path from 'path';

const worldPacksDir = path.resolve(process.cwd(), '../../data/world_packs');
const defaultPackDir = path.join(worldPacksDir, 'cyber_noir');
const defaultConfigPath = path.join(defaultPackDir, 'config.yaml');

const defaultConfig = `metadata:
  id: "world-cyber-noir"
  name: "Cyber Noir"
  version: "0.1.0"
  description: "Bootstrap world pack for first startup"

simulation_time:
  initial_tick: 0
  min_tick: 0
  max_tick: 999999999999
  step_ticks: 1

time_systems:
  - id: "default"
    name: "Default"
    is_primary: true
    tick_rate: 1000
    units:
      - name: "second"
        ratio: 1
      - name: "minute"
        ratio: 60
      - name: "hour"
        ratio: 60
`;

const ensureBootstrapWorldPack = (): void => {
  if (!fs.existsSync(worldPacksDir)) {
    fs.mkdirSync(worldPacksDir, { recursive: true });
    console.log(`[bootstrap] Created directory: ${worldPacksDir}`);
  }

  if (!fs.existsSync(defaultPackDir)) {
    fs.mkdirSync(defaultPackDir, { recursive: true });
    console.log(`[bootstrap] Created pack directory: ${defaultPackDir}`);
  }

  if (!fs.existsSync(defaultConfigPath)) {
    fs.writeFileSync(defaultConfigPath, defaultConfig, 'utf-8');
    console.log(`[bootstrap] Created default world pack config: ${defaultConfigPath}`);
  } else {
    console.log(`[bootstrap] World pack config exists, skipped: ${defaultConfigPath}`);
  }
};

ensureBootstrapWorldPack();

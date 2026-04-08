import 'dotenv/config';

import { getPreferredWorldPack } from '../../src/config/runtime_config.js';

export const DEFAULT_E2E_WORLD_PACK = getPreferredWorldPack();

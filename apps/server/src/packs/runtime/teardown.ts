import fs from 'fs';

import { resolvePackRuntimeDatabaseLocation } from '../storage/pack_db_locator.js';

export const clearPackRuntimeStorage = (packId: string): boolean => {
  const location = resolvePackRuntimeDatabaseLocation(packId);
  if (fs.existsSync(location.runtimeDbPath)) {
    fs.unlinkSync(location.runtimeDbPath);
    return true;
  }
  return false;
};

 
import { createNotificationManager } from '../../utils/notifications.js';
import type { ServiceProvider } from '../provider.js';
import { TOKENS } from '../tokens.js';

export const notificationsProvider: ServiceProvider = {
  provide: TOKENS.notifications,
  useFactory: () => createNotificationManager()
};

import { createNotificationManager } from '../../utils/notifications.js';
import { TOKENS } from '../tokens.js';

export const notificationsProvider = {
  provide: TOKENS.notifications,
  useFactory: () => createNotificationManager()
} as const satisfies import('../provider.js').ServiceProvider;

import type { Express } from 'express';

import type { AppContext } from '../context.js';
import {
  clearSystemNotifications,
  getRuntimeStatusSnapshot,
  getStartupHealthSnapshot,
  listSystemNotifications
} from '../services/system.js';

export const registerSystemRoutes = (app: Express, context: AppContext): void => {
  app.get('/api/system/notifications', (_req, res) => {
    const messages = listSystemNotifications(context);
    res.json(messages);
  });

  app.post('/api/system/notifications/clear', (_req, res) => {
    res.json(clearSystemNotifications(context));
  });

  app.get('/api/status', (_req, res) => {
    res.json(getRuntimeStatusSnapshot(context));
  });

  app.get('/api/health', (_req, res) => {
    const snapshot = getStartupHealthSnapshot(context);
    res.status(snapshot.statusCode).json(snapshot.body);
  });
};

import type { Express } from 'express';

import type { AppContext } from '../context.js';
import { jsonOk } from '../http/json.js';
import {
  clearSystemNotifications,
  getRuntimeStatusSnapshot,
  getStartupHealthSnapshot,
  listSystemNotifications
} from '../services/system.js';

export const registerSystemRoutes = (app: Express, context: AppContext): void => {
  app.get('/api/system/notifications', (_req, res) => {
    jsonOk(res, listSystemNotifications(context));
  });

  app.post('/api/system/notifications/clear', (_req, res) => {
    jsonOk(res, clearSystemNotifications(context));
  });

  app.get('/api/status', (_req, res) => {
    jsonOk(res, getRuntimeStatusSnapshot(context));
  });

  app.get('/api/health', (_req, res) => {
    const snapshot = getStartupHealthSnapshot(context);
    res.status(snapshot.statusCode);
    jsonOk(res, snapshot.body);
  });
};

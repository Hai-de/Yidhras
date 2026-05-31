import type { Express } from 'express';

import type { DataContext } from './data_context.js';
import type { PortContext } from './port_context.js';
import type { RuntimeContext } from './runtime_context.js';

export interface AppContext extends DataContext, RuntimeContext, PortContext {}

export type RouteRegistrar = (app: Express, context: AppContext) => void;

// Re-export all role interfaces from the canonical path.
// Consumers should import directly from './context/index.js'.
export type {
  AppContext,
  DataContext,
  HealthLevel,
  NotificationStore,
  PortContext,
  RouteRegistrar,
  RuntimeContext,
  RuntimeLoopDiagnostics,
  StartupHealth
} from './context/index.js';

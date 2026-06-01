import { describe, expect, it } from 'vitest';

import {
  NotificationCode,
  NotificationCodeDetailsMap,
  PermissionCapabilityDeniedDetailsSchema,
  PermissionSlotDeniedDetailsSchema,
  PluginErrorDetailsSchema,
  PluginErrorPhase,
  SystemDetailsSchema
} from '../../../src/utils/notification_details.js';

describe('NotificationCode', () => {
  it('all 16 codes are unique', () => {
    const values = Object.values(NotificationCode);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it('every code has a corresponding schema in NotificationCodeDetailsMap', () => {
    for (const code of Object.values(NotificationCode)) {
      expect(NotificationCodeDetailsMap[code]).toBeDefined();
    }
  });
});

describe('PluginErrorPhase', () => {
  it('all 6 phases are defined', () => {
    const phases = Object.values(PluginErrorPhase);
    expect(phases).toHaveLength(6);
    expect(phases).toContain('activation');
    expect(phases).toContain('invocation');
    expect(phases).toContain('deactivation');
    expect(phases).toContain('host_call');
    expect(phases).toContain('crash');
    expect(phases).toContain('host_api_check');
  });
});

describe('PermissionSlotDeniedDetailsSchema', () => {
  it('accepts valid data', () => {
    const result = PermissionSlotDeniedDetailsSchema.safeParse({
      module: 'permission-filter',
      timestamp: 1748764800000,
      kind: 'slot_denied',
      denied_read_count: 5,
      denied_visibility_count: 3,
      affected_slot_ids: ['world_state', 'agent_memory'],
      actor_identity_id: 'identity-xxx',
      actor_agent_id: 'agent-yyy'
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = PermissionSlotDeniedDetailsSchema.safeParse({
      module: 'permission-filter',
      timestamp: 1748764800000
    });
    expect(result.success).toBe(false);
  });

  it('rejects wrong kind literal', () => {
    const result = PermissionSlotDeniedDetailsSchema.safeParse({
      module: 'permission-filter',
      timestamp: 1748764800000,
      kind: 'capability_denied',
      denied_read_count: 0,
      denied_visibility_count: 0,
      affected_slot_ids: [],
      actor_identity_id: 'x',
      actor_agent_id: 'y'
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative counts', () => {
    const result = PermissionSlotDeniedDetailsSchema.safeParse({
      module: 'permission-filter',
      timestamp: 1748764800000,
      kind: 'slot_denied',
      denied_read_count: -1,
      denied_visibility_count: 0,
      affected_slot_ids: [],
      actor_identity_id: 'x',
      actor_agent_id: 'y'
    });
    expect(result.success).toBe(false);
  });
});

describe('PermissionCapabilityDeniedDetailsSchema', () => {
  it('accepts valid data', () => {
    const result = PermissionCapabilityDeniedDetailsSchema.safeParse({
      module: 'plugin-worker-client',
      timestamp: 1748764800000,
      kind: 'capability_denied',
      plugin_id: 'my-plugin',
      installation_id: 'inst-001',
      capability_key: 'api_route_register',
      method: 'registerRoute'
    });
    expect(result.success).toBe(true);
  });
});

describe('PluginErrorDetailsSchema', () => {
  it('accepts minimal valid data', () => {
    const result = PluginErrorDetailsSchema.safeParse({
      module: 'plugin-worker-manager',
      timestamp: 1748764800000,
      pack_id: 'pack-1',
      plugin_id: 'plugin-1',
      installation_id: 'inst-1',
      phase: 'activation'
    });
    expect(result.success).toBe(true);
  });

  it('accepts full data with source_location', () => {
    const result = PluginErrorDetailsSchema.safeParse({
      module: 'plugin-worker-manager',
      timestamp: 1748764800000,
      pack_id: 'pack-1',
      plugin_id: 'plugin-1',
      installation_id: 'inst-1',
      phase: 'crash',
      source_location: { file: 'src/handler.ts', line: 42, column: 10 },
      contribution_type: 'context_source',
      contribution_invoke: 'getWorldState',
      raw_message: 'TypeError: undefined is not a function'
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid phase', () => {
    const result = PluginErrorDetailsSchema.safeParse({
      module: 'plugin-worker-manager',
      timestamp: 1748764800000,
      pack_id: 'pack-1',
      plugin_id: 'plugin-1',
      installation_id: 'inst-1',
      phase: 'invalid_phase'
    });
    expect(result.success).toBe(false);
  });
});

describe('SystemDetailsSchema', () => {
  it('accepts base fields', () => {
    const result = SystemDetailsSchema.safeParse({
      module: 'server-init',
      timestamp: 1748764800000
    });
    expect(result.success).toBe(true);
  });
});

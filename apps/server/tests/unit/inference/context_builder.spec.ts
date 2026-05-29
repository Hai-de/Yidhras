import { describe, expect, it, vi } from 'vitest';

// Mock heavy dependencies before import
vi.mock('../../../src/access_policy/service.js', () => ({
  AccessPolicyService: vi.fn().mockImplementation(() => ({}))
}));

vi.mock('../../../src/app/services/agent/agent.js', () => ({
  getAgentContextSnapshot: vi.fn(async () => ({
    identity: { id: 'identity-1', type: 'agent', name: 'Test Agent', provider: 'local', status: 'active', claims: null }
  }))
}));

vi.mock('../../../src/app/services/context/context_memory_ports.js', () => ({
  createContextAssemblyPort: vi.fn(() => ({
    getContext: vi.fn(async () => null),
    saveContext: vi.fn(async () => {}),
    listContexts: vi.fn(async () => [])
  }))
}));

vi.mock('../../../src/app/services/mutation/event_evidence_repository.js', () => ({
  getLatestEventEvidenceRecord: vi.fn(async () => null)
}));

vi.mock('../../../src/app/services/pack/pack_runtime_resolution.js', () => ({
  resolvePackTick: vi.fn(() => 1000n)
}));

vi.mock('../../../src/app/services/workflow/workflow_previous_output.js', () => ({
  buildPreviousAgentOutputTemplateScope: vi.fn(() => null)
}));

vi.mock('../../../src/domain/authority/resolver.js', () => ({
  resolveAuthorityForSubject: vi.fn(async () => ({ level: 'agent', granted: true }))
}));

vi.mock('../../../src/packs/runtime/core_models.js', () => ({
  DEFAULT_PACK_WORLD_ENTITY_ID: 'world'
}));

vi.mock('../../../src/packs/storage/entity_state_projection.js', () => ({
  listPackEntityStateProjectionRecords: vi.fn(async () => [])
}));

vi.mock('../../../src/template_engine/frontends/narrative/variable_context.js', () => ({
  createPromptVariableContext: vi.fn(() => ({ layers: [], visible: {} })),
  createPromptVariableContextSummary: vi.fn(() => ({})),
  createPromptVariableLayer: vi.fn(() => ({ id: 'test', variables: {} })),
  flattenPromptVariableContextToVisibleVariables: vi.fn(() => ({})),
  normalizePromptVariableRecord: vi.fn((v: unknown) => v ?? {})
}));

vi.mock('../../../src/inference/context_config.js', () => ({
  getInferenceContextConfig: vi.fn(() => ({
    variable_resolution: { enabled: true },
    authority_resolution: { enabled: true },
    pack_state_projection: { enabled: true },
    event_evidence: { enabled: true }
  }))
}));

vi.mock('../../../src/inference/context_config_resolver.js', () => ({
  resolveConfigValues: vi.fn((config: unknown) => config)
}));

vi.mock('../../../src/inference/pack_scoped_inference_context_builder.js', () => ({
  createPackScopedInferenceContextBuilder: vi.fn(() => ({
    buildContextForPack: vi.fn(async () => null)
  }))
}));

import {
  ACTOR_ENTITY_ID_SEPARATOR,
  packEntityIdFromResolvedAgentId,
  buildInferenceContext,
  createPackScopedInferenceContextBuilder
} from '../../../src/inference/context_builder.js';

describe('context_builder', () => {
  describe('ACTOR_ENTITY_ID_SEPARATOR', () => {
    it('is a colon', () => {
      expect(ACTOR_ENTITY_ID_SEPARATOR).toBe(':');
    });
  });

  describe('packEntityIdFromResolvedAgentId', () => {
    it('returns null for null agent ID', () => {
      expect(packEntityIdFromResolvedAgentId('pack-1', null)).toBeNull();
    });

    it('strips pack prefix from agent ID', () => {
      const result = packEntityIdFromResolvedAgentId('pack-1', 'pack-1:agent-1');
      expect(result).toBe('agent-1');
    });

    it('returns full ID when no prefix match', () => {
      const result = packEntityIdFromResolvedAgentId('pack-1', 'other-agent');
      expect(result).toBe('other-agent');
    });

    it('handles empty pack ID', () => {
      const result = packEntityIdFromResolvedAgentId('', 'agent-1');
      expect(result).toBe('agent-1');
    });

    it('handles agent ID equal to pack ID prefix', () => {
      const result = packEntityIdFromResolvedAgentId('p', 'p:rest');
      expect(result).toBe('rest');
    });
  });

  describe('createPackScopedInferenceContextBuilder', () => {
    it('returns an object', () => {
      const builder = createPackScopedInferenceContextBuilder();
      expect(builder).toBeDefined();
    });
  });
});

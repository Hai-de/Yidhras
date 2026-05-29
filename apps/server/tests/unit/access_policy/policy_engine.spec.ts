import { describe, expect, it } from 'vitest';

import {
  evaluateFieldPolicies,
  normalizeRulesOrder,
  resolveAllowedFields,
  resolveFieldDecision
} from '../../../src/access_policy/policy_engine.js';
import type {
  PolicyMatchInput,
  PolicyRule
} from '../../../src/access_policy/types.js';

function makeRule(overrides: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 'rule-1',
    effect: 'allow',
    resource: 'conversation',
    action: 'read',
    field: '*',
    subject_type: '*',
    priority: 10,
    ...overrides
  };
}

function makeInput(overrides: Partial<PolicyMatchInput> = {}): PolicyMatchInput {
  return {
    identity: { id: 'user-1', type: 'agent', claims: {} },
    resource: 'conversation',
    action: 'read',
    ...overrides
  };
}

describe('access_policy/policy_engine', () => {
  describe('normalizeRulesOrder', () => {
    it('should sort deny rules before allow rules (higher effectRank first)', () => {
      const allow = makeRule({ id: 'allow-1', effect: 'allow', priority: 100 });
      const deny = makeRule({ id: 'deny-1', effect: 'deny', priority: 1 });
      const input = makeInput();
      const result = normalizeRulesOrder([allow, deny], input);
      expect(result[0]!.id).toBe('deny-1');
      expect(result[1]!.id).toBe('allow-1');
    });

    it('should sort exact subject_id match higher than subject_type', () => {
      const byType = makeRule({ id: 'type-match', subject_type: 'agent', priority: 10 });
      const byId = makeRule({ id: 'id-match', subject_id: 'user-1', priority: 1 });
      const input = makeInput();
      const result = normalizeRulesOrder([byType, byId], input);
      expect(result[0]!.id).toBe('id-match');
    });

    it('should sort wildcard subject_type lower than specific subject_type', () => {
      const wildcard = makeRule({ id: 'wild', subject_type: '*', priority: 10 });
      const specific = makeRule({ id: 'spec', subject_type: 'agent', priority: 1 });
      const input = makeInput();
      const result = normalizeRulesOrder([wildcard, specific], input);
      expect(result[0]!.id).toBe('spec');
    });

    it('should sort exact field match higher than prefix and wildcard', () => {
      const wildcard = makeRule({ id: 'all', field: '*', priority: 10 });
      const prefix = makeRule({ id: 'prefix', field: 'body.*', priority: 10 });
      const exact = makeRule({ id: 'exact', field: 'body.text', priority: 10 });
      const input = makeInput();
      const result = normalizeRulesOrder([wildcard, prefix, exact], input);
      expect(result[0]!.id).toBe('exact');
      expect(result[1]!.id).toBe('prefix');
      expect(result[2]!.id).toBe('all');
    });

    it('should use priority as tiebreaker', () => {
      const low = makeRule({ id: 'low', priority: 1 });
      const high = makeRule({ id: 'high', priority: 100 });
      const input = makeInput();
      const result = normalizeRulesOrder([low, high], input);
      expect(result[0]!.id).toBe('high');
    });
  });

  describe('evaluateFieldPolicies', () => {
    it('should return empty map when no rules match', () => {
      const rules = [makeRule({ resource: 'other' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name']);
      expect(result.size).toBe(0);
    });

    it('should evaluate wildcard field rule for all target fields', () => {
      const rules = [makeRule({ field: '*' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name', 'age']);
      expect(result.get('name')!.allow).toBe(true);
      expect(result.get('age')!.allow).toBe(true);
      expect(result.get('*')!.allow).toBe(true);
    });

    it('should evaluate prefix pattern (body.*) matching body.text and body.tags', () => {
      const rules = [makeRule({ field: 'body.*' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['body.text', 'body.tags', 'name']);
      expect(result.get('body.text')!.allow).toBe(true);
      expect(result.get('body.tags')!.allow).toBe(true);
      expect(result.get('name')).toBeUndefined();
    });

    it('should evaluate deny rule overriding allow for a matching field', () => {
      const allow = makeRule({ id: 'allow-all', effect: 'allow', field: '*', priority: 1 });
      const deny = makeRule({ id: 'deny-body', effect: 'deny', field: 'body.text', priority: 10 });
      const result = evaluateFieldPolicies([allow, deny], makeInput(), ['body.text']);
      // deny has higher effectRank so processed first → body.text gets deny
      expect(result.get('body.text')!.allow).toBe(false);
      expect(result.get('body.text')!.effect).toBe('deny');
    });

    it('should skip rules when subject does not match', () => {
      const rules = [makeRule({ subject_id: 'other-user', subject_type: 'system' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name']);
      expect(result.size).toBe(0);
    });

    it('should match on subject_type wildcard', () => {
      const rules = [makeRule({ subject_type: '*' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name']);
      expect(result.get('name')!.allow).toBe(true);
    });

    it('should match on specific subject_type', () => {
      const rules = [makeRule({ subject_type: 'agent' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name']);
      expect(result.get('name')!.allow).toBe(true);
    });

    it('should not match when subject_type differs', () => {
      const rules = [makeRule({ subject_type: 'system' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name']);
      expect(result.size).toBe(0);
    });

    it('should evaluate conditions against identity claims', () => {
      const rules = [makeRule({ conditions: { tier: 'premium' } })];
      const input = makeInput({ identity: { id: 'u1', type: 'agent', claims: { tier: 'premium' } } });
      const result = evaluateFieldPolicies(rules, input, ['name']);
      expect(result.get('name')!.allow).toBe(true);
    });

    it('should reject when conditions do not match', () => {
      const rules = [makeRule({ conditions: { tier: 'premium' } })];
      const input = makeInput({ identity: { id: 'u1', type: 'agent', claims: { tier: 'basic' } } });
      const result = evaluateFieldPolicies(rules, input, ['name']);
      expect(result.size).toBe(0);
    });

    it('should evaluate array conditions (any match)', () => {
      const rules = [makeRule({ conditions: { roles: ['admin', 'moderator'] } })];
      const input = makeInput({ identity: { id: 'u1', type: 'agent', claims: { roles: ['moderator'] } } });
      const result = evaluateFieldPolicies(rules, input, ['name']);
      expect(result.get('name')!.allow).toBe(true);
    });

    it('should reject array conditions when no overlap', () => {
      const rules = [makeRule({ conditions: { roles: ['admin'] } })];
      const input = makeInput({ identity: { id: 'u1', type: 'agent', claims: { roles: ['viewer'] } } });
      const result = evaluateFieldPolicies(rules, input, ['name']);
      expect(result.size).toBe(0);
    });

    it('should pass when conditions is empty', () => {
      const rules = [makeRule({ conditions: {} })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name']);
      expect(result.get('name')!.allow).toBe(true);
    });

    it('should pass when conditions is null', () => {
      const rules = [makeRule({ conditions: null })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['name']);
      expect(result.get('name')!.allow).toBe(true);
    });

    it('should evaluate conditions against attributes input', () => {
      const rules = [makeRule({ conditions: { region: 'cn' } })];
      const input = makeInput({ attributes: { region: 'cn' } });
      const result = evaluateFieldPolicies(rules, input, ['name']);
      expect(result.get('name')!.allow).toBe(true);
    });

    it('should match prefix pattern with exact prefix (body.* matches body)', () => {
      const rules = [makeRule({ field: 'body.*' })];
      const result = evaluateFieldPolicies(rules, makeInput(), ['body']);
      expect(result.get('body')!.allow).toBe(true);
    });
  });

  describe('resolveFieldDecision', () => {
    it('should return existing decision from map', () => {
      const decisions = new Map();
      decisions.set('name', { allow: true, reason: 'allow:rule-1', ruleId: 'rule-1', effect: 'allow', matchedPattern: '*' });
      const result = resolveFieldDecision('name', decisions);
      expect(result.allow).toBe(true);
    });

    it('should return default deny when field not in map', () => {
      const decisions = new Map();
      const result = resolveFieldDecision('missing', decisions);
      expect(result.allow).toBe(false);
      expect(result.reason).toBe('default_deny');
    });
  });

  describe('resolveAllowedFields', () => {
    it('should return only allowed fields', () => {
      const decisions = new Map();
      decisions.set('name', { allow: true, reason: 'ok', effect: 'allow', matchedPattern: '*' });
      decisions.set('secret', { allow: false, reason: 'deny', effect: 'deny', matchedPattern: 'secret' });
      const result = resolveAllowedFields(['name', 'secret', 'missing'], decisions);
      expect(result.has('name')).toBe(true);
      expect(result.has('secret')).toBe(false);
      expect(result.has('missing')).toBe(false);
    });

    it('should return empty set when no fields allowed', () => {
      const decisions = new Map();
      const result = resolveAllowedFields(['a', 'b'], decisions);
      expect(result.size).toBe(0);
    });
  });
});

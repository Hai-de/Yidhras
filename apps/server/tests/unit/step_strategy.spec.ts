import { stepStrategyRangeSchema, stepStrategySchema } from '@yidhras/contracts';
import { describe, expect, it } from 'vitest';

describe('StepStrategy types and schemas', () => {
  describe('stepStrategySchema', () => {
    it('parses valid variable strategy', () => {
      const result = stepStrategySchema.parse({
        kind: 'variable',
        range: { min: '1', max: '10' }
      });
      expect(result.kind).toBe('variable');
      expect(result.range.min).toBe('1');
      expect(result.range.max).toBe('10');
    });

    it('parses valid adaptive strategy', () => {
      const result = stepStrategySchema.parse({
        kind: 'adaptive',
        range: { min: '1', max: '100' },
        adaptive: {
          target_loop_ms: 500,
          scale_up_threshold_ms: 300,
          scale_down_threshold_ms: 800
        }
      });
      expect(result.kind).toBe('adaptive');
      expect(result.adaptive?.target_loop_ms).toBe(500);
    });

    it('rejects adaptive kind without adaptive config', () => {
      expect(() =>
        stepStrategySchema.parse({
          kind: 'adaptive',
          range: { min: '1', max: '100' }
        })
      ).toThrow();
    });

    it('parses variable strategy with optional loop_interval_ms', () => {
      const result = stepStrategySchema.parse({
        kind: 'variable',
        range: { min: '1', max: '5' },
        loop_interval_ms: 500
      });
      expect(result.loop_interval_ms).toBe(500);
    });

    it('rejects unknown kind', () => {
      expect(() =>
        stepStrategySchema.parse({
          kind: 'unknown',
          range: { min: '1', max: '10' }
        })
      ).toThrow();
    });
  });

  describe('stepStrategyRangeSchema', () => {
    it('parses valid range', () => {
      const result = stepStrategyRangeSchema.parse({ min: '1', max: '100' });
      expect(result.min).toBe('1');
      expect(result.max).toBe('100');
    });

    it('rejects negative min', () => {
      expect(() => stepStrategyRangeSchema.parse({ min: '-1', max: '100' })).toThrow();
    });

    it('rejects zero min', () => {
      expect(() => stepStrategyRangeSchema.parse({ min: '0', max: '100' })).toThrow();
    });
  });
});

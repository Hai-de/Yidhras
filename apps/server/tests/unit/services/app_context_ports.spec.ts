import { describe, expect, it, vi } from 'vitest';

import {
  getPackHostApi,
  getPackRuntimeControl,
  getPackRuntimeLookupPort,
  getPackRuntimeObservation,
  getRuntimeBootstrap,
  getWorldEnginePort,
  hasPackHostApi,
  hasWorldEnginePort,
  readVisibleClockSnapshot
} from '../../../src/app/services/app_context_ports.js';

describe('app_context_ports', () => {
  describe('getRuntimeBootstrap', () => {
    it('returns the port when provided', () => {
      const port = { init: vi.fn() };
      expect(getRuntimeBootstrap({ runtimeBootstrap: port } as unknown as Parameters<typeof getRuntimeBootstrap>[0])).toBe(port);
    });

    it('throws when not provided', () => {
      expect(() => getRuntimeBootstrap({})).toThrow(/runtimeBootstrap port is required/);
    });
  });

  describe('getPackRuntimeObservation', () => {
    it('returns the port when provided', () => {
      const port = { observe: vi.fn() };
      expect(getPackRuntimeObservation({ packRuntimeObservation: port } as unknown as Parameters<typeof getPackRuntimeObservation>[0])).toBe(port);
    });

    it('throws when not provided', () => {
      expect(() => getPackRuntimeObservation({})).toThrow(/packRuntimeObservation port is required/);
    });
  });

  describe('getPackRuntimeControl', () => {
    it('returns the port when provided', () => {
      const port = { control: vi.fn() };
      expect(getPackRuntimeControl({ packRuntimeControl: port } as unknown as Parameters<typeof getPackRuntimeControl>[0])).toBe(port);
    });

    it('throws when not provided', () => {
      expect(() => getPackRuntimeControl({})).toThrow(/packRuntimeControl port is required/);
    });
  });

  describe('getPackRuntimeLookupPort', () => {
    it('returns the port when provided', () => {
      const port = { hasPackRuntime: vi.fn() };
      expect(getPackRuntimeLookupPort({ packRuntimeLookup: port } as unknown as Parameters<typeof getPackRuntimeLookupPort>[0])).toBe(port);
    });

    it('throws when not provided', () => {
      expect(() => getPackRuntimeLookupPort({})).toThrow(/packRuntimeLookup port is required/);
    });
  });

  describe('getWorldEnginePort', () => {
    it('returns the port when provided', () => {
      const port = { world: vi.fn() };
      expect(getWorldEnginePort({ worldEngine: port } as unknown as Parameters<typeof getWorldEnginePort>[0])).toBe(port);
    });

    it('throws when not provided', () => {
      expect(() => getWorldEnginePort({})).toThrow(/worldEngine port is required/);
    });
  });

  describe('getPackHostApi', () => {
    it('returns the port when provided', () => {
      const port = { api: vi.fn() };
      expect(getPackHostApi({ packHostApi: port } as unknown as Parameters<typeof getPackHostApi>[0])).toBe(port);
    });

    it('throws when not provided', () => {
      expect(() => getPackHostApi({})).toThrow(/packHostApi port is required/);
    });
  });

  describe('hasWorldEnginePort', () => {
    it('returns true when worldEngine is present', () => {
      expect(hasWorldEnginePort({ worldEngine: {} } as unknown as Parameters<typeof hasWorldEnginePort>[0])).toBe(true);
    });

    it('returns false when worldEngine is absent', () => {
      expect(hasWorldEnginePort({})).toBe(false);
    });

    it('returns false when worldEngine is undefined', () => {
      expect(hasWorldEnginePort({ worldEngine: undefined })).toBe(false);
    });
  });

  describe('hasPackHostApi', () => {
    it('returns true when packHostApi is present', () => {
      expect(hasPackHostApi({ packHostApi: {} } as unknown as Parameters<typeof hasPackHostApi>[0])).toBe(true);
    });

    it('returns false when packHostApi is absent', () => {
      expect(hasPackHostApi({})).toBe(false);
    });
  });

  describe('readVisibleClockSnapshot', () => {
    it('returns fallback when no projection service provided', () => {
      const result = readVisibleClockSnapshot({});
      expect(result).toEqual({
        absolute_ticks: '0',
        calendars: [],
        source: 'clock_fallback'
      });
    });

    it('returns host_projection when projection has data for packId', () => {
      const projection = {
        readFormattedClock: vi.fn().mockReturnValue({
          absolute_ticks: '42',
          calendars: [{ name: 'Imperial' }]
        }),
        getKnownPackIds: vi.fn().mockReturnValue(['pack-1'])
      };
      const result = readVisibleClockSnapshot({
        runtimeClockProjection: projection as unknown as NonNullable<Parameters<typeof readVisibleClockSnapshot>[0]['runtimeClockProjection']>,
        packId: 'pack-1'
      });
      expect(result).toEqual({
        absolute_ticks: '42',
        calendars: [{ name: 'Imperial' }],
        source: 'host_projection'
      });
    });

    it('returns fallback when projection has no data for packId', () => {
      const projection = {
        readFormattedClock: vi.fn().mockReturnValue(null),
        getKnownPackIds: vi.fn().mockReturnValue([])
      };
      const result = readVisibleClockSnapshot({
        runtimeClockProjection: projection as unknown as NonNullable<Parameters<typeof readVisibleClockSnapshot>[0]['runtimeClockProjection']>,
        packId: 'pack-1'
      });
      expect(result).toEqual({
        absolute_ticks: '0',
        calendars: [],
        source: 'clock_fallback'
      });
    });

    it('iterates known pack ids when no packId specified', () => {
      const projection = {
        readFormattedClock: vi.fn()
          .mockReturnValueOnce(null)
          .mockReturnValueOnce({
            absolute_ticks: '100',
            calendars: []
          }),
        getKnownPackIds: vi.fn().mockReturnValue(['pack-a', 'pack-b'])
      };
      const result = readVisibleClockSnapshot({
        runtimeClockProjection: projection as unknown as NonNullable<Parameters<typeof readVisibleClockSnapshot>[0]['runtimeClockProjection']>
      });
      expect(result.source).toBe('host_projection');
      expect(result.absolute_ticks).toBe('100');
    });

    it('returns fallback when all known packs have no projection', () => {
      const projection = {
        readFormattedClock: vi.fn().mockReturnValue(null),
        getKnownPackIds: vi.fn().mockReturnValue(['pack-a', 'pack-b'])
      };
      const result = readVisibleClockSnapshot({
        runtimeClockProjection: projection as unknown as NonNullable<Parameters<typeof readVisibleClockSnapshot>[0]['runtimeClockProjection']>
      });
      expect(result).toEqual({
        absolute_ticks: '0',
        calendars: [],
        source: 'clock_fallback'
      });
    });
  });
});

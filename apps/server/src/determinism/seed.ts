import crypto from 'node:crypto';

export type SeedPart = string | number | bigint | boolean | null | undefined;

const normalizeSeedPart = (part: SeedPart): string => {
  if (part === null) {
    return '<null>';
  }
  if (part === undefined) {
    return '<undefined>';
  }
  if (typeof part === 'bigint') {
    return `${part.toString()}n`;
  }
  return String(part);
};

const lengthPrefix = (value: string): string => `${value.length}:${value}`;

export const normalizeBaseSeed = (seed: string | null | undefined, fallback: string): string => {
  const trimmed = seed?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

export const deriveSeed = (baseSeed: string, ...parts: SeedPart[]): string => {
  const normalized = [baseSeed, ...parts.map(normalizeSeedPart)].map(lengthPrefix).join('|');
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return `${baseSeed}#${digest}`;
};

export const createDefaultPackSeed = (packId: string): string => `pack:${packId}`;

import type { PrismaClient } from '@prisma/client';

import { getSqliteRuntimeConfig } from '../config/runtime_config.js';

export interface SqliteRuntimePragmaSnapshot {
  journal_mode: string;
  busy_timeout: number;
  synchronous: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA' | 'UNKNOWN';
  foreign_keys: boolean;
  wal_autocheckpoint: number;
}

const normalizeInteger = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const normalizeString = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  return fallback;
};

const readPragmaValue = async (prisma: PrismaClient, statement: string): Promise<unknown> => {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(statement);
  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  const firstRow = rows[0] ?? null;
  if (!firstRow || typeof firstRow !== 'object') {
    return null;
  }

  return Object.values(firstRow)[0] ?? null;
};

const runPragma = async (prisma: PrismaClient, statement: string): Promise<void> => {
  await prisma.$queryRawUnsafe(statement);
};

const normalizeSynchronousValue = (value: unknown): SqliteRuntimePragmaSnapshot['synchronous'] => {
  const normalized = normalizeInteger(value, -1);
  switch (normalized) {
    case 0:
      return 'OFF';
    case 1:
      return 'NORMAL';
    case 2:
      return 'FULL';
    case 3:
      return 'EXTRA';
    default:
      return 'UNKNOWN';
  }
};

export const readSqliteRuntimePragmas = async (prisma: PrismaClient): Promise<SqliteRuntimePragmaSnapshot> => {
  const [journalMode, busyTimeout, synchronous, foreignKeys, walAutocheckpoint] = await Promise.all([
    readPragmaValue(prisma, 'PRAGMA journal_mode;'),
    readPragmaValue(prisma, 'PRAGMA busy_timeout;'),
    readPragmaValue(prisma, 'PRAGMA synchronous;'),
    readPragmaValue(prisma, 'PRAGMA foreign_keys;'),
    readPragmaValue(prisma, 'PRAGMA wal_autocheckpoint;')
  ]);

  return {
    journal_mode: normalizeString(journalMode, 'unknown').toLowerCase(),
    busy_timeout: normalizeInteger(busyTimeout, 0),
    synchronous: normalizeSynchronousValue(synchronous),
    foreign_keys: normalizeInteger(foreignKeys, 0) === 1,
    wal_autocheckpoint: normalizeInteger(walAutocheckpoint, 0)
  };
};

export const applySqliteRuntimePragmas = async (prisma: PrismaClient): Promise<SqliteRuntimePragmaSnapshot> => {
  const config = getSqliteRuntimeConfig();
  const busyTimeoutMs = config.busy_timeout_ms;
  const walAutocheckpointPages = config.wal_autocheckpoint_pages;
  const synchronousMode = config.synchronous;

  await runPragma(prisma, 'PRAGMA journal_mode = WAL;');
  await runPragma(prisma, `PRAGMA busy_timeout = ${busyTimeoutMs};`);
  await runPragma(prisma, `PRAGMA synchronous = ${synchronousMode};`);
  await runPragma(prisma, 'PRAGMA foreign_keys = ON;');
  await runPragma(prisma, `PRAGMA wal_autocheckpoint = ${walAutocheckpointPages};`);

  return readSqliteRuntimePragmas(prisma);
};

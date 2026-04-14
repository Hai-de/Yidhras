import { isRecord } from './server.js';

export const assertRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${label} should be an object`);
  }

  return value;
};

export const assertSuccessEnvelopeData = (body: unknown, label: string): Record<string, unknown> => {
  const envelope = assertRecord(body, `${label} envelope`);
  if (envelope.success !== true) {
    throw new Error(`${label} should return success=true`);
  }

  return assertRecord(envelope.data, `${label}.data`);
};

export const assertSuccessEnvelopeArrayData = (body: unknown, label: string): Record<string, unknown>[] => {
  const envelope = assertRecord(body, `${label} envelope`);
  if (envelope.success !== true) {
    throw new Error(`${label} should return success=true`);
  }

  if (!Array.isArray(envelope.data)) {
    throw new Error(`${label}.data should be an array`);
  }

  return envelope.data.map((item, index) => assertRecord(item, `${label}.data[${String(index)}]`));
};

export const assertErrorEnvelope = (body: unknown, expectedCode: string, label: string): Record<string, unknown> => {
  const envelope = assertRecord(body, `${label} envelope`);
  if (envelope.success !== false) {
    throw new Error(`${label} should return success=false`);
  }

  const error = assertRecord(envelope.error, `${label}.error`);
  if (error.code !== expectedCode) {
    throw new Error(`${label}.error.code should be ${expectedCode}`);
  }

  return error;
};

export const assertArrayField = (value: Record<string, unknown>, field: string, label: string): unknown[] => {
  const result = value[field];
  if (!Array.isArray(result)) {
    throw new Error(`${label}.${field} should be an array`);
  }

  return result;
};

export const assertStringArrayField = (value: Record<string, unknown>, field: string, label: string): string[] => {
  const result = assertArrayField(value, field, label);
  if (result.some(item => typeof item !== 'string')) {
    throw new Error(`${label}.${field} should be a string array`);
  }

  return result as string[];
};

export const assertPaginationMeta = (body: unknown, label: string): Record<string, unknown> => {
  const envelope = assertRecord(body, `${label} envelope`);
  const meta = assertRecord(envelope.meta, `${label}.meta`);
  return assertRecord(meta.pagination, `${label}.meta.pagination`);
};

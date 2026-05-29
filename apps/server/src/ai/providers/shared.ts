// Shared utility functions for AI provider adapters.

export { isRecord } from '../../utils/type_guards.js';

export const getEnv = (name: string | null | undefined): string | null => {
  if (!name) {
    return null;
  }

  // eslint-disable-next-line security/detect-object-injection
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  return value.trim();
};

export const mapMessageRole = (role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'): 'system' | 'user' | 'assistant' | 'tool' => {
  if (role === 'developer') {
    return 'system';
  }

  if (role === 'system' || role === 'assistant' || role === 'tool') {
    return role;
  }

  return 'user';
};

export const encodeMessageText = (message: { parts: { type: string; text?: string; json?: Record<string, unknown>; url?: string; file_id?: string }[] }): string => {
  return message.parts
    .map(part => {
      switch (part.type) {
        case 'text':
          return part.text ?? '';
        case 'json':
          return part.json ? JSON.stringify(part.json, null, 2) : '';
        case 'image_url':
          return `[image] ${part.url ?? ''}`;
        case 'file_ref':
          return `[file:${part.file_id ?? ''}]`;
        default:
          return '';
      }
    })
    .filter(text => text.trim().length > 0)
    .join('\n\n');
};

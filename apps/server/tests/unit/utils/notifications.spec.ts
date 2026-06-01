import { describe, expect, it } from 'vitest';

import { createNotificationManager } from '../../../src/utils/notifications.js';

describe('NotificationManager', () => {
  it('pushes info messages', () => {
    const manager = createNotificationManager();
    const msg = manager.push('info', 'test message');
    expect(msg.level).toBe('info');
    expect(msg.content).toBe('test message');
    expect(msg.id).toBeDefined();
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('pushes warning messages', () => {
    const manager = createNotificationManager();
    const msg = manager.push('warning', 'warn msg', 'W001');
    expect(msg.level).toBe('warning');
    expect(msg.code).toBe('W001');
  });

  it('pushes error messages', () => {
    const manager = createNotificationManager();
    const msg = manager.push('error', 'err msg', 'E001', { stack: 'trace' });
    expect(msg.level).toBe('error');
    expect(msg.details).toEqual({ stack: 'trace' });
  });

  it('returns messages in reverse chronological order', () => {
    const manager = createNotificationManager();
    manager.push('info', 'first');
    manager.push('info', 'second');
    const messages = manager.getMessages();
    expect(messages[0].content).toBe('second');
    expect(messages[1].content).toBe('first');
  });

  it('limits messages to MAX_MESSAGES (200)', () => {
    const manager = createNotificationManager();
    for (let i = 0; i < 210; i++) {
      manager.push('info', `msg-${i}`);
    }
    expect(manager.getMessages().length).toBe(200);
    // The most recent message should be first
    expect(manager.getMessages()[0].content).toBe('msg-209');
  });

  it('clears all messages', () => {
    const manager = createNotificationManager();
    manager.push('info', 'msg1');
    manager.push('info', 'msg2');
    manager.clear();
    expect(manager.getMessages()).toEqual([]);
  });

  it('omits details when not provided', () => {
    const manager = createNotificationManager();
    const msg = manager.push('info', 'no details');
    expect(msg).not.toHaveProperty('details');
  });

  it('includes details when provided', () => {
    const manager = createNotificationManager();
    const msg = manager.push('info', 'with details', undefined, { key: 'value' });
    expect(msg.details).toEqual({ key: 'value' });
  });

  it('generates unique ids for each message', () => {
    const manager = createNotificationManager();
    const msg1 = manager.push('info', 'a');
    const msg2 = manager.push('info', 'b');
    expect(msg1.id).not.toBe(msg2.id);
  });
});

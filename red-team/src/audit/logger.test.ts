import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AuditLogger } from './logger.js';

describe('AuditLogger', () => {
  const root = join(tmpdir(), `audit-test-${Date.now()}`);

  it('logs and retrieves entries', async () => {
    const logger = new AuditLogger(root);
    const entry = await logger.log({
      kind: 'policy-decision',
      detail: { hostname: 'example.com', action: 'allow' },
    });
    expect(entry.id).toMatch(/^aud_/);
    expect(entry.timestamp).toBeTruthy();
    expect(entry.kind).toBe('policy-decision');
    expect(entry.detail).toEqual({ hostname: 'example.com', action: 'allow' });
  });

  it('counts entries', async () => {
    const logger = new AuditLogger(root);
    const count = await logger.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('lists entries with optional since filter', async () => {
    const logger = new AuditLogger(root);
    const all = await logger.list();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const future = await logger.list('2099-01-01T00:00:00.000Z');
    expect(future.length).toBe(0);
  });
});

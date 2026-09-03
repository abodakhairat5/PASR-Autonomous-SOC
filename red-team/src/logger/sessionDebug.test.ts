import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionDebugLog } from './sessionDebug.js';

describe('session debug log', () => {
  it('writes JSONL events with session metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-debug-'));
    const path = join(dir, 'session.jsonl');
    const log = createSessionDebugLog({ enabled: true, path, sessionID: 'abc123' });

    log.write('session_start', { cwd: '/tmp/project' });
    log.agentEvent({ type: 'assistant-text', text: 'hello' });

    const lines = readFileSync(path, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      seq: 1,
      event: 'session_start',
      session_id: 'abc123',
      cwd: '/tmp/project',
    });
    expect(lines[1]).toMatchObject({
      seq: 2,
      event: 'agent_event',
      session_id: 'abc123',
      type: 'assistant-text',
      text: 'hello',
    });
  });

  it('serializes agent errors into JSON-safe objects', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pf-debug-'));
    const path = join(dir, 'session.jsonl');
    const log = createSessionDebugLog({ enabled: true, path, sessionID: 'abc123' });

    log.agentEvent({ type: 'error', err: new Error('boom') });

    const line = JSON.parse(readFileSync(path, 'utf8')) as { err: { message: string } };
    expect(line.err.message).toBe('boom');
  });

  it('is a no-op when disabled', () => {
    const log = createSessionDebugLog({ enabled: false, sessionID: 'abc123' });
    expect(log.enabled).toBe(false);
    expect(() => log.write('ignored')).not.toThrow();
  });
});

// Browser MCP session-only behavior: never auto-enabled, only present
// when --browser is passed, stale persisted entries stripped.

import { describe, expect, it } from 'vitest';
import type { MCPServerConfig } from '../config/config.js';
import { sessionMcpServers } from './mcpServers.js';

const other: MCPServerConfig = { name: 'other', command: 'foo', args: [] };
const staleBrowser: MCPServerConfig = { name: 'browser', command: 'npx', args: ['old'] };

describe('sessionMcpServers', () => {
  it('adds no browser server when the flag is off', () => {
    expect(sessionMcpServers([], false)).toEqual([]);
    expect(sessionMcpServers([other], false)).toEqual([other]);
  });

  it('appends exactly one browser server when the flag is on', () => {
    const out = sessionMcpServers([], true);
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe('browser');
    expect(out[0]?.command).toBe('npx');
  });

  it('strips a stale persisted browser entry when the flag is off', () => {
    expect(sessionMcpServers([other, staleBrowser], false)).toEqual([other]);
  });

  it('replaces a stale browser entry (no duplicate) when the flag is on', () => {
    const out = sessionMcpServers([other, staleBrowser], true);
    expect(out.filter((s) => s.name === 'browser')).toHaveLength(1);
    expect(out[0]).toEqual(other);
    expect(out.at(-1)?.args).toEqual(['-y', '@browsermcp/mcp@latest']);
  });

  it('does not mutate its input', () => {
    const input: MCPServerConfig[] = [other];
    sessionMcpServers(input, true);
    expect(input).toEqual([other]);
  });
});

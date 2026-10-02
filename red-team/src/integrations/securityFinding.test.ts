// Tests for the Blue Team MCP submission integration: SecurityFinding
// contract validation, conversion from the Red Team Finding model, MCP
// client init/discovery, a successful submit_security_finding call via
// mock session, and every required failure mode (server unavailable,
// invalid finding, oversized evidence/payload, no server configured).

import { describe, expect, it } from 'vitest';
import type { MCPServerConfig } from '../config/config.js';
import type { Finding } from '../findings/store.js';
import type { MCPSession } from '../tools/mcp.js';
import {
  type SecurityFinding,
  SUBMIT_TOOL_NAME,
  buildSubmitArgs,
  redTeamFindingId,
  submitSecurityFinding,
  toSecurityFinding,
  validateSecurityFinding,
} from './securityFinding.js';

const SERVER: MCPServerConfig = {
  name: 'blue-team',
  command: 'fake-blue-team-server',
  args: [],
};

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    title: 'SQL Injection on /api/login',
    severity: 'high',
    url: 'https://app.example.com/api/login?user=admin',
    parameter: 'user',
    payload: "' OR 1=1 --",
    method: 'POST',
    responseExcerpt: 'HTTP/1.1 200 OK ... stack trace leaked',
    impact: 'Attacker can bypass authentication.',
    curl: 'curl -X POST https://app.example.com/api/login -d "user=admin"',
    remediation: 'Use parameterized queries.',
    createdAt: '2026-09-03T16:20:00.000Z',
    slug: 'sql-injection',
    findingId: 'finding-123',
    status: 'confirmed',
    evidenceIds: ['ev_abc'],
    ...overrides,
  };
}

/** A fake MCP session with the same shape as the real one. */
function fakeSession(overrides: Partial<MCPSession> = {}): MCPSession {
  return {
    serverName: 'blue-team',
    isClosed: () => false,
    listTools: async () => [
      {
        name: SUBMIT_TOOL_NAME,
        description: 'Submit a security finding',
        inputSchema: { type: 'object', properties: { finding: { type: 'object' } } },
      },
    ],
    callTool: async () => ({ isError: false, content: [{ type: 'text', text: 'accepted' }] }),
    close: async () => undefined,
    ...overrides,
  } as unknown as MCPSession;
}

describe('SecurityFinding contract', () => {
  it('accepts a valid SecurityFinding', () => {
    const res = validateSecurityFinding(toSecurityFinding(sampleFinding()));
    expect(res.ok).toBe(true);
    expect(res.finding?.finding_id).toBe('RT-finding-123');
    expect(res.finding?.source).toBe('red_team');
    expect(res.finding?.severity).toBe('high');
  });

  it('requires the core fields', () => {
    const res = validateSecurityFinding({});
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/finding_id/),
        expect.stringMatching(/source/),
        expect.stringMatching(/title/),
        expect.stringMatching(/severity/),
        expect.stringMatching(/target/),
        expect.stringMatching(/impact/),
        expect.stringMatching(/timestamp/),
      ]),
    );
  });

  it('rejects invalid severity and source', () => {
    const badSeverity = validateSecurityFinding({
      ...toSecurityFinding(sampleFinding()),
      severity: 'severe',
    });
    expect(badSeverity.ok).toBe(false);
    expect(badSeverity.errors?.[0]).toMatch(/severity/);

    const badSource = validateSecurityFinding({
      ...toSecurityFinding(sampleFinding()),
      source: 'attackers',
    });
    expect(badSource.ok).toBe(false);
    expect(badSource.errors?.[0]).toMatch(/source/);
  });

  it('rejects malformed target URL', () => {
    const bad = validateSecurityFinding({
      ...toSecurityFinding(sampleFinding()),
      target: { url: 'not-a-url' },
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors?.[0]).toMatch(/target.url/);
  });

  it('rejects finding_id not in the RT- namespace', () => {
    const bad = validateSecurityFinding({
      ...toSecurityFinding(sampleFinding()),
      finding_id: 'FUZZ-1',
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors?.[0]).toMatch(/RT-/);
  });
});

describe('Finding -> SecurityFinding conversion', () => {
  it('maps all present fields and preserves the id namespace', () => {
    const f = sampleFinding();
    const sf = toSecurityFinding(f);
    expect(sf.finding_id).toBe('RT-finding-123');
    expect(sf.title).toBe('SQL Injection on /api/login');
    expect(sf.severity).toBe('high');
    expect(sf.target.url).toBe('https://app.example.com/api/login?user=admin');
    expect(sf.endpoint).toBe('/api/login');
    expect(sf.method).toBe('POST');
    expect(sf.parameter).toBe('user');
    expect(sf.payload).toBe("' OR 1=1 --");
    expect(sf.evidence?.response_excerpt).toBe(
      'HTTP/1.1 200 OK ... stack trace leaked',
    );
    expect(sf.evidence?.curl).toContain('curl -X POST');
    expect(sf.impact).toBe('Attacker can bypass authentication.');
    expect(sf.remediation).toBe('Use parameterized queries.');
    expect(sf.timestamp).toBe('2026-09-03T16:20:00.000Z');
  });

  it('leaves optional fields undefined when the finding lacks them', () => {
    const f = sampleFinding({
      parameter: undefined,
      payload: undefined,
      method: undefined,
      responseExcerpt: undefined,
      curl: undefined,
      remediation: undefined,
    });
    const sf = toSecurityFinding(f);
    expect(sf.endpoint).toBeDefined(); // derived from URL, not fabricated data
    expect(sf.method).toBeUndefined();
    expect(sf.parameter).toBeUndefined();
    expect(sf.payload).toBeUndefined();
    expect(sf.evidence?.response_excerpt).toBeUndefined();
    expect(sf.evidence?.curl).toBeUndefined();
    expect(sf.remediation).toBeUndefined();
  });

  it('generates an RT- id when the finding has none and falls back to a valid timestamp', () => {
    const f = sampleFinding({ findingId: undefined, createdAt: 'garbage' });
    const sf = toSecurityFinding(f);
    expect(sf.finding_id).toMatch(/^RT-finding-\d+$/);
    expect(Number.isNaN(Date.parse(sf.timestamp))).toBe(false);
  });
});

describe('submit argument building', () => {
  it('wraps under `finding` when discovery declares an object property', () => {
    const sf = toSecurityFinding(sampleFinding());
    const args = buildSubmitArgs(
      { type: 'object', properties: { finding: { type: 'object' } } },
      sf,
    );
    expect('finding' in args).toBe(true);
    expect(args.finding).toEqual(sf);
  });

  it('passes flattened contract fields when the schema expects them at top level', () => {
    const sf = toSecurityFinding(sampleFinding());
    const args = buildSubmitArgs(
      {
        type: 'object',
        properties: { finding_id: { type: 'string' }, title: { type: 'string' } },
      },
      sf,
    );
    expect(args.finding_id).toBe(sf.finding_id);
    expect(args.title).toBe(sf.title);
  });

  it('falls back to wrapping under `finding` with no usable schema', () => {
    const sf = toSecurityFinding(sampleFinding());
    expect(buildSubmitArgs(undefined, sf)).toEqual({ finding: sf });
  });
});

describe('submitSecurityFinding', () => {
  it('returns a clean no-op when submission is disabled', async () => {
    const sessionProvider = () => {
      throw new Error('should not open');
    };
    const res = await submitSecurityFinding(sampleFinding(), {
      enabled: false,
      server: SERVER,
      sessionProvider,
    });
    expect(res.submitted).toBe(false);
    expect(res.error).toContain('disabled');
    expect(res.transport).toBe('mcp');
    expect(res.tool).toBe(SUBMIT_TOOL_NAME);
  });

  it('returns a clean no-op when no blue team server is configured', async () => {
    const sessionProvider = () => {
      throw new Error('should not open');
    };
    const res = await submitSecurityFinding(sampleFinding(), {
      enabled: true,
      sessionProvider,
    });
    expect(res.submitted).toBe(false);
    expect(res.error).toContain('no blue team MCP server configured');
  });

  it('initializes the MCP client session with the configured server', async () => {
    let openedWith: MCPServerConfig | undefined;
    let listed = false;
    const session = fakeSession({
      listTools: async () => {
        listed = true;
        return [];
      },
    });
    const sessionProvider = async (server: MCPServerConfig) => {
      openedWith = server;
      return session;
    };
    await submitSecurityFinding(sampleFinding(), {
      enabled: true,
      server: SERVER,
      sessionProvider,
    });
    expect(openedWith).toEqual(SERVER);
    expect(listed).toBe(true);
  });

  it('submits successfully via a mock MCP session', async () => {
    let calledName = '';
    let calledArgs: Record<string, unknown> | undefined;
    const session = fakeSession({
      callTool: async (name: string, args: Record<string, unknown>) => {
        calledName = name;
        calledArgs = args;
        return { isError: false, content: [{ type: 'text', text: 'finding RT-finding-123 queued' }] };
      },
    });
    const res = await submitSecurityFinding(sampleFinding(), {
      enabled: true,
      server: SERVER,
      sessionProvider: async () => session,
    });
    expect(res.submitted).toBe(true);
    expect(res.tool).toBe(SUBMIT_TOOL_NAME);
    expect(res.finding_id).toBe('RT-finding-123');
    expect(res.message).toBe('finding RT-finding-123 queued');
    expect(calledName).toBe(SUBMIT_TOOL_NAME);
    expect((calledArgs?.finding as SecurityFinding).finding_id).toBe('RT-finding-123');
  });

  it('returns an error when the server does not expose submit_security_finding', async () => {
    const session = fakeSession({ listTools: async () => [{ name: 'other_tool' }] });
    const res = await submitSecurityFinding(sampleFinding(), {
      enabled: true,
      server: SERVER,
      sessionProvider: async () => session,
    });
    expect(res.submitted).toBe(false);
    expect(res.error).toContain('does not expose submit_security_finding');
  });

  it('does not crash when the MCP server is unavailable', async () => {
    const res = await submitSecurityFinding(sampleFinding(), {
      enabled: true,
      server: SERVER,
      sessionProvider: async () => {
        throw new Error('connection refused');
      },
    });
    expect(res.submitted).toBe(false);
    expect(res.error).toContain('connection refused');
  });

  it('rejects an invalid finding before connecting to the server', async () => {
    const findings = sampleFinding({ severity: 'severe' as Finding['severity'] });
    const sessionProvider = () => {
      throw new Error('scope reached MCP — invalid finding must be caught earlier');
    };
    const res = await submitSecurityFinding(findings, {
      enabled: true,
      server: SERVER,
      sessionProvider,
    });
    expect(res.submitted).toBe(false);
    expect(res.error).toContain('invalid security finding');
  });

  it('rejects oversized payload and evidence during validation', () => {
    const hugePayload = 'A'.repeat(70 * 1024);
    const big = validateSecurityFinding({ ...toSecurityFinding(sampleFinding()), payload: hugePayload });
    expect(big.ok).toBe(false);
    expect(big.errors?.[0]).toMatch(/payload/);

    const hugeExcerpt = 'B'.repeat(10 * 1024);
    const excerpt = validateSecurityFinding({
      ...toSecurityFinding(sampleFinding()),
      evidence: { response_excerpt: hugeExcerpt },
    });
    expect(excerpt.ok).toBe(false);
    expect(excerpt.errors?.[0]).toMatch(/response_excerpt/);
  });

  it('propagates the server error result when isError is set', async () => {
    const session = fakeSession({
      callTool: async () => ({
        isError: true,
        content: [{ type: 'text', text: 'Error: rejected' }],
      }),
    });
    const res = await submitSecurityFinding(sampleFinding(), {
      enabled: true,
      server: SERVER,
      sessionProvider: async () => session,
    });
    expect(res.submitted).toBe(false);
    expect(res.error).toContain('rejected');
  });
});

describe('redTeamFindingId', () => {
  it('normalizes a non-RT id into the RT namespace', () => {
    expect(redTeamFindingId(sampleFinding())).toBe('RT-finding-123');
  });

  it('keeps an already-RT id as-is', () => {
    expect(redTeamFindingId(sampleFinding({ findingId: 'RT-42' }))).toBe('RT-42');
  });
});
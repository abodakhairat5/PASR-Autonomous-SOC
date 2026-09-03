import { describe, expect, it } from 'vitest';
import { EngagementScope, Target } from './target.js';

describe('Target scope extension', () => {
  it('backward compat: old JSON without scope still loads', () => {
    const old = { baseURL: 'http://127.0.0.1:3000', name: 'lab' };
    const t = Target.fromJSON(old);
    expect(t.baseURL()).toBe('http://127.0.0.1:3000');
    expect(t.name()).toBe('lab');
    expect(t.scope()).toEqual({});
  });

  it('backward compat: toJSON without scope omits scope field', () => {
    const t = Target.fromJSON({ baseURL: 'http://x', name: 'y' });
    const json = t.toJSON();
    expect(json.baseURL).toBe('http://x');
    expect(json.name).toBe('y');
    expect(json.scope).toBeUndefined();
  });

  it('loads scope from JSON', () => {
    const raw = {
      baseURL: 'https://example.com',
      name: 'target',
      scope: {
        allowedDomains: ['example.com', '*.api.example.com'],
        allowedIPs: ['203.0.113.1'],
        allowedCIDRs: ['203.0.113.0/24'],
        allowedPorts: [80, 443, 8080],
        allowedProtocols: ['https'],
        mode: 'AUTHORIZED_REMOTE',
        authorization: {
          operator: 'pentester',
          authorizedAt: '2026-01-01T00:00:00Z',
          expiresAt: '2026-12-31T23:59:59Z',
          reference: 'AUTH-001',
        },
        rateLimit: {
          requestsPerSecond: 10,
          requestsPerMinute: 100,
          burst: 20,
        },
      },
    };
    const t = Target.fromJSON(raw);
    expect(t.scope().allowedDomains).toEqual(['example.com', '*.api.example.com']);
    expect(t.scope().allowedIPs).toEqual(['203.0.113.1']);
    expect(t.scope().allowedCIDRs).toEqual(['203.0.113.0/24']);
    expect(t.scope().allowedPorts).toEqual([80, 443, 8080]);
    expect(t.scope().allowedProtocols).toEqual(['https']);
    expect(t.scope().mode).toBe('AUTHORIZED_REMOTE');
    expect(t.scope().authorization?.operator).toBe('pentester');
    expect(t.scope().authorization?.expiresAt).toBe('2026-12-31T23:59:59Z');
    expect(t.scope().rateLimit?.requestsPerSecond).toBe(10);
  });

  it('round-trips scope through toJSON/fromJSON', () => {
    const scope: EngagementScope = {
      allowedDomains: ['a.com'],
      mode: 'LOCAL_LAB',
    };
    const t = new Target();
    t.setBaseURL('http://localhost');
    t.setName('test');
    t.setScope(scope);

    const json = t.toJSON();
    expect(json.scope).toBeDefined();

    const restored = Target.fromJSON(json);
    expect(restored.scope().allowedDomains).toEqual(['a.com']);
    expect(restored.scope().mode).toBe('LOCAL_LAB');
  });

  it('copyFrom preserves scope', () => {
    const a = new Target();
    a.setBaseURL('http://a');
    a.setName('a');
    a.setScope({ allowedDomains: ['a.com'] });

    const b = new Target();
    b.copyFrom(a);
    expect(b.baseURL()).toBe('http://a');
    expect(b.scope().allowedDomains).toEqual(['a.com']);
  });

  it('clear() resets scope', () => {
    const t = new Target();
    t.setScope({ allowedDomains: ['a.com'], mode: 'LOCAL_LAB' });
    t.clear();
    expect(t.scope()).toEqual({});
  });

  it('updateScope merges', () => {
    const t = new Target();
    t.setScope({ allowedDomains: ['a.com'] });
    t.updateScope({ allowedPorts: [443] });
    expect(t.scope().allowedDomains).toEqual(['a.com']);
    expect(t.scope().allowedPorts).toEqual([443]);
  });

  it('fromJSON filters invalid scope data', () => {
    const raw = {
      baseURL: 'http://x',
      name: 'y',
      scope: {
        allowedDomains: [123, 'valid.com', null],
        mode: 'INVALID_MODE',
        authorization: { operator: 'test' },
      },
    };
    const t = Target.fromJSON(raw);
    expect(t.scope().allowedDomains).toEqual(['valid.com']);
    expect(t.scope().mode).toBeUndefined();
    expect(t.scope().authorization?.operator).toBe('test');
  });
});

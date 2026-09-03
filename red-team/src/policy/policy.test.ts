import { describe, expect, it } from 'vitest';
import { Target } from '../target/target.js';
import { PolicyEngine } from './policy.js';

describe('PolicyEngine', () => {
  function makeTarget(scope: Parameters<Target['setScope']>[0]): Target {
    const t = new Target();
    t.setBaseURL('https://example.com');
    t.setName('test');
    t.setScope(scope);
    return t;
  }

  it('allows when no scope configured', () => {
    const engine = new PolicyEngine(makeTarget({}));
    const decision = engine.evaluate({
      hostname: 'example.com',
      port: 443,
      protocol: 'https',
    });
    expect(decision.action).toBe('allow');
  });

  it('denies out-of-scope domain', () => {
    const engine = new PolicyEngine(makeTarget({ allowedDomains: ['example.com'] }));
    const decision = engine.evaluate({
      hostname: 'evil.com',
      port: 443,
      protocol: 'https',
    });
    expect(decision.action).toBe('deny');
    expect(decision.reason).toContain('domain');
  });

  it('allows in-scope domain', () => {
    const engine = new PolicyEngine(
      makeTarget({ allowedDomains: ['example.com', '*.api.example.com'] }),
    );
    expect(engine.evaluate({ hostname: 'example.com', port: 443, protocol: 'https' }).action).toBe(
      'allow',
    );
    expect(
      engine.evaluate({ hostname: 'v1.api.example.com', port: 443, protocol: 'https' }).action,
    ).toBe('allow');
  });

  it('denies unauthorized domain with lookalike', () => {
    const engine = new PolicyEngine(makeTarget({ allowedDomains: ['example.com'] }));
    expect(
      engine.evaluate({
        hostname: 'example.com.evil.com',
        port: 443,
        protocol: 'https',
      }).action,
    ).toBe('deny');
  });

  it('denies wrong port', () => {
    const engine = new PolicyEngine(makeTarget({ allowedPorts: [443, 8443] }));
    expect(engine.evaluate({ hostname: 'example.com', port: 80, protocol: 'https' }).action).toBe(
      'deny',
    );
    expect(engine.evaluate({ hostname: 'example.com', port: 443, protocol: 'https' }).action).toBe(
      'allow',
    );
  });

  it('denies wrong protocol', () => {
    const engine = new PolicyEngine(makeTarget({ allowedProtocols: ['https'] }));
    expect(engine.evaluate({ hostname: 'example.com', port: 80, protocol: 'http' }).action).toBe(
      'deny',
    );
  });

  it('denies expired authorization in AUTHORIZED_REMOTE', () => {
    const engine = new PolicyEngine(
      makeTarget({
        mode: 'AUTHORIZED_REMOTE',
        authorization: {
          expiresAt: '2020-01-01T00:00:00Z',
        },
      }),
    );
    const decision = engine.evaluate({
      hostname: 'example.com',
      port: 443,
      protocol: 'https',
    });
    expect(decision.action).toBe('deny');
    expect(decision.reason).toContain('expired');
  });

  it('allows valid authorization in AUTHORIZED_REMOTE', () => {
    const engine = new PolicyEngine(
      makeTarget({
        mode: 'AUTHORIZED_REMOTE',
        authorization: {
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      }),
    );
    expect(engine.evaluate({ hostname: 'example.com', port: 443, protocol: 'https' }).action).toBe(
      'allow',
    );
  });

  it('allows LOCAL_LAB without external authorization', () => {
    const engine = new PolicyEngine(makeTarget({ mode: 'LOCAL_LAB' }));
    expect(engine.evaluate({ hostname: '127.0.0.1', port: 3000, protocol: 'http' }).action).toBe(
      'allow',
    );
  });

  it('requires approval for high-risk operations', () => {
    const engine = new PolicyEngine(
      makeTarget({
        allowedDomains: ['example.com'],
        rateLimit: { requestsPerSecond: 10 },
      }),
    );
    const decision = engine.evaluate({
      hostname: 'example.com',
      port: 443,
      protocol: 'https',
      risk: 'high',
    });
    expect(decision.action).toBe('require-approval');
  });
});

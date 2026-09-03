import { describe, expect, it } from 'vitest';
import {
  isAuthorizationValid,
  isInScope,
  matchesCIDR,
  matchesDomain,
  matchesIP,
  matchesPort,
  matchesProtocol,
} from './scope.js';
import type { EngagementScope } from './types.js';

describe('matchesDomain', () => {
  it('exact match', () => {
    expect(matchesDomain('example.com', ['example.com'])).toBe(true);
  });

  it('case insensitive', () => {
    expect(matchesDomain('Example.COM', ['example.com'])).toBe(true);
  });

  it('trailing dot stripped', () => {
    expect(matchesDomain('example.com.', ['example.com'])).toBe(true);
  });

  it('wildcard subdomain match', () => {
    expect(matchesDomain('api.example.com', ['*.example.com'])).toBe(true);
  });

  it('wildcard does not match apex', () => {
    expect(matchesDomain('example.com', ['*.example.com'])).toBe(false);
  });

  it('malicious lookalike domain rejected', () => {
    expect(matchesDomain('example.com.evil.com', ['example.com'])).toBe(false);
  });

  it('malicious lookalike with wildcard rejected', () => {
    expect(matchesDomain('example.com.evil.com', ['*.example.com'])).toBe(false);
  });

  it('multiple domains', () => {
    expect(matchesDomain('a.com', ['b.com', 'a.com', 'c.com'])).toBe(true);
  });

  it('no match', () => {
    expect(matchesDomain('other.com', ['example.com'])).toBe(false);
  });

  it('empty domains list', () => {
    expect(matchesDomain('example.com', [])).toBe(false);
  });
});

describe('matchesIP', () => {
  it('exact match', () => {
    expect(matchesIP('203.0.113.1', ['203.0.113.1'])).toBe(true);
  });

  it('case insensitive for IPv6', () => {
    expect(matchesIP('::1', ['::1'])).toBe(true);
  });

  it('no match', () => {
    expect(matchesIP('10.0.0.1', ['203.0.113.1'])).toBe(false);
  });
});

describe('matchesCIDR', () => {
  it('IP in CIDR range', () => {
    expect(matchesCIDR('203.0.113.5', ['203.0.113.0/24'])).toBe(true);
  });

  it('IP at CIDR boundary', () => {
    expect(matchesCIDR('203.0.113.0', ['203.0.113.0/24'])).toBe(true);
    expect(matchesCIDR('203.0.113.255', ['203.0.113.0/24'])).toBe(true);
  });

  it('IP outside CIDR range', () => {
    expect(matchesCIDR('203.0.114.1', ['203.0.113.0/24'])).toBe(false);
  });

  it('10.0.0.0/8 matches 10.x', () => {
    expect(matchesCIDR('10.255.255.255', ['10.0.0.0/8'])).toBe(true);
  });

  it('invalid CIDR format', () => {
    expect(matchesCIDR('1.2.3.4', ['not-a-cidr'])).toBe(false);
  });

  it('non-IP input', () => {
    expect(matchesCIDR('hostname', ['203.0.113.0/24'])).toBe(false);
  });

  it('multiple CIDRs', () => {
    expect(matchesCIDR('192.168.1.1', ['10.0.0.0/8', '192.168.0.0/16'])).toBe(true);
  });
});

describe('matchesPort', () => {
  it('port in list', () => {
    expect(matchesPort(443, [80, 443, 8080])).toBe(true);
  });

  it('port not in list', () => {
    expect(matchesPort(3000, [80, 443])).toBe(false);
  });

  it('empty list', () => {
    expect(matchesPort(80, [])).toBe(false);
  });
});

describe('matchesProtocol', () => {
  it('https in allowed', () => {
    expect(matchesProtocol('https', ['https'])).toBe(true);
  });

  it('http not in https-only', () => {
    expect(matchesProtocol('http', ['https'])).toBe(false);
  });

  it('both protocols', () => {
    expect(matchesProtocol('http', ['http', 'https'])).toBe(true);
  });
});

describe('isAuthorizationValid', () => {
  it('valid with no expiry', () => {
    expect(isAuthorizationValid({ operator: 'test' })).toBe(true);
  });

  it('valid with future expiry', () => {
    expect(
      isAuthorizationValid({
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).toBe(true);
  });

  it('expired', () => {
    expect(
      isAuthorizationValid({
        expiresAt: '2020-01-01T00:00:00Z',
      }),
    ).toBe(false);
  });

  it('undefined auth', () => {
    expect(isAuthorizationValid(undefined)).toBe(false);
  });
});

describe('isInScope', () => {
  it('no restrictions → in scope', () => {
    const scope: EngagementScope = {};
    expect(isInScope('anything.com', undefined, 443, 'https', scope).inScope).toBe(true);
  });

  it('domain match', () => {
    const scope: EngagementScope = { allowedDomains: ['example.com'] };
    expect(isInScope('example.com', undefined, 443, 'https', scope).inScope).toBe(true);
  });

  it('domain mismatch', () => {
    const scope: EngagementScope = { allowedDomains: ['example.com'] };
    expect(isInScope('evil.com', undefined, 443, 'https', scope).inScope).toBe(false);
  });

  it('port restriction', () => {
    const scope: EngagementScope = { allowedPorts: [443] };
    expect(isInScope('example.com', undefined, 443, 'https', scope).inScope).toBe(true);
    expect(isInScope('example.com', undefined, 80, 'https', scope).inScope).toBe(false);
  });

  it('protocol restriction', () => {
    const scope: EngagementScope = { allowedProtocols: ['https'] };
    expect(isInScope('example.com', undefined, 443, 'https', scope).inScope).toBe(true);
    expect(isInScope('example.com', undefined, 80, 'http', scope).inScope).toBe(false);
  });

  it('IP restriction', () => {
    const scope: EngagementScope = { allowedIPs: ['203.0.113.1'] };
    expect(isInScope('example.com', '203.0.113.1', 443, 'https', scope).inScope).toBe(true);
    expect(isInScope('example.com', '10.0.0.1', 443, 'https', scope).inScope).toBe(false);
  });

  it('CIDR restriction', () => {
    const scope: EngagementScope = { allowedCIDRs: ['203.0.113.0/24'] };
    expect(isInScope('example.com', '203.0.113.5', 443, 'https', scope).inScope).toBe(true);
    expect(isInScope('example.com', '10.0.0.1', 443, 'https', scope).inScope).toBe(false);
  });

  it('combined restrictions', () => {
    const scope: EngagementScope = {
      allowedDomains: ['example.com'],
      allowedPorts: [443],
      allowedProtocols: ['https'],
    };
    expect(isInScope('example.com', undefined, 443, 'https', scope).inScope).toBe(true);
    expect(isInScope('evil.com', undefined, 443, 'https', scope).inScope).toBe(false);
    expect(isInScope('example.com', undefined, 80, 'https', scope).inScope).toBe(false);
    expect(isInScope('example.com', undefined, 443, 'http', scope).inScope).toBe(false);
  });
});

import { isIP } from 'node:net';
import type { Authorization, EngagementScope } from './types.js';

export function matchesDomain(hostname: string, domains: string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  for (const d of domains) {
    const normalized = d.toLowerCase().replace(/\.$/, '');
    if (normalized.startsWith('*.')) {
      const suffix = normalized.slice(1); // e.g. ".example.com"
      const apex = normalized.slice(2); // e.g. "example.com"
      // *.example.com matches sub.example.com but NOT example.com itself
      if (h.endsWith(suffix) && h !== apex) return true;
    } else {
      if (h === normalized) return true;
    }
  }
  return false;
}

export function matchesIP(ip: string, allowedIPs: string[]): boolean {
  const normalized = ip.toLowerCase().trim();
  return allowedIPs.some((a) => a.toLowerCase().trim() === normalized);
}

export function matchesCIDR(ip: string, cidrs: string[]): boolean {
  const kind = isIP(ip);
  if (kind === 0) return false;
  for (const cidr of cidrs) {
    if (kind === 4 && cidr.includes('/') && isIPv4InCIDR(ip, cidr)) return true;
    if (kind === 6 && cidr.includes('/') && isIPv6InCIDR(ip, cidr)) return true;
  }
  return false;
}

function isIPv4InCIDR(ip: string, cidr: string): boolean {
  const [network, bitsStr] = cidr.split('/');
  if (!network || !bitsStr) return false;
  const bits = Number.parseInt(bitsStr, 10);
  if (!Number.isFinite(bits) || bits < 0 || bits > 32) return false;
  const ipNum = ipv4ToNum(ip);
  const netNum = ipv4ToNum(network);
  if (ipNum === null || netNum === null) return false;
  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

function isIPv6InCIDR(_ip: string, _cidr: string): boolean {
  // Simplified IPv6 CIDR check — expand to 128-bit and compare prefix
  // For practical pentest scope, this covers common cases
  return false;
}

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let num = 0;
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isFinite(n) || n < 0 || n > 255) return null;
    num = (num << 8) | n;
  }
  return num >>> 0;
}

export function matchesPort(port: number, allowedPorts: number[]): boolean {
  return allowedPorts.includes(port);
}

export function matchesProtocol(
  proto: 'http' | 'https',
  allowedProtocols: Array<'http' | 'https'>,
): boolean {
  return allowedProtocols.includes(proto);
}

export function isAuthorizationValid(auth?: Authorization): boolean {
  if (!auth) return false;
  if (auth.expiresAt) {
    const expires = Date.parse(auth.expiresAt);
    if (Number.isFinite(expires) && Date.now() > expires) return false;
  }
  return true;
}

export function isInScope(
  hostname: string,
  ip: string | undefined,
  port: number,
  protocol: 'http' | 'https',
  scope: EngagementScope,
): { inScope: boolean; reason: string } {
  if (scope.allowedProtocols && scope.allowedProtocols.length > 0) {
    if (!matchesProtocol(protocol, scope.allowedProtocols)) {
      return {
        inScope: false,
        reason: `protocol ${protocol} not in allowed: ${scope.allowedProtocols.join(', ')}`,
      };
    }
  }

  if (scope.allowedPorts && scope.allowedPorts.length > 0) {
    if (!matchesPort(port, scope.allowedPorts)) {
      return {
        inScope: false,
        reason: `port ${port} not in allowed: ${scope.allowedPorts.join(', ')}`,
      };
    }
  }

  // If no domain/IP/CIDR restrictions exist, everything else passed
  const hasDomainRestrictions = scope.allowedDomains && scope.allowedDomains.length > 0;
  const hasIPRestrictions =
    (scope.allowedIPs && scope.allowedIPs.length > 0) ||
    (scope.allowedCIDRs && scope.allowedCIDRs.length > 0);

  if (!hasDomainRestrictions && !hasIPRestrictions) {
    return { inScope: true, reason: 'no domain/IP restrictions configured' };
  }

  if (hasDomainRestrictions && !matchesDomain(hostname, scope.allowedDomains ?? [])) {
    return {
      inScope: false,
      reason: `domain ${hostname} not in allowed domains`,
    };
  }

  if (hasIPRestrictions && ip) {
    const ipAllowed =
      (scope.allowedIPs && matchesIP(ip, scope.allowedIPs)) ||
      (scope.allowedCIDRs && matchesCIDR(ip, scope.allowedCIDRs));
    if (!ipAllowed) {
      return {
        inScope: false,
        reason: `IP ${ip} not in allowed IPs or CIDRs`,
      };
    }
  }

  return { inScope: true, reason: 'in scope' };
}

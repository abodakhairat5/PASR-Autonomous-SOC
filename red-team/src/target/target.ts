// Engagement target. A pointer shared between the http tool and the
// agent's system prompt so /target updates propagate to both without
// rewiring.
//
// PASR extension: EngagementScope adds structured scope, authorization,
// and rate-limit metadata while preserving backward-compatible JSON.

export type EngagementMode = 'LOCAL_LAB' | 'AUTHORIZED_REMOTE';

export interface Authorization {
  operator?: string;
  authorizedAt?: string;
  expiresAt?: string;
  reference?: string;
}

export interface RateLimitConfig {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
  burst?: number;
}

export interface EngagementScope {
  allowedDomains?: string[];
  allowedIPs?: string[];
  allowedCIDRs?: string[];
  allowedPorts?: number[];
  allowedProtocols?: Array<'http' | 'https'>;
  mode?: EngagementMode;
  authorization?: Authorization;
  rateLimit?: RateLimitConfig;
}

/** Legacy snapshot shape — kept stable for saved-session interop. */
export interface TargetSnapshot {
  baseURL: string;
  name: string;
}

/** Extended snapshot that carries scope alongside the legacy fields. */
export interface TargetSnapshotV2 extends TargetSnapshot {
  scope?: EngagementScope;
}

export class Target {
  private _baseURL = '';
  private _name = '';
  private _scope: EngagementScope = {};

  baseURL(): string {
    return this._baseURL;
  }

  name(): string {
    return this._name;
  }

  scope(): EngagementScope {
    return this._scope;
  }

  setBaseURL(u: string): void {
    this._baseURL = u.trim();
  }

  setName(n: string): void {
    this._name = n.trim();
  }

  setScope(s: EngagementScope): void {
    this._scope = { ...s };
  }

  updateScope(patch: Partial<EngagementScope>): void {
    this._scope = { ...this._scope, ...patch };
  }

  clear(): void {
    this._baseURL = '';
    this._name = '';
    this._scope = {};
  }

  empty(): boolean {
    return this._baseURL === '' && this._name === '';
  }

  /** Replace this target's fields from another, in place. */
  copyFrom(other: TargetSnapshotV2 | Target | null | undefined): void {
    if (!other) return;
    if (other instanceof Target) {
      this._baseURL = other._baseURL;
      this._name = other._name;
      this._scope = { ...other._scope };
      return;
    }
    this._baseURL = other.baseURL ?? '';
    this._name = other.name ?? '';
    if (other.scope) this._scope = { ...other.scope };
  }

  /** JSON shape kept stable so saved sessions interop across versions. */
  toJSON(): TargetSnapshotV2 {
    const out: TargetSnapshotV2 = { baseURL: this._baseURL, name: this._name };
    if (hasScopeData(this._scope)) out.scope = this._scope;
    return out;
  }

  static fromJSON(raw: unknown): Target {
    const t = new Target();
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.baseURL === 'string') t._baseURL = obj.baseURL;
      if (typeof obj.name === 'string') t._name = obj.name;
      if (obj.scope && typeof obj.scope === 'object') {
        t._scope = normalizeScope(obj.scope as Record<string, unknown>);
      }
    }
    return t;
  }
}

export function newTarget(): Target {
  return new Target();
}

function hasScopeData(s: EngagementScope): boolean {
  return !!(
    s.allowedDomains?.length ||
    s.allowedIPs?.length ||
    s.allowedCIDRs?.length ||
    s.allowedPorts?.length ||
    s.allowedProtocols?.length ||
    s.mode ||
    s.authorization ||
    s.rateLimit
  );
}

function normalizeScope(raw: Record<string, unknown>): EngagementScope {
  const scope: EngagementScope = {};
  if (Array.isArray(raw.allowedDomains)) {
    scope.allowedDomains = raw.allowedDomains.filter((d): d is string => typeof d === 'string');
  }
  if (Array.isArray(raw.allowedIPs)) {
    scope.allowedIPs = raw.allowedIPs.filter((ip): ip is string => typeof ip === 'string');
  }
  if (Array.isArray(raw.allowedCIDRs)) {
    scope.allowedCIDRs = raw.allowedCIDRs.filter((c): c is string => typeof c === 'string');
  }
  if (Array.isArray(raw.allowedPorts)) {
    scope.allowedPorts = raw.allowedPorts.filter((p): p is number => typeof p === 'number');
  }
  if (Array.isArray(raw.allowedProtocols)) {
    scope.allowedProtocols = raw.allowedProtocols.filter(
      (p): p is 'http' | 'https' => p === 'http' || p === 'https',
    );
  }
  if (raw.mode === 'LOCAL_LAB' || raw.mode === 'AUTHORIZED_REMOTE') {
    scope.mode = raw.mode;
  }
  if (raw.authorization && typeof raw.authorization === 'object') {
    const a = raw.authorization as Record<string, unknown>;
    scope.authorization = {};
    if (typeof a.operator === 'string') scope.authorization.operator = a.operator;
    if (typeof a.authorizedAt === 'string') scope.authorization.authorizedAt = a.authorizedAt;
    if (typeof a.expiresAt === 'string') scope.authorization.expiresAt = a.expiresAt;
    if (typeof a.reference === 'string') scope.authorization.reference = a.reference;
  }
  if (raw.rateLimit && typeof raw.rateLimit === 'object') {
    const rl = raw.rateLimit as Record<string, unknown>;
    scope.rateLimit = {};
    if (typeof rl.requestsPerSecond === 'number')
      scope.rateLimit.requestsPerSecond = rl.requestsPerSecond;
    if (typeof rl.requestsPerMinute === 'number')
      scope.rateLimit.requestsPerMinute = rl.requestsPerMinute;
    if (typeof rl.burst === 'number') scope.rateLimit.burst = rl.burst;
  }
  return scope;
}

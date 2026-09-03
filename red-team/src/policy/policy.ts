import type { Target } from '../target/target.js';
import { isAuthorizationValid, isInScope } from './scope.js';
import type { PolicyDecision, PolicyRequest } from './types.js';

export interface PolicyEngineCallbacks {
  onDecision?: (event: {
    type: 'policy-decision';
    hostname: string;
    action: 'allow' | 'deny' | 'require-approval';
    reason: string;
  }) => void;
}

export class PolicyEngine {
  private readonly target: Target;
  private callbacks?: PolicyEngineCallbacks;

  constructor(target: Target, callbacks?: PolicyEngineCallbacks) {
    this.target = target;
    this.callbacks = callbacks;
  }

  setCallbacks(cb: PolicyEngineCallbacks): void {
    this.callbacks = cb;
  }

  evaluate(req: PolicyRequest): PolicyDecision {
    const scope = this.target.scope();

    if (scope.mode) {
      if (scope.mode === 'AUTHORIZED_REMOTE') {
        if (!isAuthorizationValid(scope.authorization)) {
          const d: PolicyDecision = {
            action: 'deny',
            reason: 'authorization is missing or expired for AUTHORIZED_REMOTE mode',
          };
          this.emit(req.hostname, d);
          return d;
        }
      }
    }

    const { inScope, reason } = isInScope(req.hostname, req.ip, req.port, req.protocol, scope);
    if (!inScope) {
      const d: PolicyDecision = { action: 'deny', reason };
      this.emit(req.hostname, d);
      return d;
    }

    if (scope.rateLimit) {
      if (req.risk === 'high') {
        const d: PolicyDecision = {
          action: 'require-approval',
          reason: `high-risk operation within rate limits (RPS: ${scope.rateLimit.requestsPerSecond ?? 'unlimited'})`,
        };
        this.emit(req.hostname, d);
        return d;
      }
    }

    const d: PolicyDecision = { action: 'allow', reason: 'target in scope, authorization valid' };
    this.emit(req.hostname, d);
    return d;
  }

  private emit(hostname: string, d: PolicyDecision): void {
    this.callbacks?.onDecision?.({
      type: 'policy-decision',
      hostname,
      action: d.action,
      reason: d.reason,
    });
  }
}

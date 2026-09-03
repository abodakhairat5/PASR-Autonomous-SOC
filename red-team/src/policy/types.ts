import type { Authorization, EngagementMode, EngagementScope } from '../target/target.js';

export interface PolicyRequest {
  hostname: string;
  ip?: string;
  port: number;
  protocol: 'http' | 'https';
  risk?: 'low' | 'medium' | 'high';
  tool?: string;
}

export type PolicyAction = 'allow' | 'deny' | 'require-approval';

export interface PolicyDecision {
  action: PolicyAction;
  reason: string;
}

export type { EngagementScope, EngagementMode, Authorization };

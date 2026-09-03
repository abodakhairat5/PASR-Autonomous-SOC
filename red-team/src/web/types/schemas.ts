import { z } from 'zod';

export const EngagementModeSchema = z.enum(['LOCAL_LAB', 'AUTHORIZED_REMOTE']);

export const AuthorizationSchema = z.object({
  operator: z.string().optional(),
  authorizedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  reference: z.string().optional(),
});

export const RateLimitSchema = z.object({
  requestsPerSecond: z.number().int().positive().optional(),
  requestsPerMinute: z.number().int().positive().optional(),
  burst: z.number().int().positive().optional(),
});

export const ScopeSchema = z.object({
  allowedDomains: z.array(z.string()).optional(),
  allowedIPs: z.array(z.string()).optional(),
  allowedCIDRs: z.array(z.string()).optional(),
  allowedPorts: z.array(z.number().int()).optional(),
  allowedProtocols: z.array(z.enum(['http', 'https'])).optional(),
  mode: EngagementModeSchema.optional(),
  authorization: AuthorizationSchema.optional(),
  rateLimit: RateLimitSchema.optional(),
});

export const CreateEngagementSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  targetUrl: z.string().url(),
  targetName: z.string().max(200).optional(),
  scope: ScopeSchema.optional(),
  backend: z.string().optional(),
  model: z.string().optional(),
  thinkingEnabled: z.boolean().optional(),
});

export const UpdateScopeSchema = z.object({
  scope: ScopeSchema,
});

export const RetestRequestSchema = z.object({
  findingId: z.string().min(1),
  evidenceId: z.string().optional(),
  reproduceCommand: z.string().optional(),
});

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const EventFilterSchema = z.object({
  types: z.array(z.string()).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type CreateEngagementInput = z.infer<typeof CreateEngagementSchema>;
export type UpdateScopeInput = z.infer<typeof UpdateScopeSchema>;
export type RetestRequestInput = z.infer<typeof RetestRequestSchema>;

export const PermissionDecisionSchema = z.object({
  decision: z.enum(['approve', 'deny']),
});

export type PermissionDecisionInput = z.infer<typeof PermissionDecisionSchema>;

export const AuditFilterSchema = z.object({
  kind: z.array(z.string()).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

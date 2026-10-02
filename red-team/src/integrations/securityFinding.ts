// Blue Team MCP submission integration.
//
// When a finding is confirmed by the existing Red Team flow
// (ConfirmFindingTool), this module converts the Red Team `Finding` into
// the agreed `SecurityFinding` contract, validates it, and submits it to
// the external Blue Team MCP server by discovering and calling its
// `submit_security_finding` tool.
//
// The MCP boundary is treated as untrusted:
//   - every numeric size cap is enforced before anything leaves the agent
//   - server failures are captured, never thrown into the agent loop
//   - the response is read as data — commands/URLs inside it are never
//     executed or loaded
//   - without a configured server (or when disabled) submission is a
//     clean no-op so testing can run with no Blue Team server at all.

import { z } from 'zod';
import type { MCPServerConfig } from '../config/config.js';
import type { Finding } from '../findings/store.js';
import * as logger from '../logger/logger.js';
import { MCPSession } from '../tools/mcp.js';

export const SUBMIT_TOOL_NAME = 'submit_security_finding';
export const RED_TEAM_SOURCE = 'red_team';

const MAX_FINDING_ID_CHARS = 128;
const MAX_TITLE_CHARS = 512;
const MAX_ENDPOINT_CHARS = 2048;
const MAX_PARAMETER_CHARS = 1024;
const MAX_METHOD_CHARS = 32;
const MAX_PAYLOAD_CHARS = 64 * 1024;
const MAX_EXCERPT_CHARS = 8 * 1024;
const MAX_URL_CHARS = 2048;
const MAX_CURL_CHARS = 4 * 1024;
const MAX_IMPACT_CHARS = 4096;
const MAX_REMEDIATION_CHARS = 4096;
// Give the external server a bounded window to answer a single submission.
const DEFAULT_SUBMIT_TIMEOUT_MS = 30_000;

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;

export const SecurityFindingSchema = z.object({
  finding_id: z
    .string()
    .min(1)
    .max(MAX_FINDING_ID_CHARS)
    .regex(/^RT-[\w.-]+$/, { message: 'finding_id must start with "RT-"' }),
  source: z.literal(RED_TEAM_SOURCE),
  title: z.string().min(1).max(MAX_TITLE_CHARS),
  severity: z.enum(SEVERITIES),
  target: z.object({
    url: z.string().url().max(MAX_URL_CHARS),
  }),
  endpoint: z.string().min(1).max(MAX_ENDPOINT_CHARS).optional(),
  method: z.string().min(1).max(MAX_METHOD_CHARS).optional(),
  parameter: z.string().min(1).max(MAX_PARAMETER_CHARS).optional(),
  payload: z.string().min(1).max(MAX_PAYLOAD_CHARS).optional(),
  evidence: z
    .object({
      response_excerpt: z.string().min(1).max(MAX_EXCERPT_CHARS).optional(),
      curl: z.string().min(1).max(MAX_CURL_CHARS).optional(),
    })
    .optional(),
  impact: z.string().min(1).max(MAX_IMPACT_CHARS),
  remediation: z.string().min(1).max(MAX_REMEDIATION_CHARS).optional(),
  timestamp: z.string().datetime(),
});

export type SecurityFinding = z.infer<typeof SecurityFindingSchema>;

export interface SecurityFindingValidationResult {
  ok: boolean;
  finding?: SecurityFinding;
  errors?: string[];
}

/** Validate arbitrary input against the SecurityFinding contract.
 *  Never throws — returns a structured result for callers/tests. */
export function validateSecurityFinding(input: unknown): SecurityFindingValidationResult {
  const parsed = SecurityFindingSchema.safeParse(input);
  if (parsed.success) return { ok: true, finding: parsed.data };
  return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** Build the Red Team–scoped finding id. Reuses the Red Team id when
 *  available and only normalizes to the RT- namespace. */
export function redTeamFindingId(finding: Finding): string {
  const base =
    finding.findingId && finding.findingId.length > 0
      ? finding.findingId
      : `finding-${Date.now()}`;
  return base.startsWith('RT-') ? base : `RT-${base}`;
}

/** Derive the `endpoint` (path+query) from a URL, if the URL parses. */
function endpointFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const ep = u.pathname === '' ? '/' : u.pathname;
    return u.search ? `${ep}${u.search}` : ep;
  } catch {
    return undefined;
  }
}

/** Convert an existing Red Team Finding into the SecurityFinding contract.
 *  Reuses finding fields wherever present, never fabricates missing ones. */
export function toSecurityFinding(finding: Finding): SecurityFinding {
  const timestamp =
    finding.createdAt && new Date(finding.createdAt).toISOString() === finding.createdAt
      ? finding.createdAt
      : new Date().toISOString();
  const candidate: SecurityFinding = {
    finding_id: redTeamFindingId(finding),
    source: RED_TEAM_SOURCE,
    title: finding.title,
    severity: finding.severity,
    target: { url: finding.url },
    endpoint: endpointFromUrl(finding.url),
    method: finding.method || undefined,
    parameter: finding.parameter || undefined,
    payload: finding.payload || undefined,
    evidence: {
      response_excerpt: finding.responseExcerpt || undefined,
      curl: finding.curl || undefined,
    },
    impact: finding.impact,
    remediation: finding.remediation || undefined,
    timestamp,
  };
  return candidate;
}

export interface SecurityFindingSubmissionResult {
  submitted: boolean;
  transport: 'mcp';
  tool: typeof SUBMIT_TOOL_NAME;
  finding_id: string;
  message?: string;
  error?: string;
}

export interface BlueTeamSubmitOptions {
  /** Master switch. When false, submission is a clean no-op. */
  enabled: boolean;
  /** External Blue Team MCP server. Undefined => no-op (no server configured). */
  server?: MCPServerConfig;
  /** Wait bound for a single submission. Defaults to 30s. */
  timeoutMs?: number;
  /** Test seam: how the MCP client session is opened. Defaults to the
   *  real stdio client. */
  sessionProvider?: (server: MCPServerConfig) => Promise<MCPSession>;
}

const notConfigured = (findingId: string, reason: string): SecurityFindingSubmissionResult => ({
  submitted: false,
  transport: 'mcp',
  tool: SUBMIT_TOOL_NAME,
  finding_id: findingId,
  error: reason,
});

/**
 * Build the arguments passed to `submit_security_finding` from the tool's
 * discovered inputSchema. The schema is not hard-coded: if discovery told us
 * the server expects a single `finding` (or `security_finding`) object, we
 * wrap the contract in it; if the schema expects the contract fields at the
 * top level, we pass them flattened; with no usable schema we fall back to
 * wrapping under `finding`.
 */
export function buildSubmitArgs(
  inputSchema: unknown,
  securityFinding: SecurityFinding,
): Record<string, unknown> {
  const props =
    inputSchema && typeof inputSchema === 'object'
      ? (inputSchema as { properties?: Record<string, unknown> }).properties
      : undefined;
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    const safeProps = props as Record<string, unknown>;
    if (isObjectProp(safeProps.finding)) return { finding: securityFinding };
    if (isObjectProp(safeProps.security_finding)) return { security_finding: securityFinding };
    const hasContractFields = ['finding_id', 'title', 'severity', 'target', 'impact'].some(
      (k) => k in safeProps,
    );
    if (hasContractFields) return { ...securityFinding };
  }
  return { finding: securityFinding };
}

function isObjectProp(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const p = v as { type?: unknown; properties?: unknown };
  return p.type === 'object' || Boolean(p.properties);
}

/**
 * Submit a confirmed finding to the external Blue Team MCP server.
 *
 * Orchestrates: convert -> validate -> connect -> discover tool ->
 * call submit_security_finding -> capture result -> close. NEVER throws:
 * every failure (unreachable server, missing tool, schema error, timeout)
 * is returned as a structured `{ submitted: false, error }` result so the
 * Red Team agent loop is never crashed by the MCP boundary.
 */
export async function submitSecurityFinding(
  finding: Finding,
  opts: BlueTeamSubmitOptions,
): Promise<SecurityFindingSubmissionResult> {
  const findingId = redTeamFindingId(finding);

  if (!opts.enabled) {
    return notConfigured(findingId, 'blue team MCP submission is disabled');
  }
  if (!opts.server) {
    return notConfigured(findingId, 'no blue team MCP server configured');
  }

  const contract = toSecurityFinding(finding);
  const validation = validateSecurityFinding(contract);
  if (!validation.ok || !validation.finding) {
    return notConfigured(
      findingId,
      `invalid security finding: ${(validation.errors ?? []).join('; ')}`,
    );
  }
  const securityFinding = validation.finding;

  const sessionProvider = opts.sessionProvider ?? ((server) => MCPSession.open(server));
  const timeout = opts.timeoutMs ?? DEFAULT_SUBMIT_TIMEOUT_MS;
  let session: MCPSession | undefined;
  try {
    session = await sessionProvider(opts.server);
    const tools = await session.listTools();
    const tool = tools.find((t) => t.name === SUBMIT_TOOL_NAME);
    if (!tool) {
      await session.close();
      return notConfigured(
        findingId,
        `blue team MCP server does not expose ${SUBMIT_TOOL_NAME}`,
      );
    }
    const args = buildSubmitArgs(tool.inputSchema, securityFinding);
    const result = await session.callTool(SUBMIT_TOOL_NAME, args, AbortSignal.timeout(timeout));
    await session.close();

    if (result.isError) {
      return {
        submitted: false,
        transport: 'mcp',
        tool: SUBMIT_TOOL_NAME,
        finding_id: securityFinding.finding_id,
        error: `submit_security_finding returned an error: ${extractText(result.content)}`,
      };
    }
    const text = extractText(result.content);
    return {
      submitted: true,
      transport: 'mcp',
      tool: SUBMIT_TOOL_NAME,
      finding_id: securityFinding.finding_id,
      message: text,
    };
  } catch (err) {
    if (session) {
      try {
        await session.close();
      } catch {
        /* ignore */
      }
    }
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn('blue team MCP submission failed', { findingId, error: reason });
    return notConfigured(findingId, `blue team MCP server unavailable: ${reason}`);
  }
}

function extractText(content: unknown): string {
  const blocks = Array.isArray(content) ? content : [content];
  const parts: string[] = [];
  for (const block of blocks) {
    if (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text') {
      const text = (block as { text?: unknown }).text;
      if (typeof text === 'string') parts.push(text);
    }
  }
  if (parts.length > 0) return parts.join('\n');
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}
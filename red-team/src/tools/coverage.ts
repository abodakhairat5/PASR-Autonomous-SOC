// coverage tool. Records which (endpoint, parameter, vuln_class) tuples
// the agent has already tested, and answers "what's untested?" — the
// single biggest workflow gap when the model loops over many endpoints
// and silently retests the same pair while skipping others.
//
// State persists in `findings/coverage-<session>.json` (sibling to the
// findings markdown), so a session resume picks up where it left off.

import type { CoverageStatus, CoverageStore } from '../coverage/store.js';
import type { Prompter } from '../permission/permission.js';
import { type Tool, argString } from './types.js';

const ACTIONS = ['mark', 'list', 'untested', 'summary', 'clear'] as const;
type Action = (typeof ACTIONS)[number];

const STATUSES: CoverageStatus[] = ['tried', 'passed', 'failed', 'waf-blocked', 'skipped'];

export class CoverageTool implements Tool {
  private readonly store: CoverageStore;

  constructor(store: CoverageStore) {
    this.store = store;
  }

  name(): string {
    return 'coverage';
  }

  description(): string {
    return [
      'Track which (endpoint, parameter, vuln_class) tuples have been tested this session, and figure out what still needs to be tried. Persists across resumes.',
      '',
      "Use this as a working set as you sweep a target. After each test (whether it confirmed a bug, came back clean, or hit a WAF), call action='mark'. Before picking the next test, call action='untested' with the candidates you have and the vuln classes you want to cover — it returns only the tuples you haven't tried.",
      '',
      'Vuln classes are free-form lowercase strings; the convention is to match a loaded skill name where possible (sqli, xss, ssti, idor, ssrf, jwt, deserialize, graphql, race, ...).',
    ].join('\n');
  }

  schema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description:
            "'mark' records one test; 'list' shows all recorded entries (filterable); 'untested' returns the candidate × vuln-class tuples that have not been marked yet; 'summary' returns counts; 'clear' wipes the session's coverage state.",
        },
        endpoint: {
          type: 'string',
          description:
            "For mark: target endpoint, ideally 'METHOD /path' (e.g. 'GET /api/users/{id}'). Query string is stripped automatically. For list/untested: filter substring.",
        },
        param: {
          type: 'string',
          description:
            'Parameter under test (header, query, body, or cookie name). For list: exact filter.',
        },
        vuln_class: {
          type: 'string',
          description:
            "Vulnerability class label, lowercase. Match a skill name when possible (e.g. 'sqli', 'xss', 'jwt', 'ssrf', 'idor'). For list: filter.",
        },
        status: {
          type: 'string',
          enum: STATUSES,
          description:
            "Result: 'tried' (attempted, inconclusive), 'passed' (confirmed vuln), 'failed' (definitely not vulnerable), 'waf-blocked' (could not test), 'skipped' (out of scope / not applicable).",
        },
        notes: { type: 'string', description: 'Optional short note (payload class, reason).' },
        candidates: {
          type: 'array',
          description:
            "For action='untested': list of {endpoint, param} pairs to cross with vuln_classes.",
          items: {
            type: 'object',
            properties: {
              endpoint: { type: 'string' },
              param: { type: 'string' },
            },
            required: ['endpoint', 'param'],
          },
        },
        vuln_classes: {
          type: 'array',
          description:
            "For action='untested': list of vuln class labels to check against each candidate.",
          items: { type: 'string' },
        },
      },
      required: ['action'],
    };
  }

  requiresPermission(): boolean {
    return false;
  }

  async run(
    args: Record<string, unknown>,
    _signal: AbortSignal,
    _prompter: Prompter,
  ): Promise<string> {
    const action = (argString(args, 'action') || '') as Action;
    if (!ACTIONS.includes(action)) {
      return `error: action must be one of: ${ACTIONS.join(', ')}`;
    }
    switch (action) {
      case 'mark':
        return this.runMark(args);
      case 'list':
        return this.runList(args);
      case 'untested':
        return this.runUntested(args);
      case 'summary':
        return this.runSummary();
      case 'clear':
        await this.store.clear();
        return 'cleared.';
    }
  }

  private async runMark(args: Record<string, unknown>): Promise<string> {
    const endpoint = argString(args, 'endpoint');
    const param = argString(args, 'param');
    const vulnClass = argString(args, 'vuln_class');
    const status = (argString(args, 'status') || 'tried') as CoverageStatus;
    const notes = argString(args, 'notes') || undefined;
    if (!endpoint || !param || !vulnClass) {
      return 'error: mark requires endpoint, param, vuln_class (status optional, defaults to "tried")';
    }
    if (!STATUSES.includes(status)) {
      return `error: status must be one of: ${STATUSES.join(', ')}`;
    }
    const entry = await this.store.mark({ endpoint, param, vulnClass, status, notes });
    return JSON.stringify(
      {
        ok: true,
        entry: {
          ...entry,
          firstSeen: new Date(entry.firstSeen).toISOString(),
          lastSeen: new Date(entry.lastSeen).toISOString(),
        },
      },
      null,
      2,
    );
  }

  private async runList(args: Record<string, unknown>): Promise<string> {
    const endpoint = argString(args, 'endpoint') || undefined;
    const param = argString(args, 'param') || undefined;
    const vulnClass = argString(args, 'vuln_class') || undefined;
    const statusArg = argString(args, 'status');
    const status =
      statusArg && STATUSES.includes(statusArg as CoverageStatus)
        ? (statusArg as CoverageStatus)
        : undefined;
    const rows = await this.store.list({ endpoint, param, vulnClass, status });
    if (rows.length === 0) return 'no entries match.';
    const out = rows.map((e) => ({
      endpoint: e.endpoint,
      param: e.param,
      vuln_class: e.vulnClass,
      status: e.status,
      count: e.count,
      first_seen: new Date(e.firstSeen).toISOString(),
      last_seen: new Date(e.lastSeen).toISOString(),
      notes: e.notes,
    }));
    return JSON.stringify(out, null, 2);
  }

  private async runUntested(args: Record<string, unknown>): Promise<string> {
    const candidates = Array.isArray(args.candidates)
      ? (args.candidates as Array<Record<string, unknown>>)
      : [];
    const vulnClasses = Array.isArray(args.vuln_classes) ? (args.vuln_classes as unknown[]) : [];
    const candPairs = candidates
      .map((c) => ({
        endpoint: typeof c.endpoint === 'string' ? c.endpoint : '',
        param: typeof c.param === 'string' ? c.param : '',
      }))
      .filter((c) => c.endpoint && c.param);
    const classes = vulnClasses.filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (candPairs.length === 0 || classes.length === 0) {
      return 'error: untested requires `candidates` (non-empty list of {endpoint, param}) and `vuln_classes` (non-empty list of strings)';
    }
    const out = await this.store.untested(candPairs, classes);
    if (out.length === 0)
      return 'all combinations marked already — go find more endpoints/params or move on.';
    return JSON.stringify(out, null, 2);
  }

  private async runSummary(): Promise<string> {
    const s = await this.store.summary();
    return JSON.stringify(s, null, 2);
  }
}

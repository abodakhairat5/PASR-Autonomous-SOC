import type { EvidenceStore } from '../evidence/store.js';
import type { Evidence } from '../evidence/types.js';
import type { Prompter } from '../permission/permission.js';
import type { PolicyEngine } from '../policy/policy.js';
import type { RetestResult, RetestState } from './types.js';

export interface RetestRequest {
  findingId: string;
  evidence: Evidence;
  reproduceCommand?: string;
  reproduceRequest?: unknown;
}

export class RetestEngine {
  private readonly evidenceStore: EvidenceStore;
  private readonly policy: PolicyEngine;

  constructor(evidenceStore: EvidenceStore, policy: PolicyEngine) {
    this.evidenceStore = evidenceStore;
    this.policy = policy;
  }

  async retest(
    req: RetestRequest,
    signal: AbortSignal,
    prompter: Prompter,
    executor: (
      command: string,
      signal: AbortSignal,
    ) => Promise<{ output: string; exitCode: number }>,
  ): Promise<RetestState> {
    const evidence = req.evidence;

    // Policy check before retest — covers HTTP and command evidence types.
    if (evidence.type === 'http' && evidence.target) {
      const url = new URL(evidence.target.url ?? '');
      const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
      const decision = this.policy.evaluate({
        hostname: url.hostname,
        port,
        protocol: url.protocol === 'https:' ? 'https' : 'http',
      });
      if (decision.action === 'deny') {
        return this.buildState(req.findingId, 'blocked-by-policy', undefined, decision.reason);
      }
    } else if (evidence.type === 'command' && evidence.command) {
      // For command evidence, extract URLs and check each against policy.
      const urlPattern = /https?:\/\/[^\s'"`|;&()]+/gi;
      const urls = evidence.command.match(urlPattern) ?? [];
      for (const rawUrl of urls) {
        try {
          const url = new URL(rawUrl);
          const port = url.port
            ? Number.parseInt(url.port, 10)
            : url.protocol === 'https:'
              ? 443
              : 80;
          const decision = this.policy.evaluate({
            hostname: url.hostname,
            port,
            protocol: url.protocol === 'https:' ? 'https' : 'http',
          });
          if (decision.action === 'deny') {
            return this.buildState(
              req.findingId,
              'blocked-by-policy',
              undefined,
              `command targets ${url.hostname}: ${decision.reason}`,
            );
          }
        } catch {
          // Invalid URL — skip
        }
      }
    } else if (evidence.type !== 'http' && evidence.type !== 'command') {
      // Unknown evidence type — require explicit user approval for re-execution.
      const permDecision = await prompter.ask(
        {
          tool: 'retest',
          summary: `retest finding ${req.findingId} (evidence type: ${evidence.type})`,
          detail: `re-executing ${evidence.type} evidence requires explicit approval`,
        },
        signal,
      );
      if (permDecision === 'deny') {
        return this.buildState(
          req.findingId,
          'blocked-by-policy',
          undefined,
          'permission denied for unknown evidence type',
        );
      }
    }

    // Permission check
    const permDecision = await prompter.ask(
      {
        tool: 'retest',
        summary: `retest finding ${req.findingId}`,
        detail: `replaying evidence from ${evidence.createdAt} for ${evidence.tool}`,
      },
      signal,
    );
    if (permDecision === 'deny') {
      return this.buildState(req.findingId, 'blocked-by-policy', undefined, 'permission denied');
    }

    // Execute retest
    const command =
      req.reproduceCommand ?? (evidence.type === 'command' ? evidence.command : undefined);
    if (!command) {
      return this.buildState(
        req.findingId,
        'error',
        undefined,
        'no reproduction command available',
      );
    }

    try {
      const result = await executor(command, signal);
      const retestResult: RetestResult = result.exitCode === 0 ? 'confirmed' : 'not-reproduced';

      // Store retest evidence
      const retestEvidence = await this.evidenceStore.create({
        type: 'command',
        tool: 'retest',
        command,
        output: result.output,
        exitCode: result.exitCode,
        provenance: { toolCallId: `retest-${req.findingId}` },
      });

      return this.buildState(req.findingId, retestResult, retestEvidence.id);
    } catch (err) {
      return this.buildState(
        req.findingId,
        'error',
        undefined,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private buildState(
    findingId: string,
    result: RetestResult,
    evidenceId?: string,
    error?: string,
  ): RetestState {
    const attempt = {
      attemptedAt: new Date().toISOString(),
      result,
      evidenceId,
      error,
    };
    return {
      findingId,
      lastAttemptAt: attempt.attemptedAt,
      attempts: 1,
      lastResult: result,
      history: [attempt],
    };
  }
}

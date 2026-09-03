import { randomBytes } from 'node:crypto';
import { Agent } from '../../agent/agent.js';
import type { AgentEvent } from '../../agent/events.js';
import { PASRIntegration } from '../../agent/pasr.js';
import { AuditLogger } from '../../audit/logger.js';
import { ExtendedCoverageStore } from '../../coverage/extended.js';
import { CoverageStore } from '../../coverage/store.js';
import { EvaluationStore } from '../../evaluation/store.js';
import { EvidenceStore } from '../../evidence/store.js';
import { ExperienceStore } from '../../experience/store.js';
import { Store as FindingsStore } from '../../findings/store.js';
import { IntelligenceStore } from '../../intelligence/store.js';
import type { Client } from '../../llm/client.js';
import { MemoryStore } from '../../memory/store.js';
import type { Decision, Prompter } from '../../permission/permission.js';
import { PolicyEngine } from '../../policy/policy.js';
import { RateLimiter } from '../../policy/rateLimiter.js';
import { Registry as SkillRegistry } from '../../skills/registry.js';
import { Target } from '../../target/target.js';
import { FileEditTool, FileReadTool, FileWriteTool } from '../../tools/file.js';
import { ConfirmFindingTool } from '../../tools/finding.js';
import { HTTPTool } from '../../tools/http.js';
import { Registry as ToolRegistry } from '../../tools/registry.js';
import { GlobTool, GrepTool } from '../../tools/search.js';
import { BashTool, ShellTool } from '../../tools/shell.js';
import { WebFetchTool, WebSearchTool } from '../../tools/web.js';
import type { Engagement, ParsDatabase } from '../persistence/database.js';
import type { EventBroadcaster } from '../realtime/broadcaster.js';

export interface SessionHandle {
  sessionId: string;
  engagementId: string;
  agent: Agent;
  abortController: AbortController;
  status: 'running' | 'stopped' | 'error';
}

export interface PermissionRequest {
  id: string;
  tool: string;
  summary: string;
  detail: string;
  timestamp: string;
  resolve: (decision: Decision) => void;
}

export class SessionManager {
  private sessions = new Map<string, SessionHandle>();
  private permissionQueues = new Map<string, PermissionRequest[]>();
  private readonly broadcaster: EventBroadcaster;
  private readonly dataDir: string;

  constructor(broadcaster: EventBroadcaster, dataDir: string) {
    this.broadcaster = broadcaster;
    this.dataDir = dataDir;
  }

  async startSession(
    engagement: Engagement,
    onEvent: (event: AgentEvent) => void,
    db: ParsDatabase,
  ): Promise<string> {
    const sessionId = `sess_${randomBytes(8).toString('hex')}`;
    console.log(`[session] START received — engagement=${engagement.id} session=${sessionId}`);

    const scope = JSON.parse(engagement.scopeJson) as Record<string, unknown>;
    const target = new Target();
    target.setBaseURL(engagement.targetUrl);
    if (engagement.targetName) target.setName(engagement.targetName);
    target.setScope(scope as Parameters<typeof target.setScope>[0]);
    console.log(`[session] target configured — url=${engagement.targetUrl}`);

    const policyEngine = new PolicyEngine(target);
    const rateLimiter = new RateLimiter(
      scope.rateLimit as
        | { requestsPerSecond?: number; requestsPerMinute?: number; burst?: number }
        | undefined,
    );
    const evidenceStore = new EvidenceStore(`${this.dataDir}/evidence-${sessionId}`);
    const findingsStore = new FindingsStore(`${this.dataDir}/findings-${sessionId}`);
    const _coverageStore = new CoverageStore(`${this.dataDir}/coverage-${sessionId}.json`);
    const experienceStore = new ExperienceStore(`${this.dataDir}/experience-${sessionId}.json`);
    const extendedCoverage = new ExtendedCoverageStore(
      `${this.dataDir}/exploit-coverage-${sessionId}.json`,
    );
    const _evaluationStore = new EvaluationStore(`${this.dataDir}/evaluation-${sessionId}.json`);
    const auditLogger = new AuditLogger(`${this.dataDir}/audit-${sessionId}`);
    const memoryStore = new MemoryStore({ cwd: this.dataDir });
    const intelligenceStore = new IntelligenceStore({ cwd: this.dataDir });

    const pasr = new PASRIntegration({
      policyEngine,
      evidenceStore,
      experienceStore,
      extendedCoverage,
      auditLogger,
    });

    // Web permission prompter — queues approval requests for the frontend
    const webPrompter = this.createWebPrompter(sessionId);

    const tools = new ToolRegistry();
    tools.register(new ShellTool('/bin/sh', 'shell', target, policyEngine, evidenceStore));
    tools.register(new BashTool(target, policyEngine, evidenceStore));
    tools.register(new FileReadTool());
    tools.register(new FileWriteTool());
    tools.register(new FileEditTool());
    tools.register(new GlobTool());
    tools.register(new GrepTool());
    tools.register(new HTTPTool(target, policyEngine, rateLimiter, evidenceStore));
    tools.register(new WebFetchTool());
    tools.register(new WebSearchTool());
    tools.register(new ConfirmFindingTool(findingsStore, undefined, evidenceStore));

    const skills = new SkillRegistry();

    // Create LLM client — if this fails, mark engagement as error immediately
    let client: Client;
    try {
      client = await this.createLLMClient(engagement.backend, engagement.model);
      console.log(
        `[session] LLM client created — backend=${engagement.backend || 'ollama'} model=${engagement.model || '(default)'}`,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[session] LLM client creation FAILED: ${errorMsg}`);
      db.updateEngagement(engagement.id, {
        status: 'error',
        stoppedAt: new Date().toISOString(),
      });
      this.broadcaster.broadcast(engagement.id, {
        type: 'agent-error',
        data: { sessionId, error: `Failed to create LLM client: ${errorMsg}` },
      });
      throw err;
    }

    const agent = new Agent({
      client,
      tools,
      skills,
      prompter: webPrompter,
      store: null,
      target,
      thinkingEnabled: engagement.thinkingEnabled,
      maxSteps: 30,
      pasr,
      intelligence: intelligenceStore,
      memoryStore,
      engagement: engagement.name,
    });

    const abortController = new AbortController();

    const handle: SessionHandle = {
      sessionId,
      engagementId: engagement.id,
      agent,
      abortController,
      status: 'running',
    };
    this.sessions.set(sessionId, handle);

    // Create session DB record now (before runAgent) so it exists for cleanup
    db.createSession({
      id: sessionId,
      engagementId: engagement.id,
      status: 'running',
      stoppedAt: null,
      error: null,
    });
    console.log(`[session] session DB record created — session=${sessionId}`);

    // Run agent in background
    this.runAgent(handle, engagement, onEvent, db).catch((err) => {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[session] runAgent unhandled rejection: ${errorMsg}`);
      handle.status = 'error';
      db.updateEngagement(engagement.id, {
        status: 'error',
        stoppedAt: new Date().toISOString(),
      });
      db.updateSession(sessionId, {
        status: 'error',
        stoppedAt: new Date().toISOString(),
        error: errorMsg,
      });
      this.broadcaster.broadcast(engagement.id, {
        type: 'agent-error',
        data: { sessionId, error: errorMsg },
      });
    });

    console.log(`[session] agent.run() dispatched — session=${sessionId}`);
    return sessionId;
  }

  private async runAgent(
    handle: SessionHandle,
    engagement: Engagement,
    onEvent: (event: AgentEvent) => void,
    db: ParsDatabase,
  ): Promise<void> {
    try {
      this.broadcaster.broadcast(engagement.id, {
        type: 'agent-started',
        data: { sessionId: handle.sessionId, engagementId: engagement.id },
      });
      console.log(`[session] agent.run() starting — session=${handle.sessionId}`);

      const emit = (event: AgentEvent) => {
        onEvent(event);
        this.broadcaster.broadcast(engagement.id, {
          type: event.type,
          data: { sessionId: handle.sessionId, ...event },
        });
      };

      // Initial prompt — the agent decides what to do
      await handle.agent.run(
        `Begin penetration testing engagement "${engagement.name}" against ${engagement.targetUrl}. Follow the scope rules defined in the engagement configuration.`,
        handle.abortController.signal,
        emit,
      );

      handle.status = 'stopped';
      console.log(`[session] agent.run() completed — session=${handle.sessionId}`);

      // Update DB status to reflect completion
      db.updateEngagement(engagement.id, {
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
      });
      db.updateSession(handle.sessionId, {
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
      });

      this.broadcaster.broadcast(engagement.id, {
        type: 'agent-completed',
        data: { sessionId: handle.sessionId },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (handle.abortController.signal.aborted) {
        handle.status = 'stopped';
        console.log(`[session] agent.run() aborted — session=${handle.sessionId}`);
        db.updateSession(handle.sessionId, {
          status: 'stopped',
          stoppedAt: new Date().toISOString(),
        });
      } else {
        handle.status = 'error';
        console.error(`[session] agent.run() FAILED — session=${handle.sessionId}: ${errorMsg}`);
        db.updateEngagement(engagement.id, {
          status: 'error',
          stoppedAt: new Date().toISOString(),
        });
        db.updateSession(handle.sessionId, {
          status: 'error',
          stoppedAt: new Date().toISOString(),
          error: errorMsg,
        });
      }

      this.broadcaster.broadcast(engagement.id, {
        type: 'agent-error',
        data: { sessionId: handle.sessionId, error: errorMsg },
      });
    }
  }

  stopSession(sessionId: string): boolean {
    const handle = this.sessions.get(sessionId);
    if (!handle || handle.status !== 'running') return false;
    handle.abortController.abort();
    handle.status = 'stopped';
    return true;
  }

  getSession(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId);
  }

  getPermissionQueue(sessionId: string): PermissionRequest[] {
    return this.permissionQueues.get(sessionId) ?? [];
  }

  resolvePermission(sessionId: string, requestId: string, decision: Decision): boolean {
    const queue = this.permissionQueues.get(sessionId) ?? [];
    const idx = queue.findIndex((r) => r.id === requestId);
    if (idx < 0) return false;
    const removed = queue.splice(idx, 1);
    const request = removed[0];
    if (request) {
      request.resolve(decision);
      // Broadcast decision for frontend observability
      const handle = this.sessions.get(sessionId);
      if (handle) {
        this.broadcaster.broadcast(handle.engagementId, {
          type: decision === 'deny' ? 'permission-denied' : 'permission-approved',
          data: {
            sessionId,
            requestId,
            decision,
            tool: request.tool,
            summary: request.summary,
          },
        });
      }
    }
    return true;
  }

  private createWebPrompter(sessionId: string): Prompter {
    const manager = this;
    return {
      async ask(req, signal): Promise<Decision> {
        const requestId = `perm_${randomBytes(8).toString('hex')}`;
        const permissionRequest: PermissionRequest = {
          id: requestId,
          tool: req.tool,
          summary: req.summary,
          detail: req.detail,
          timestamp: new Date().toISOString(),
          resolve: () => {},
        };

        return new Promise<Decision>((resolve) => {
          permissionRequest.resolve = resolve;
          const queue = manager.permissionQueues.get(sessionId) ?? [];
          queue.push(permissionRequest);
          manager.permissionQueues.set(sessionId, queue);

          // Broadcast permission request to frontend
          const handle = manager.sessions.get(sessionId);
          if (handle) {
            manager.broadcaster.broadcast(handle.engagementId, {
              type: 'permission-required',
              data: {
                sessionId,
                requestId,
                tool: req.tool,
                summary: req.summary,
                detail: req.detail,
              },
            });
          }

          // Auto-deny after 5 minutes if no response
          const timeout = setTimeout(
            () => {
              resolve('deny');
              const q = manager.permissionQueues.get(sessionId) ?? [];
              const i = q.findIndex((r) => r.id === requestId);
              if (i >= 0) q.splice(i, 1);
              // Broadcast timeout denial
              const handle = manager.sessions.get(sessionId);
              if (handle) {
                manager.broadcaster.broadcast(handle.engagementId, {
                  type: 'permission-denied',
                  data: {
                    sessionId,
                    requestId,
                    decision: 'deny',
                    tool: req.tool,
                    summary: req.summary,
                    reason: 'timeout',
                  },
                });
              }
            },
            5 * 60 * 1000,
          );

          signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            resolve('deny');
          });
        });
      },
    };
  }

  private async createLLMClient(backend: string, model: string): Promise<Client> {
    const { newFromConfig } = await import('../../llm/factory.js');
    const { defaultConfig } = await import('../../config/config.js');
    const cfg = defaultConfig();
    cfg.backend = (backend || 'ollama') as Parameters<typeof newFromConfig>[0]['backend'];
    cfg.model = model || '';
    return newFromConfig(cfg);
  }
}

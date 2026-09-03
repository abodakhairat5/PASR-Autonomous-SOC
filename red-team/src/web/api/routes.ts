import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ParsDatabase } from '../persistence/database.js';
import type { EventBroadcaster } from '../realtime/broadcaster.js';
import type { SessionManager } from '../server/session-manager.js';
import {
  AuditFilterSchema,
  CreateEngagementSchema,
  EventFilterSchema,
  PaginationSchema,
  PermissionDecisionSchema,
  UpdateScopeSchema,
} from '../types/schemas.js';

export function registerEngagementRoutes(
  app: FastifyInstance,
  db: ParsDatabase,
  sessionManager: SessionManager,
  broadcaster: EventBroadcaster,
  dataDir: string,
): void {
  // GET /api/engagements
  app.get('/api/engagements', async (_req, reply) => {
    const engagements = db.listEngagements();
    return reply.send({ data: engagements });
  });

  // POST /api/engagements
  app.post('/api/engagements', async (req, reply) => {
    const parsed = CreateEngagementSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    const input = parsed.data;
    const id = `eng_${randomBytes(8).toString('hex')}`;
    const engagement = db.createEngagement({
      id,
      name: input.name,
      description: input.description ?? '',
      targetUrl: input.targetUrl,
      targetName: input.targetName ?? '',
      scopeJson: JSON.stringify(input.scope ?? {}),
      status: 'idle',
      sessionId: null,
      backend: input.backend ?? '',
      model: input.model ?? '',
      thinkingEnabled: input.thinkingEnabled ?? false,
      startedAt: null,
      stoppedAt: null,
    });

    return reply.status(201).send({ data: engagement });
  });

  // GET /api/engagements/:id
  app.get<{ Params: { id: string } }>('/api/engagements/:id', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }
    return reply.send({ data: engagement });
  });

  // DELETE /api/engagements/:id
  app.delete<{ Params: { id: string } }>('/api/engagements/:id', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }

    // Stop any running session
    if (engagement.sessionId) {
      sessionManager.stopSession(engagement.sessionId);
    }

    db.deleteEngagement(req.params.id);
    return reply.status(204).send();
  });

  // GET /api/engagements/:id/scope
  app.get<{ Params: { id: string } }>('/api/engagements/:id/scope', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }
    return reply.send({ data: JSON.parse(engagement.scopeJson) });
  });

  // PUT /api/engagements/:id/scope
  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/engagements/:id/scope',
    async (req, reply) => {
      const engagement = db.getEngagement(req.params.id);
      if (!engagement) {
        return reply.status(404).send({ error: 'Engagement not found' });
      }

      const parsed = UpdateScopeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      db.updateEngagement(req.params.id, {
        scopeJson: JSON.stringify(parsed.data.scope),
      });

      return reply.send({ data: JSON.parse(db.getEngagement(req.params.id)?.scopeJson ?? '{}') });
    },
  );

  // POST /api/engagements/:id/start
  app.post<{ Params: { id: string } }>('/api/engagements/:id/start', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }
    if (engagement.status === 'running') {
      return reply.status(409).send({ error: 'Engagement is already running' });
    }

    console.log(`[route] POST /start — engagement=${engagement.id}`);

    const sessionId = await sessionManager.startSession(
      engagement,
      (event) => {
        // Store events in database
        db.insertEvent({
          id: `evt_${randomBytes(8).toString('hex')}`,
          engagementId: engagement.id,
          sessionId,
          type: event.type,
          timestamp: new Date().toISOString(),
          dataJson: JSON.stringify(event),
        });

        // Store findings
        if (event.type === 'tool-result' && event.name === 'confirm_finding') {
          try {
            const finding = JSON.parse(event.result);
            db.insertFinding({
              id: `fnd_${randomBytes(8).toString('hex')}`,
              engagementId: engagement.id,
              sessionId,
              findingJson: event.result,
              severity: finding.severity ?? 'info',
              status: 'confirmed',
              createdAt: new Date().toISOString(),
            });
          } catch {
            // Not a finding result
          }
        }

        // Store evidence captures
        if (event.type === 'evidence-captured') {
          db.insertEvidence({
            id: event.evidenceId,
            engagementId: engagement.id,
            sessionId,
            type: 'unknown',
            tool: event.tool,
            hash: event.hash,
            evidenceJson: JSON.stringify(event),
            createdAt: new Date().toISOString(),
          });
        }

        // Store policy decisions
        if (event.type === 'policy-decision') {
          db.insertAuditEntry({
            id: `aud_${randomBytes(8).toString('hex')}`,
            engagementId: engagement.id,
            sessionId,
            kind: 'policy-decision',
            detailJson: JSON.stringify(event),
            timestamp: new Date().toISOString(),
          });
        }
      },
      db,
    );

    // Session record is now created inside startSession for atomicity.
    // Update engagement status unless startSession already set it to 'error'
    // (e.g. LLM client creation failed).
    const currentEngagement = db.getEngagement(req.params.id);
    if (currentEngagement && currentEngagement.status !== 'error') {
      db.updateEngagement(req.params.id, {
        status: 'running',
        sessionId,
        startedAt: new Date().toISOString(),
        stoppedAt: null,
      });
    }

    console.log(`[route] POST /start — session created session=${sessionId}`);
    return reply.status(201).send({ data: { sessionId } });
  });

  // POST /api/engagements/:id/stop
  app.post<{ Params: { id: string } }>('/api/engagements/:id/stop', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }
    if (!engagement.sessionId || engagement.status !== 'running') {
      return reply.status(409).send({ error: 'Engagement is not running' });
    }

    sessionManager.stopSession(engagement.sessionId);
    db.updateEngagement(req.params.id, {
      status: 'stopped',
      stoppedAt: new Date().toISOString(),
    });
    db.updateSession(engagement.sessionId, {
      status: 'stopped',
      stoppedAt: new Date().toISOString(),
    });

    return reply.send({ data: { status: 'stopped' } });
  });

  // GET /api/engagements/:id/status
  app.get<{ Params: { id: string } }>('/api/engagements/:id/status', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }
    return reply.send({
      data: {
        status: engagement.status,
        sessionId: engagement.sessionId,
        startedAt: engagement.startedAt,
        stoppedAt: engagement.stoppedAt,
      },
    });
  });

  // GET /api/engagements/:id/events
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    '/api/engagements/:id/events',
    async (req, reply) => {
      const engagement = db.getEngagement(req.params.id);
      if (!engagement) {
        return reply.status(404).send({ error: 'Engagement not found' });
      }

      const filter = EventFilterSchema.parse(req.query);
      const events = db.listEvents(req.params.id, {
        types: filter.types,
        since: filter.since,
        limit: filter.limit,
      });

      return reply.send({ data: events });
    },
  );

  // GET /api/engagements/:id/events/stream (SSE)
  app.get<{ Params: { id: string } }>('/api/engagements/:id/events/stream', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    broadcaster.subscribe(req.params.id, reply);

    // Send initial keepalive
    reply.raw.write(':ok\n\n');
  });

  // GET /api/engagements/:id/findings
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    '/api/engagements/:id/findings',
    async (req, reply) => {
      const engagement = db.getEngagement(req.params.id);
      if (!engagement) {
        return reply.status(404).send({ error: 'Engagement not found' });
      }

      const query = PaginationSchema.parse(req.query);
      const findings = db.listFindings(req.params.id);

      return reply.send({
        data: findings.slice(query.offset, query.offset + query.limit),
        total: findings.length,
      });
    },
  );

  // GET /api/engagements/:id/evidence
  app.get<{ Params: { id: string } }>('/api/engagements/:id/evidence', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }

    const evidence = db.listEvidence(req.params.id);
    return reply.send({ data: evidence });
  });

  // GET /api/engagements/:id/coverage
  app.get<{ Params: { id: string } }>('/api/engagements/:id/coverage', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }

    // Coverage is stored in the session files — return placeholder
    return reply.send({
      data: { entries: [], summary: { total: 0, byStatus: {}, byVulnClass: {} } },
    });
  });

  // GET /api/engagements/:id/evaluation
  app.get<{ Params: { id: string } }>('/api/engagements/:id/evaluation', async (req, reply) => {
    const engagement = db.getEngagement(req.params.id);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }

    // Load real evaluation data from session-scoped store
    const sessionId = engagement.sessionId;
    if (!sessionId) {
      return reply.send({ data: { snapshots: [], latest: null } });
    }

    const { EvaluationStore } = await import('../../evaluation/store.js');
    const { resolve } = await import('node:path');
    const evalStore = new EvaluationStore(resolve(dataDir, `evaluation-${sessionId}.json`));
    await evalStore.load();
    const snapshots = await evalStore.list();
    const latest = await evalStore.latest();
    return reply.send({ data: { snapshots, latest } });
  });

  // GET /api/engagements/:id/audit
  app.get<{ Params: { id: string }; Querystring: Record<string, unknown> }>(
    '/api/engagements/:id/audit',
    async (req, reply) => {
      const engagement = db.getEngagement(req.params.id);
      if (!engagement) {
        return reply.status(404).send({ error: 'Engagement not found' });
      }

      // Merge DB audit entries with session-scoped audit entries
      const dbEntries = db.listAuditEntries(req.params.id);

      const sessionId = engagement.sessionId;
      let sessionEntries: Array<{
        id: string;
        timestamp: string;
        kind: string;
        detail: Record<string, unknown>;
      }> = [];
      if (sessionId) {
        try {
          const { AuditLogger } = await import('../../audit/logger.js');
          const { resolve } = await import('node:path');
          const logger = new AuditLogger(resolve(dataDir, `audit-${sessionId}`));
          const allEntries = await logger.list();
          sessionEntries = allEntries.map((e) => ({
            id: e.id,
            timestamp: e.timestamp,
            kind: e.kind,
            detail: e.detail,
          }));
        } catch {
          // Audit directory may not exist yet
        }
      }

      // Merge and deduplicate by id
      const seen = new Set<string>();
      const merged = [...sessionEntries, ...dbEntries].filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });

      // Apply optional filters
      const query = AuditFilterSchema.parse(req.query);
      let filtered = merged;
      if (query.kind && query.kind.length > 0) {
        filtered = filtered.filter((e) => query.kind?.includes(e.kind));
      }
      if (query.since) {
        const since = query.since;
        filtered = filtered.filter((e) => e.timestamp >= since);
      }

      return reply.send({ data: filtered.slice(0, query.limit) });
    },
  );

  // POST /api/engagements/:engagementId/permissions/:requestId/decision
  app.post<{
    Params: { engagementId: string; requestId: string };
    Body: unknown;
  }>('/api/engagements/:engagementId/permissions/:requestId/decision', async (req, reply) => {
    const { engagementId, requestId } = req.params;

    // Validate input
    const parsed = PermissionDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }

    // Verify engagement exists
    const engagement = db.getEngagement(engagementId);
    if (!engagement) {
      return reply.status(404).send({ error: 'Engagement not found' });
    }

    // Verify session exists and belongs to this engagement
    const sessionId = engagement.sessionId;
    if (!sessionId) {
      return reply.status(409).send({ error: 'Engagement has no active session' });
    }

    const session = sessionManager.getSession(sessionId);
    if (!session || session.engagementId !== engagementId) {
      return reply.status(404).send({ error: 'Session not found for this engagement' });
    }

    // Verify the permission request exists in this session's queue
    const queue = sessionManager.getPermissionQueue(sessionId);
    const request = queue.find((r) => r.id === requestId);
    if (!request) {
      // Could be already resolved or non-existent
      return reply.status(404).send({ error: 'Permission request not found or already resolved' });
    }

    // Map frontend decision to PARS Core decision
    const decision =
      parsed.data.decision === 'approve' ? ('allow-once' as const) : ('deny' as const);

    // Resolve through the existing PARS permission mechanism
    const resolved = sessionManager.resolvePermission(sessionId, requestId, decision);
    if (!resolved) {
      return reply.status(404).send({ error: 'Permission request could not be resolved' });
    }

    // Broadcast decision event for frontend observability
    broadcaster.broadcast(engagementId, {
      type: 'permission-decision',
      data: {
        sessionId,
        requestId,
        decision,
        tool: request.tool,
        summary: request.summary,
      },
    });

    return reply.send({ data: { requestId, decision } });
  });

  // GET /api/engagements/:id/permissions/pending
  app.get<{ Params: { id: string } }>(
    '/api/engagements/:id/permissions/pending',
    async (req, reply) => {
      const engagement = db.getEngagement(req.params.id);
      if (!engagement) {
        return reply.status(404).send({ error: 'Engagement not found' });
      }

      const sessionId = engagement.sessionId;
      if (!sessionId) {
        return reply.send({ data: [] });
      }

      const queue = sessionManager.getPermissionQueue(sessionId);
      // Return permission requests without the resolve callback
      const pending = queue.map((r) => ({
        id: r.id,
        tool: r.tool,
        summary: r.summary,
        detail: r.detail,
        timestamp: r.timestamp,
      }));

      return reply.send({ data: pending });
    },
  );
}

export function registerFindingRoutes(app: FastifyInstance, db: ParsDatabase): void {
  // GET /api/findings/:id
  app.get<{ Params: { id: string } }>('/api/findings/:id', async (req, reply) => {
    const finding = db.getFinding(req.params.id);
    if (!finding) {
      return reply.status(404).send({ error: 'Finding not found' });
    }
    return reply.send({ data: finding });
  });

  // POST /api/findings/:id/retest
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/findings/:id/retest',
    async (req, reply) => {
      const finding = db.getFinding(req.params.id);
      if (!finding) {
        return reply.status(404).send({ error: 'Finding not found' });
      }

      // Retest would invoke PARS RetestEngine — for now return pending
      return reply.send({ data: { status: 'pending', findingId: req.params.id } });
    },
  );
}

export function registerEvidenceRoutes(app: FastifyInstance, db: ParsDatabase): void {
  // GET /api/evidence/:id
  app.get<{ Params: { id: string } }>('/api/evidence/:id', async (req, reply) => {
    const evidence = db.getEvidence(req.params.id);
    if (!evidence) {
      return reply.status(404).send({ error: 'Evidence not found' });
    }
    return reply.send({ data: evidence });
  });
}

export function registerHealthRoute(
  app: FastifyInstance,
  db: ParsDatabase,
  broadcaster: EventBroadcaster,
): void {
  // GET /api/health
  app.get('/api/health', async (_req, reply) => {
    const stats = db.getStats();
    return reply.send({
      data: {
        status: 'ok',
        version: '0.1.0-dev',
        uptime: process.uptime(),
        stats,
        sseClients: broadcaster.getTotalClients(),
      },
    });
  });
}

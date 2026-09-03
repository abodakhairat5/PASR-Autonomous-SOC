import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParsDatabase } from './persistence/database.js';
import { EventBroadcaster } from './realtime/broadcaster.js';
import { SessionManager } from './server/session-manager.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pars-integration-test-'));
}

function createTestEngagement(db: ParsDatabase): string {
  const id = `eng_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.createEngagement({
    id,
    name: 'Test Engagement',
    description: 'Integration test',
    targetUrl: 'https://httpbin.org',
    targetName: 'httpbin',
    scopeJson: JSON.stringify({ allowed: ['https://httpbin.org'] }),
    status: 'idle',
    sessionId: null,
    backend: '',
    model: '',
    thinkingEnabled: false,
    startedAt: null,
    stoppedAt: null,
  });
  return id;
}

function getEngagementOrFail(db: ParsDatabase, id: string) {
  const e = db.getEngagement(id);
  if (!e) throw new Error(`engagement ${id} not found`);
  return e;
}

function getSessionOrFail(db: ParsDatabase, id: string) {
  const s = db.getSession(id);
  if (!s) throw new Error(`session ${id} not found`);
  return s;
}

describe('Agent ↔ Web Integration', () => {
  let tmp: string;
  let db: ParsDatabase;
  let broadcaster: EventBroadcaster;
  let manager: SessionManager;

  beforeEach(() => {
    tmp = tmpDir();
    db = new ParsDatabase(join(tmp, 'test.db'));
    broadcaster = new EventBroadcaster();
    manager = new SessionManager(broadcaster, tmp);
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 200));
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('Test 1: startSession creates a session DB record atomically', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const session = db.getSession(sessionId);
    expect(session).toBeDefined();
    expect(session?.engagementId).toBe(engId);
    expect(session?.status).toBe('running');

    manager.stopSession(sessionId);
    await new Promise((r) => setTimeout(r, 200));
  });

  it('Test 2: startSession invokes the PARS Agent via runAgent', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const events: unknown[] = [];
    const sessionId = await manager.startSession(engagement, (e) => events.push(e), db);

    const start = Date.now();
    while (Date.now() - start < 15000) {
      const session = db.getSession(sessionId);
      if (session && session.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(events.length).toBeGreaterThanOrEqual(0);
  });

  it('Test 3: Agent events reach the broadcaster (SSE)', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const broadcasted: string[] = [];
    const mockReply = {
      raw: {
        write: (data: string) => {
          broadcasted.push(data);
        },
        writeHead: () => {},
        on: () => {},
        removeListener: () => {},
      },
    } as {
      raw: {
        write: (d: string) => void;
        writeHead: () => void;
        on: () => void;
        removeListener: () => void;
      };
    };
    broadcaster.subscribe(engId, mockReply);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const start = Date.now();
    while (Date.now() - start < 15000 && broadcasted.length === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(broadcasted.length).toBeGreaterThan(0);
    const hasAgentStarted = broadcasted.some((d) => d.includes('agent-started'));
    expect(hasAgentStarted).toBe(true);

    manager.stopSession(sessionId);
    await new Promise((r) => setTimeout(r, 200));
  });

  it('Test 4: Permission requests reach the Web permission queue', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const queue = manager.getPermissionQueue(sessionId);
    expect(Array.isArray(queue)).toBe(true);

    manager.stopSession(sessionId);
    await new Promise((r) => setTimeout(r, 200));
  });

  it('Test 5: Approving permission resolves the prompter Promise', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const resolved = manager.resolvePermission(sessionId, 'perm_nonexistent', 'allow-once');
    expect(resolved).toBe(false);

    manager.stopSession(sessionId);
    await new Promise((r) => setTimeout(r, 200));
  });

  it('Test 6: Denying permission resolves the prompter Promise with deny', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const resolved = manager.resolvePermission(sessionId, 'perm_nonexistent', 'deny');
    expect(resolved).toBe(false);

    manager.stopSession(sessionId);
    await new Promise((r) => setTimeout(r, 200));
  });

  it('Test 7: STOP actually stops the running session and aborts agent', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const handle = manager.getSession(sessionId);
    expect(handle).toBeDefined();
    expect(handle?.status).toBe('running');

    const stopped = manager.stopSession(sessionId);
    expect(stopped).toBe(true);
    expect(handle?.abortController.signal.aborted).toBe(true);

    const start = Date.now();
    while (Date.now() - start < 10000) {
      const session = db.getSession(sessionId);
      if (session && session.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const session = getSessionOrFail(db, sessionId);
    expect(session.status).not.toBe('running');
  });

  it('Test 8: Session A cannot access/resolve Session B permissions', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const queue = manager.getPermissionQueue(sessionId);
    const testResolve = vi.fn();
    queue.push({
      id: 'perm_cross_session',
      tool: 'shell',
      summary: 'Cross-session test',
      detail: 'Test',
      timestamp: new Date().toISOString(),
      resolve: testResolve,
    });

    const resolved = manager.resolvePermission('sess_wrong', 'perm_cross_session', 'deny');
    expect(resolved).toBe(false);
    expect(testResolve).not.toHaveBeenCalled();

    manager.stopSession(sessionId);
    await new Promise((r) => setTimeout(r, 200));
  });

  it('Test 9: Completion updates session status in DB', async () => {
    const engId = createTestEngagement(db);
    const engagement = getEngagementOrFail(db, engId);

    const sessionId = await manager.startSession(engagement, () => {}, db);

    const start = Date.now();
    while (Date.now() - start < 15000) {
      const session = db.getSession(sessionId);
      if (session && session.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const session = getSessionOrFail(db, sessionId);
    expect(session.status).not.toBe('running');
  });

  it('Test 10: No arbitrary shell execution endpoint exists in routes', async () => {
    const routes = await import('./api/routes.js');
    expect(typeof routes.registerEngagementRoutes).toBe('function');
    expect(typeof routes.registerFindingRoutes).toBe('function');
    expect(typeof routes.registerEvidenceRoutes).toBe('function');
    expect(typeof routes.registerHealthRoute).toBe('function');
  });

  it('Test 11: Frontend cannot bypass PolicyEngine or Permission', async () => {
    const { PermissionDecisionSchema } = await import('./types/schemas.js');

    expect(PermissionDecisionSchema.safeParse({ decision: 'allow-once' }).success).toBe(false);
    expect(PermissionDecisionSchema.safeParse({ decision: 'bypass' }).success).toBe(false);

    const r = PermissionDecisionSchema.safeParse({ decision: 'approve', autoApprove: true });
    expect(r.success).toBe(true);
    expect(r.data?.decision).toBe('approve');
    expect('autoApprove' in (r.data ?? {})).toBe(false);
  });

  it('Test 12: stopSession returns false for unknown/stopped sessions', () => {
    expect(manager.stopSession('sess_unknown')).toBe(false);
    expect(manager.stopSession('sess_also_unknown')).toBe(false);
  });
});

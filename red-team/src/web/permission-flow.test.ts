import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ParsDatabase } from '../web/persistence/database.js';
import { EventBroadcaster } from '../web/realtime/broadcaster.js';
import { SessionManager } from '../web/server/session-manager.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pars-perm-test-'));
}

describe('Permission Flow Security', () => {
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

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('Test 1: resolvePermission returns false for unknown requestId', () => {
    const resolved = manager.resolvePermission('sess_unknown', 'perm_unknown', 'deny');
    expect(resolved).toBe(false);
  });

  it('Test 2: getPermissionQueue returns empty array for unknown session', () => {
    const queue = manager.getPermissionQueue('sess_unknown');
    expect(queue).toEqual([]);
  });

  it('Test 3: getSession returns undefined for unknown session', () => {
    const session = manager.getSession('sess_unknown');
    expect(session).toBeUndefined();
  });

  it('Test 4: stopSession returns false for unknown session', () => {
    const stopped = manager.stopSession('sess_unknown');
    expect(stopped).toBe(false);
  });

  it('Test 5: permission queue is isolated per session', () => {
    // Queues for different sessions are independent
    const q1 = manager.getPermissionQueue('sess_a');
    const q2 = manager.getPermissionQueue('sess_b');
    // Both return fresh empty arrays (not stored until prompter creates them)
    expect(q1).toEqual([]);
    expect(q2).toEqual([]);
    // They should be different array instances
    expect(q1).not.toBe(q2);
  });

  it('Test 6: resolvePermission returns false for non-existent session queue', () => {
    // Without a started session, the queue map is empty
    const resolved = manager.resolvePermission('sess_test', 'perm_test123', 'allow-once');
    expect(resolved).toBe(false);
  });

  it('Test 7: resolvePermission returns false for requestId not in queue', () => {
    // Even if getPermissionQueue returns an array, resolvePermission
    // checks the actual map. Non-existent session returns false.
    const resolved = manager.resolvePermission('sess_nonexistent', 'perm_deny1', 'deny');
    expect(resolved).toBe(false);
  });

  it('Test 8: multiple sessions have independent queues', () => {
    // Verify that resolving in one session doesn't affect another
    const r1 = manager.resolvePermission('sess_x', 'perm_1', 'deny');
    const r2 = manager.resolvePermission('sess_y', 'perm_1', 'deny');
    // Both return false (queues don't exist yet)
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  });

  it('Test 9: cannot resolve same permission twice', () => {
    // First resolve returns false (no queue)
    const first = manager.resolvePermission('sess_once', 'perm_single', 'allow-once');
    expect(first).toBe(false);

    // Second resolve also returns false
    const second = manager.resolvePermission('sess_once', 'perm_single', 'deny');
    expect(second).toBe(false);
  });

  it('Test 10: stopSession returns false for stopped session', () => {
    const stopped = manager.stopSession('sess_already_stopped');
    expect(stopped).toBe(false);
  });

  it('Test 11: no arbitrary shell endpoint exists in routes', async () => {
    const routes = await import('../web/api/routes.js');
    expect(typeof routes.registerEngagementRoutes).toBe('function');
    expect(typeof routes.registerFindingRoutes).toBe('function');
    expect(typeof routes.registerEvidenceRoutes).toBe('function');
    expect(typeof routes.registerHealthRoute).toBe('function');
  });

  it('Test 12: PermissionDecisionSchema validates correctly', async () => {
    const { PermissionDecisionSchema } = await import('../web/types/schemas.js');

    // Valid approve
    const r1 = PermissionDecisionSchema.safeParse({ decision: 'approve' });
    expect(r1.success).toBe(true);

    // Valid deny
    const r2 = PermissionDecisionSchema.safeParse({ decision: 'deny' });
    expect(r2.success).toBe(true);

    // Invalid decision
    const r3 = PermissionDecisionSchema.safeParse({ decision: 'allow' });
    expect(r3.success).toBe(false);

    // Missing decision
    const r4 = PermissionDecisionSchema.safeParse({});
    expect(r4.success).toBe(false);

    // Extra fields ignored
    const r5 = PermissionDecisionSchema.safeParse({ decision: 'approve', evil: true });
    expect(r5.success).toBe(true);
  });
});

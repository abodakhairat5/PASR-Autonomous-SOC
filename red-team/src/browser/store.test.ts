import { describe, expect, it } from 'vitest';
import { CaptureStore } from './store.js';

describe('CaptureStore Burp bridge', () => {
  it('records Burp tasks and issues', () => {
    const store = new CaptureStore();
    const task = store.ingestBurpTask({
      action: 'scan',
      target: 'https://app.example.com/api/orders/1',
      method: 'GET',
      url: 'https://app.example.com/api/orders/1',
      host: 'app.example.com',
    });
    expect(task.ok).toBe(true);
    expect(store.listBurpTasks()[0]).toMatchObject({
      action: 'scan',
      target: 'https://app.example.com/api/orders/1',
    });

    const issue = store.ingestBurpIssue({
      id: 'finding:idor',
      title: 'IDOR on order lookup',
      severity: 'high',
      confidence: 'Certain',
      url: 'https://app.example.com/api/orders/1',
      detail: 'User B can read User A order.',
    });
    expect(issue.ok).toBe(true);
    expect(store.listBurpIssues()[0]).toMatchObject({
      id: 'finding:idor',
      title: 'IDOR on order lookup',
      severity: 'high',
    });
  });

  it('clears Burp bridge queues with capture state', () => {
    const store = new CaptureStore();
    store.ingestBurpTask({ action: 'plan', target: 'https://app.example.com' });
    store.ingestBurpIssue({
      title: 'Finding',
      url: 'https://app.example.com',
      detail: 'Evidence',
    });
    store.clear();
    expect(store.listBurpTasks()).toEqual([]);
    expect(store.listBurpIssues()).toEqual([]);
  });

  it('updates an existing Burp issue in place without duplicating it', () => {
    const store = new CaptureStore();
    store.ingestBurpIssue({
      id: 'finding:idor',
      title: 'IDOR (initial)',
      url: 'https://app.example.com/api/orders/1',
      detail: 'first pass',
    });
    store.ingestBurpIssue({
      id: 'finding:idor',
      title: 'IDOR (confirmed)',
      url: 'https://app.example.com/api/orders/1',
      detail: 'second pass',
    });
    const issues = store.listBurpIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.title).toBe('IDOR (confirmed)');
  });

  it('re-seeing a request id refreshes its LRU position so prune keeps it', () => {
    const store = new CaptureStore({ maxEntries: 100 });
    for (let i = 0; i < 100; i += 1) {
      store.ingest({ id: String(i), url: `https://app.example.com/r/${i}`, method: 'GET' });
    }
    // Refresh the oldest entry — it should move to the tail.
    store.ingest({ id: '0', url: 'https://app.example.com/r/0', method: 'GET' });
    // Push 50 more, evicting the 50 oldest (now ids 1..50, not the refreshed 0).
    for (let i = 100; i < 150; i += 1) {
      store.ingest({ id: String(i), url: `https://app.example.com/r/${i}`, method: 'GET' });
    }
    expect(store.getRequest('wr:0')).toBeDefined();
    expect(store.getRequest('wr:1')).toBeUndefined();
  });

  it('truncates large captured bodies before retaining them', () => {
    const store = new CaptureStore();
    store.ingest({
      url: 'https://app.example.com/api',
      method: 'GET',
      respBody: 'a'.repeat(100_000),
    });

    const body = store.listRequests()[0]?.responseBody ?? '';
    expect(body).toContain('truncated');
    expect(body.length).toBeLessThan(70_000);
  });
});

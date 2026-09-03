import { describe, expect, it } from 'vitest';
import { RetestEngine } from './engine.js';

describe('RetestEngine', () => {
  it('blocked-by-policy when policy denies', async () => {
    const evidenceStore = { create: async () => ({ id: 'ev_test' }) } as any;
    const policy = {
      evaluate: () => ({ action: 'deny' as const, reason: 'out of scope' }),
    } as any;
    const engine = new RetestEngine(evidenceStore, policy);
    const prompter = { ask: async () => 'allow-once' as const };
    const executor = async () => ({ output: '', exitCode: 0 });

    const result = await engine.retest(
      {
        findingId: 'f1',
        evidence: {
          id: 'ev_1',
          type: 'http',
          createdAt: '',
          tool: 'http',
          target: { url: 'https://evil.com' },
        },
      },
      new AbortController().signal,
      prompter,
      executor,
    );

    expect(result.lastResult).toBe('blocked-by-policy');
  });

  it('confirmed when retest succeeds', async () => {
    const createdEvidence: any[] = [];
    const evidenceStore = {
      create: async (input: any) => {
        const ev = { id: `ev_${createdEvidence.length}`, ...input };
        createdEvidence.push(ev);
        return ev;
      },
    } as any;
    const policy = {
      evaluate: () => ({ action: 'allow' as const, reason: 'ok' }),
    } as any;
    const engine = new RetestEngine(evidenceStore, policy);
    const prompter = { ask: async () => 'allow-once' as const };
    const executor = async () => ({ output: 'vuln confirmed', exitCode: 0 });

    const result = await engine.retest(
      {
        findingId: 'f2',
        evidence: {
          id: 'ev_1',
          type: 'command',
          createdAt: '',
          tool: 'shell',
          command: 'curl -s https://target/api',
        },
        reproduceCommand: 'curl -s https://target/api',
      },
      new AbortController().signal,
      prompter,
      executor,
    );

    expect(result.lastResult).toBe('confirmed');
    expect(result.history[0]?.evidenceId).toBeTruthy();
  });

  it('not-reproduced when command fails', async () => {
    const evidenceStore = { create: async () => ({ id: 'ev_test' }) } as any;
    const policy = {
      evaluate: () => ({ action: 'allow' as const, reason: 'ok' }),
    } as any;
    const engine = new RetestEngine(evidenceStore, policy);
    const prompter = { ask: async () => 'allow-once' as const };
    const executor = async () => ({ output: 'not found', exitCode: 1 });

    const result = await engine.retest(
      {
        findingId: 'f3',
        evidence: {
          id: 'ev_1',
          type: 'command',
          createdAt: '',
          tool: 'shell',
          command: 'curl https://target/api',
        },
      },
      new AbortController().signal,
      prompter,
      executor,
    );

    expect(result.lastResult).toBe('not-reproduced');
  });

  it('error when executor throws', async () => {
    const evidenceStore = { create: async () => ({ id: 'ev_test' }) } as any;
    const policy = {
      evaluate: () => ({ action: 'allow' as const, reason: 'ok' }),
    } as any;
    const engine = new RetestEngine(evidenceStore, policy);
    const prompter = { ask: async () => 'allow-once' as const };
    const executor = async () => {
      throw new Error('network error');
    };

    const result = await engine.retest(
      {
        findingId: 'f4',
        evidence: {
          id: 'ev_1',
          type: 'command',
          createdAt: '',
          tool: 'shell',
          command: 'curl https://target',
        },
      },
      new AbortController().signal,
      prompter,
      executor,
    );

    expect(result.lastResult).toBe('error');
    expect(result.history[0]?.error).toBe('network error');
  });
});

// End-to-end agent loop test using a fake LLM client. Exercises:
//   - user message → assistant tool call → tool result → final assistant text
//   - signal abort propagates
//   - tool failure surfaces as tool-result with err

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IntelligenceStore } from '../intelligence/store.js';
import type { Client } from '../llm/client.js';
import type { ChatRequest, ChatResponse } from '../llm/types.js';
import { MemoryStore } from '../memory/store.js';
import { AlwaysAllow } from '../permission/permission.js';
import { Store as SessionStore, newID as newSessionID } from '../session/store.js';
import { Registry as SkillRegistry } from '../skills/registry.js';
import { Target } from '../target/target.js';
import { Registry as ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/types.js';
import { Agent, reconcileToolCalls } from './agent.js';
import type { AgentEvent } from './events.js';

// Minimal fake client: scripted responses cycled per chat() call.
class FakeClient implements Client {
  private scripted: ChatResponse[];
  private idx = 0;
  readonly requests: ChatRequest[] = [];
  constructor(scripted: ChatResponse[]) {
    this.scripted = scripted;
  }
  name(): string {
    return 'fake';
  }
  model(): string {
    return 'fake-model';
  }
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    const r = this.scripted[this.idx++];
    if (!r) throw new Error('FakeClient: script exhausted');
    return r;
  }
}

class EchoTool implements Tool {
  calls = 0;
  name(): string {
    return 'echo';
  }
  description(): string {
    return 'echo';
  }
  schema(): Record<string, unknown> {
    return { type: 'object', properties: { msg: { type: 'string' } } };
  }
  requiresPermission(): boolean {
    return false;
  }
  async run(args: Record<string, unknown>): Promise<string> {
    this.calls += 1;
    return `echoed: ${String(args.msg ?? '')}`;
  }
}

function makeAgent(scripted: ChatResponse[]): Agent {
  return makeAgentWithClient(scripted).agent;
}

function makeAgentWithClient(scripted: ChatResponse[]): {
  agent: Agent;
  client: FakeClient;
  tool: EchoTool;
} {
  const tools = new ToolRegistry();
  const tool = new EchoTool();
  tools.register(tool);
  const client = new FakeClient(scripted);
  const agent = new Agent({
    client,
    tools,
    skills: new SkillRegistry(),
    prompter: new AlwaysAllow(),
    store: null,
    target: new Target(),
  });
  return { agent, client, tool };
}

function makeAgentWithSkills(
  scripted: ChatResponse[],
  skills: SkillRegistry,
): {
  agent: Agent;
  client: FakeClient;
} {
  const client = new FakeClient(scripted);
  const agent = new Agent({
    client,
    tools: new ToolRegistry(),
    skills,
    prompter: new AlwaysAllow(),
    store: null,
    target: new Target(),
  });
  return { agent, client };
}

function collect(): { events: AgentEvent[]; sink: (e: AgentEvent) => void } {
  const events: AgentEvent[] = [];
  return { events, sink: (e: AgentEvent) => events.push(e) };
}

describe('Agent.run', () => {
  it('completes a turn with a single assistant text response', async () => {
    const a = makeAgent([
      {
        message: { role: 'assistant', content: 'hello there' },
        finishReason: 'stop',
      },
    ]);
    const { events, sink } = collect();
    await a.run('hi', new AbortController().signal, sink);
    const texts = events.filter((e) => e.type === 'assistant-text');
    expect(texts).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('runs a tool call and feeds the result back into the loop', async () => {
    const a = makeAgent([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'echo', arguments: JSON.stringify({ msg: 'ping' }) },
            },
          ],
        },
        finishReason: 'tool_calls',
      },
      {
        message: { role: 'assistant', content: 'done' },
        finishReason: 'stop',
      },
    ]);
    const { events, sink } = collect();
    await a.run('do it', new AbortController().signal, sink);
    const types = events.map((e) => e.type);
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    const result = events.find((e) => e.type === 'tool-result');
    expect(result && result.type === 'tool-result' ? result.result : '').toContain('echoed: ping');
  });

  it('omits tool definitions when tools are disabled for a turn', async () => {
    const { agent, client } = makeAgentWithClient([
      {
        message: { role: 'assistant', content: 'plan only' },
        finishReason: 'stop',
      },
    ]);
    const { sink } = collect();
    await agent.run('make a plan', new AbortController().signal, sink, { tools: false });
    expect(client.requests[0]?.tools).toBeUndefined();
  });

  it('can switch to a compact system prompt profile before the next request', async () => {
    const { agent, client } = makeAgentWithClient([
      {
        message: { role: 'assistant', content: 'ok' },
        finishReason: 'stop',
      },
    ]);
    const fullPrompt = agent.getHistory()[0]?.content ?? '';
    expect(fullPrompt).toContain('Creative hunter mindset');

    agent.setPromptProfile('compact');
    const compactPrompt = agent.getHistory()[0]?.content ?? '';
    expect(compactPrompt).toContain('Human-in-the-Loop Agentic AI CLI assistant');
    expect(compactPrompt).not.toContain('Creative hunter mindset');
    expect(compactPrompt.length).toBeLessThan(fullPrompt.length / 3);

    const { sink } = collect();
    await agent.run('hello', new AbortController().signal, sink, { tools: false });
    expect(client.requests[0]?.messages[0]?.content).toBe(compactPrompt);
  });

  it('does not execute returned tool calls when tools are disabled', async () => {
    const { agent, tool } = makeAgentWithClient([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'echo', arguments: '{"msg":"blocked"}' },
            },
          ],
        },
        finishReason: 'tool_calls',
      },
    ]);
    const { events, sink } = collect();
    await agent.run('make a plan', new AbortController().signal, sink, { tools: false });
    expect(tool.calls).toBe(0);
    expect(events).toContainEqual({
      type: 'error',
      err: expect.objectContaining({ message: 'plan-only mode blocked tool calls' }),
    });
  });

  it('injects decision guidance before the user message for normal turns', async () => {
    const skills = new SkillRegistry();
    skills.add({
      name: 'recon',
      description: 'External recon playbook for subdomain enumeration',
      tools: [],
      disableModelInvocation: false,
      path: '/tmp/recon/SKILL.md',
      body: '',
    });
    const { agent, client } = makeAgentWithSkills(
      [
        {
          message: { role: 'assistant', content: 'ok' },
          finishReason: 'stop',
        },
      ],
      skills,
    );
    const { events, sink } = collect();
    await agent.run('enumerate subdomains for example.com', new AbortController().signal, sink);

    expect(events).toContainEqual({
      type: 'decision',
      summary: expect.stringContaining('selected skill: recon'),
    });
    const messages = client.requests[0]?.messages ?? [];
    expect(messages.at(-3)).toMatchObject({
      role: 'system',
      content: expect.stringContaining('Decision planner guidance'),
    });
    expect(messages.at(-2)).toMatchObject({
      role: 'user',
      content: 'enumerate subdomains for example.com',
    });
  });

  it('injects local intelligence guidance for matching scan context', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pf-agent-intel-'));
    try {
      const client = new FakeClient([
        {
          message: { role: 'assistant', content: 'ok' },
          finishReason: 'stop',
        },
      ]);
      const agent = new Agent({
        client,
        tools: new ToolRegistry(),
        skills: new SkillRegistry(),
        prompter: new AlwaysAllow(),
        store: null,
        target: new Target(),
        intelligence: new IntelligenceStore({ cwd: join(tmp, 'project'), home: join(tmp, 'home') }),
      });
      const { sink } = collect();
      await agent.run(
        'scan a Node Express app where /server.js and /package.json were exposed',
        new AbortController().signal,
        sink,
        { tools: false },
      );

      const messages = client.requests[0]?.messages ?? [];
      expect(messages.some((m) => m.content.includes('Local PentesterFlow Intelligence'))).toBe(
        true,
      );
      expect(messages.some((m) => m.content.includes('ecosystem.config.js'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('learns continuous memory from substantive (tool-using) turns', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pf-agent-learn-'));
    try {
      // A turn must execute ≥1 successful tool call to be learned from, so
      // script a tool call then a final text answer. End-of-turn learning is
      // fire-and-forget (void), so poll until it settles.
      const tools = new ToolRegistry();
      tools.register(new EchoTool());
      const client = new FakeClient([
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'echo', arguments: JSON.stringify({ msg: 'check' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'noted' }, finishReason: 'stop' },
      ]);
      const intelligence = new IntelligenceStore({
        cwd: join(tmp, 'project'),
        home: join(tmp, 'home'),
      });
      const agent = new Agent({
        client,
        tools,
        skills: new SkillRegistry(),
        prompter: new AlwaysAllow(),
        store: null,
        target: new Target(),
        intelligence,
      });
      const { sink } = collect();

      await agent.run(
        'I prefer concise final answers with verification commands.',
        new AbortController().signal,
        sink,
      );

      let category: string | undefined;
      for (let i = 0; i < 100; i += 1) {
        category = intelligence.search('concise final answers verification', 3)[0]?.scenario
          .category;
        if (category) break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(category).toBe('user-preference');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not learn from a turn with no tool calls (no KB pollution)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pf-agent-nolearn-'));
    try {
      const intelligence = new IntelligenceStore({
        cwd: join(tmp, 'project'),
        home: join(tmp, 'home'),
      });
      const agent = new Agent({
        client: new FakeClient([
          { message: { role: 'assistant', content: 'noted' }, finishReason: 'stop' },
        ]),
        tools: new ToolRegistry(),
        skills: new SkillRegistry(),
        prompter: new AlwaysAllow(),
        store: null,
        target: new Target(),
        intelligence,
      });
      const { sink } = collect();
      await agent.run(
        'I prefer concise final answers with verification commands.',
        new AbortController().signal,
        sink,
        { tools: false },
      );
      // Give any (incorrectly fired) background learning a chance to land.
      await new Promise((r) => setTimeout(r, 50));
      expect(intelligence.search('concise final answers verification', 3)).toHaveLength(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips decision guidance for plan-only turns', async () => {
    const skills = new SkillRegistry();
    skills.add({
      name: 'recon',
      description: 'External recon playbook for subdomain enumeration',
      tools: [],
      disableModelInvocation: false,
      path: '/tmp/recon/SKILL.md',
      body: '',
    });
    const { agent, client } = makeAgentWithSkills(
      [
        {
          message: { role: 'assistant', content: 'plan' },
          finishReason: 'stop',
        },
      ],
      skills,
    );
    const { events, sink } = collect();
    await agent.run('plan recon for example.com', new AbortController().signal, sink, {
      tools: false,
    });

    expect(events.some((e) => e.type === 'decision')).toBe(false);
    expect(client.requests[0]?.messages.some((m) => m.content.includes('Decision planner'))).toBe(
      false,
    );
  });

  it('surfaces a tool failure as a tool-result with err set', async () => {
    const a = makeAgent([
      {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_x',
              type: 'function',
              function: { name: 'nonexistent', arguments: '{}' },
            },
          ],
        },
        finishReason: 'tool_calls',
      },
      {
        message: { role: 'assistant', content: 'oh well' },
        finishReason: 'stop',
      },
    ]);
    const { events, sink } = collect();
    await a.run('go', new AbortController().signal, sink);
    const result = events.find((e) => e.type === 'tool-result');
    expect(result && result.type === 'tool-result' ? result.err : '').toContain('unknown tool');
  });

  it('auto-compacts before the next turn when over threshold', async () => {
    // Two scripted responses: the first is the compaction summary
    // (a single assistant message in response to the compaction
    // request), the second answers the user's actual turn.
    const compactSummary: ChatResponse = {
      message: { role: 'assistant', content: 'Compacted summary of prior turn.' },
      finishReason: 'stop',
    };
    const userTurn: ChatResponse = {
      message: { role: 'assistant', content: 'answer' },
      finishReason: 'stop',
    };

    const tools = new ToolRegistry();
    tools.register(new EchoTool());
    const agent = new Agent({
      client: new FakeClient([compactSummary, userTurn]),
      tools,
      skills: new SkillRegistry(),
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
      autoCompactThreshold: 1, // pretty much always fires
    });

    const { events, sink } = collect();
    await agent.run('hi', new AbortController().signal, sink);
    const compactEvents = events.filter((e) => e.type === 'compact');
    // We expect two compact events: "triggered" + "after" outcome.
    expect(compactEvents.length).toBeGreaterThanOrEqual(2);
    const last = compactEvents[compactEvents.length - 1];
    expect(last && last.type === 'compact' ? last.summary : '').toContain('auto-compacted');
  });

  it('stores structured memory after manual compaction', async () => {
    const summary = [
      '## Current objective',
      '- Test horizontal authorization on orders API',
      '## Tested surface',
      '- Replayed GET /api/orders/100 as USER_B and received 403',
      '## Findings and evidence',
      '- Confirmed IDOR on GET /api/invoices/200 with USER_A token',
      '## Files and commands',
      '- `curl https://app.example.com/api/invoices/200`',
      '- findings/invoice-idor.md',
      '## Credentials and placeholders',
      '- USER_A_TOKEN and USER_B_TOKEN placeholders only',
      '## Open TODOs',
      '- Retest invoice download endpoint',
    ].join('\n');
    const { agent } = makeAgentWithClient([
      {
        message: { role: 'assistant', content: 'first turn' },
        finishReason: 'stop',
      },
      {
        message: { role: 'assistant', content: summary },
        finishReason: 'stop',
      },
    ]);
    const { sink } = collect();
    await agent.run('start testing authz', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);

    const memory = agent.formatMemory();
    expect(memory).toContain('Test horizontal authorization');
    expect(memory).toContain('Confirmed IDOR');
    expect(memory).toContain('USER_A_TOKEN');
    expect(agent.getMemoryStats().items).toBeGreaterThan(0);
  });

  it('parses Plan and Completed tasks headings into structured memory', async () => {
    const summary = [
      '## Current objective',
      '- Test authz on orders API',
      '## Plan',
      '- Map endpoints, then probe IDOR, then privilege escalation',
      '## Completed tasks',
      '- Enumerated the orders and invoices endpoints',
      '## Open TODOs',
      '- Probe the export endpoint next',
    ].join('\n');
    const { agent } = makeAgentWithClient([
      { message: { role: 'assistant', content: 'first turn' }, finishReason: 'stop' },
      { message: { role: 'assistant', content: summary }, finishReason: 'stop' },
    ]);
    const { sink } = collect();
    await agent.run('start', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);

    const memory = agent.formatMemory();
    expect(memory).toContain('Plan');
    expect(memory).toContain('Map endpoints, then probe IDOR');
    expect(memory).toContain('Completed');
    expect(memory).toContain('Enumerated the orders and invoices endpoints');
  });

  it('injects carried memory into the system prompt after compaction', async () => {
    const summary = [
      '## Current objective',
      '- Test horizontal authorization on orders API',
      '## Findings and evidence',
      '- Confirmed IDOR on GET /api/invoices/200',
    ].join('\n');
    const { agent } = makeAgentWithClient([
      { message: { role: 'assistant', content: 'first turn' }, finishReason: 'stop' },
      { message: { role: 'assistant', content: summary }, finishReason: 'stop' },
    ]);
    const { sink } = collect();
    await agent.run('start', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);

    // The system prompt (history[0]) is sent on every request — carried state
    // must live there so it survives the next compaction, not just in the
    // throwaway summary user-message.
    const systemPrompt = agent.getHistory()[0]?.content ?? '';
    expect(systemPrompt).toContain('Carried session state');
    expect(systemPrompt).toContain('Confirmed IDOR on GET /api/invoices/200');
  });

  it('accumulates earlier compactions in the system prompt across a second compaction', async () => {
    const first = '## Findings and evidence\n- Finding from compaction ONE';
    const second = '## Findings and evidence\n- Finding from compaction TWO';
    const { agent } = makeAgentWithClient([
      { message: { role: 'assistant', content: 'turn 1' }, finishReason: 'stop' },
      { message: { role: 'assistant', content: first }, finishReason: 'stop' },
      { message: { role: 'assistant', content: 'turn 2' }, finishReason: 'stop' },
      { message: { role: 'assistant', content: second }, finishReason: 'stop' },
    ]);
    const { sink } = collect();
    await agent.run('first', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);
    await agent.run('second', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);

    const systemPrompt = agent.getHistory()[0]?.content ?? '';
    // Both findings reach the model even though only the latest summary lives
    // in the history user-message — this is the duplicate-work fix.
    expect(systemPrompt).toContain('Finding from compaction ONE');
    expect(systemPrompt).toContain('Finding from compaction TWO');
  });

  it('restores carried memory into the system prompt on resume', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pf-agent-resume-'));
    try {
      const id = newSessionID();
      const summary = [
        '## Current objective',
        '- Test horizontal authorization on orders API',
        '## Findings and evidence',
        '- Confirmed IDOR on GET /api/invoices/200',
      ].join('\n');

      const tools = new ToolRegistry();
      const first = new Agent({
        client: new FakeClient([
          { message: { role: 'assistant', content: 'first turn' }, finishReason: 'stop' },
          { message: { role: 'assistant', content: summary }, finishReason: 'stop' },
        ]),
        tools,
        skills: new SkillRegistry(),
        prompter: new AlwaysAllow(),
        store: SessionStore.newWithID(tmp, id),
        target: new Target(),
      });
      const { sink } = collect();
      await first.run('start', new AbortController().signal, sink);
      await first.compact(new AbortController().signal, sink);

      // Fresh process: a new Agent pointed at the same saved session.
      const resumed = new Agent({
        client: new FakeClient([]),
        tools: new ToolRegistry(),
        skills: new SkillRegistry(),
        prompter: new AlwaysAllow(),
        store: SessionStore.newWithID(tmp, id),
        target: new Target(),
      });
      resumed.resumeSaved();

      const systemPrompt = resumed.getHistory()[0]?.content ?? '';
      expect(systemPrompt).toContain('Carried session state');
      expect(systemPrompt).toContain('Confirmed IDOR on GET /api/invoices/200');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('injects operator-authored engagement notes into the system prompt', () => {
    const agent = new Agent({
      client: new FakeClient([]),
      tools: new ToolRegistry(),
      skills: new SkillRegistry(),
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
      engagement: 'Out of scope: *.corp.internal\nTest account: USER_A_TOKEN',
    });
    const systemPrompt = agent.getHistory()[0]?.content ?? '';
    expect(systemPrompt).toContain('Engagement notes (operator-authored');
    expect(systemPrompt).toContain('Out of scope: *.corp.internal');
  });

  it('renders a staleness caveat above the carried memory block', async () => {
    const summary = '## Findings and evidence\n- Confirmed IDOR on /api/invoices/200';
    const { agent } = makeAgentWithClient([
      { message: { role: 'assistant', content: 'turn' }, finishReason: 'stop' },
      { message: { role: 'assistant', content: summary }, finishReason: 'stop' },
    ]);
    const { sink } = collect();
    await agent.run('start', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);
    expect(agent.getHistory()[0]?.content ?? '').toContain('verify it still holds');
  });

  it('clearMemory wipes the carried state from the system prompt', async () => {
    const summary = '## Findings and evidence\n- Confirmed IDOR on /api/invoices/200';
    const { agent } = makeAgentWithClient([
      { message: { role: 'assistant', content: 'turn' }, finishReason: 'stop' },
      { message: { role: 'assistant', content: summary }, finishReason: 'stop' },
    ]);
    const { sink } = collect();
    await agent.run('start', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);
    expect(agent.getHistory()[0]?.content ?? '').toContain('Confirmed IDOR');

    await agent.clearMemory();
    expect(agent.getHistory()[0]?.content ?? '').not.toContain('Carried session state');
    expect(agent.getMemoryStats().items).toBe(0);
  });

  it('forgetMemory drops only matching items from the carried state', async () => {
    const summary = [
      '## Findings and evidence',
      '- Confirmed IDOR on /api/invoices/200',
      '- XSS in the search box',
    ].join('\n');
    const { agent } = makeAgentWithClient([
      { message: { role: 'assistant', content: 'turn' }, finishReason: 'stop' },
      { message: { role: 'assistant', content: summary }, finishReason: 'stop' },
    ]);
    const { sink } = collect();
    await agent.run('start', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);

    const removed = await agent.forgetMemory('IDOR');
    expect(removed).toHaveLength(1);
    const systemPrompt = agent.getHistory()[0]?.content ?? '';
    expect(systemPrompt).not.toContain('Confirmed IDOR');
    expect(systemPrompt).toContain('XSS in the search box');
  });

  it('caps the findings list so a long engagement cannot grow unbounded', async () => {
    const scripted: ChatResponse[] = [];
    // 250 compactions, each adding one unique finding (> the 200 cap).
    const total = 250;
    for (let i = 0; i < total; i += 1) {
      scripted.push({ message: { role: 'assistant', content: `turn ${i}` }, finishReason: 'stop' });
      scripted.push({
        message: { role: 'assistant', content: `## Findings and evidence\n- finding number ${i}` },
        finishReason: 'stop',
      });
    }
    const { agent } = makeAgentWithClient(scripted);
    for (let i = 0; i < total; i += 1) {
      const { sink } = collect();
      await agent.run(`turn ${i}`, new AbortController().signal, sink);
      await agent.compact(new AbortController().signal, sink);
    }
    // formatMemory only shows the last 8, so assert via stats: total items is
    // bounded (findings capped at 200; the single objective-less summary adds
    // nothing else of size). The newest finding must still be present.
    expect(agent.getMemoryStats().items).toBeLessThanOrEqual(200);
    expect(agent.formatMemory()).toContain(`finding number ${total - 1}`);
  });

  it('bounds oversized compaction input so small-TPM providers can recover', async () => {
    const huge = `older context ${'x'.repeat(100_000)}`;
    const { agent, client } = makeAgentWithClient([
      {
        message: { role: 'assistant', content: huge },
        finishReason: 'stop',
      },
      {
        message: { role: 'assistant', content: '## Current objective\n- keep going' },
        finishReason: 'stop',
      },
    ]);
    const { sink } = collect();
    await agent.run('start', new AbortController().signal, sink);
    await agent.compact(new AbortController().signal, sink);

    const compactReq = client.requests[1];
    const compactText = compactReq?.messages[1]?.content ?? '';
    expect(compactText.length).toBeLessThan(23_000);
    expect(compactText).toContain('Older conversation text was omitted');
  });

  it('circuit-breaker stops retrying auto-compact after 3 failures', async () => {
    // Every chat call throws — auto-compact should fail, increment the
    // counter, and after 3 failures stop trying. We seed enough tokens
    // by passing a very low threshold.
    class FlakyClient implements Client {
      calls = 0;
      name() {
        return 'flaky';
      }
      model() {
        return 'm';
      }
      async chat(): Promise<ChatResponse> {
        this.calls += 1;
        throw new Error('compact-fail');
      }
    }
    const flaky = new FlakyClient();
    const agent = new Agent({
      client: flaky,
      tools: new ToolRegistry(),
      skills: new SkillRegistry(),
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
      autoCompactThreshold: 1,
    });
    // Drive 5 turns. The first 3 attempt auto-compact (each does 1 chat
    // call: the compaction request, which throws); the 4th and 5th
    // skip compaction entirely. The follow-up Run still tries to call
    // the model — that's 1 more call per turn. So: 3 compaction calls
    // + 5 turn calls = 8 total. The exact ratio isn't the point; what
    // we care about is that the compaction *attempts* cap at 3.
    for (let i = 0; i < 5; i += 1) {
      const { sink } = collect();
      await agent.run(`turn ${i}`, new AbortController().signal, sink);
    }
    // 3 compaction attempts (each made 1 chat call) + 5 turn attempts
    // (each made 1 chat call) = 8.
    expect(flaky.calls).toBe(8);
  });

  it('emits an error event when a panic escapes', async () => {
    class CrashClient implements Client {
      name() {
        return 'crash';
      }
      model() {
        return 'm';
      }
      async chat(): Promise<ChatResponse> {
        throw new Error('boom');
      }
    }
    const a = new Agent({
      client: new CrashClient(),
      tools: new ToolRegistry(),
      skills: new SkillRegistry(),
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
    });
    const { events, sink } = collect();
    await a.run('x', new AbortController().signal, sink);
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('renders user cancellation without leaking backend abort text', async () => {
    class AbortClient implements Client {
      name() {
        return 'ollama';
      }
      model() {
        return 'm';
      }
      async chat(_req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
        signal?.throwIfAborted();
        throw new Error('ollama: The operation was aborted.');
      }
    }
    const a = new Agent({
      client: new AbortClient(),
      tools: new ToolRegistry(),
      skills: new SkillRegistry(),
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
    });
    const ctl = new AbortController();
    const { events, sink } = collect();
    ctl.abort();
    await a.run('x', ctl.signal, sink);
    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent && errorEvent.type === 'error' ? errorEvent.err.message : '').toBe(
      'turn cancelled',
    );
    expect(events.at(-1)?.type).toBe('done');
  });

  // ----- allowed-tools enforcement (Tier 1 #3) -----

  // A capability tool (requiresPermission=true) that the test will try
  // to invoke under skill restriction.
  class RestrictedShellTool implements Tool {
    name(): string {
      return 'shell';
    }
    description(): string {
      return 'shell';
    }
    schema(): Record<string, unknown> {
      return { type: 'object', properties: { command: { type: 'string' } } };
    }
    requiresPermission(): boolean {
      return true; // subject to the skill allowlist
    }
    async run(args: Record<string, unknown>): Promise<string> {
      return `ran: ${String(args.command ?? '')}`;
    }
  }

  // The load_skill replacement for these tests — built-in registry's
  // LoadSkillTool would re-parse from disk; here we just synthesize the
  // tool result directly so we can craft minimal skills.
  function fakeLoadSkillTool(reg: SkillRegistry): Tool {
    return {
      name: () => 'load_skill',
      description: () => 'load_skill',
      schema: () => ({ type: 'object', properties: { name: { type: 'string' } } }),
      requiresPermission: () => false, // workflow → always allowed
      async run(args: Record<string, unknown>) {
        const nm = typeof args.name === 'string' ? args.name : '';
        const s = reg.get(nm);
        if (!s) throw new Error(`unknown ${nm}`);
        return s.body;
      },
    };
  }

  function makeAgentWithSkill(
    scripted: ChatResponse[],
    skillTools: string[],
  ): { agent: Agent; events: AgentEvent[]; sink: (e: AgentEvent) => void } {
    const tools = new ToolRegistry();
    tools.register(new EchoTool());
    tools.register(new RestrictedShellTool());
    const skills = new SkillRegistry();
    skills.add({
      name: 'narrow',
      description: 'narrow skill',
      tools: skillTools,
      disableModelInvocation: false,
      path: '/virtual/narrow/SKILL.md',
      body: '# narrow body',
    });
    tools.register(fakeLoadSkillTool(skills));
    const agent = new Agent({
      client: new FakeClient(scripted),
      tools,
      skills,
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
    });
    const { events, sink } = collect();
    return { agent, events, sink };
  }

  it("blocks a capability tool not listed in the active skill's allowed-tools", async () => {
    // Loop: 1) load_skill(narrow) → 2) shell — should be blocked because
    // `narrow` only allows `echo`; 3) final assistant text.
    const { agent, events, sink } = makeAgentWithSkill(
      [
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'load_skill', arguments: JSON.stringify({ name: 'narrow' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'shell', arguments: JSON.stringify({ command: 'id' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'understood' }, finishReason: 'stop' },
      ],
      ['echo'], // narrow's allowed tools — shell NOT in here
    );
    await agent.run('go', new AbortController().signal, sink);
    const shellResult = events.find((e) => e.type === 'tool-result' && e.name === 'shell');
    expect(shellResult && shellResult.type === 'tool-result' ? shellResult.err : '').toMatch(
      /not in any active skill/,
    );
  });

  it("allows a capability tool listed in the active skill's allowed-tools", async () => {
    const { agent, events, sink } = makeAgentWithSkill(
      [
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'load_skill', arguments: JSON.stringify({ name: 'narrow' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'shell', arguments: JSON.stringify({ command: 'id' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' },
      ],
      ['shell', 'echo'], // narrow allows both
    );
    await agent.run('go', new AbortController().signal, sink);
    const shellResult = events.find((e) => e.type === 'tool-result' && e.name === 'shell');
    expect(shellResult && shellResult.type === 'tool-result' ? shellResult.err : '').toBe('');
    expect(shellResult && shellResult.type === 'tool-result' ? shellResult.result : '').toContain(
      'ran:',
    );
  });

  it('treats an active skill with empty allowed-tools as no restriction (CC semantics)', async () => {
    // `narrow` omits allowed-tools → it should NOT narrow anything, so
    // shell runs even though the skill is active.
    const { agent, events, sink } = makeAgentWithSkill(
      [
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'load_skill', arguments: JSON.stringify({ name: 'narrow' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'shell', arguments: JSON.stringify({ command: 'id' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' },
      ],
      [], // empty allowed-tools → unrestricted
    );
    await agent.run('go', new AbortController().signal, sink);
    const shellResult = events.find((e) => e.type === 'tool-result' && e.name === 'shell');
    expect(shellResult && shellResult.type === 'tool-result' ? shellResult.err : '').toBe('');
  });

  it('places no restriction when no skill has been loaded yet', async () => {
    // No load_skill call — `shell` should run freely.
    const { agent, events, sink } = makeAgentWithSkill(
      [
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_x',
                type: 'function',
                function: { name: 'shell', arguments: JSON.stringify({ command: 'whoami' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'done' }, finishReason: 'stop' },
      ],
      ['echo'],
    );
    await agent.run('go', new AbortController().signal, sink);
    const r = events.find((e) => e.type === 'tool-result' && e.name === 'shell');
    expect(r && r.type === 'tool-result' ? r.err : '').toBe('');
  });

  it('allows BashTool when the active skill declared "shell" (alias equivalence)', async () => {
    // Regression for: pentesterflow registers shell + BashTool side-by-
    // side; some models reach for BashTool, but skill
    // authors write the Unix `shell` in their `tools:` list. The
    // enforcer canonicalizes both sides so the call goes through.
    const tools = new ToolRegistry();
    // Register both names pointing at the same underlying tool.
    tools.register({
      name: () => 'shell',
      description: () => 'shell',
      schema: () => ({ type: 'object', properties: { command: { type: 'string' } } }),
      requiresPermission: () => true,
      run: async () => 'unused (we exercise the BashTool branch)',
    });
    tools.register({
      name: () => 'BashTool',
      description: () => 'bash',
      schema: () => ({ type: 'object', properties: { command: { type: 'string' } } }),
      requiresPermission: () => true,
      run: async (args) => `bashed: ${String(args.command ?? '')}`,
    });
    const skills = new SkillRegistry();
    skills.add({
      name: 'unix-skill',
      description: 'declares the Unix name',
      tools: ['shell'], // canonical Unix spelling
      disableModelInvocation: false,
      path: '/virtual/unix/SKILL.md',
      body: '',
    });
    tools.register({
      name: () => 'load_skill',
      description: () => 'load_skill',
      schema: () => ({ type: 'object', properties: { name: { type: 'string' } } }),
      requiresPermission: () => false,
      async run(args) {
        const nm = typeof args.name === 'string' ? args.name : '';
        if (!skills.get(nm)) throw new Error(`unknown ${nm}`);
        return skills.get(nm)?.body ?? '';
      },
    });
    const agent = new Agent({
      client: new FakeClient([
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'c1',
                type: 'function',
                function: {
                  name: 'load_skill',
                  arguments: JSON.stringify({ name: 'unix-skill' }),
                },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'c2',
                type: 'function',
                function: {
                  name: 'BashTool', // PascalCase name; should be allowed via canonicalization
                  arguments: JSON.stringify({ command: 'id' }),
                },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' },
      ]),
      tools,
      skills,
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
    });
    const { events, sink } = collect();
    await agent.run('go', new AbortController().signal, sink);
    const bashResult = events.find((e) => e.type === 'tool-result' && e.name === 'BashTool');
    expect(bashResult && bashResult.type === 'tool-result' ? bashResult.err : '').toBe('');
    expect(bashResult && bashResult.type === 'tool-result' ? bashResult.result : '').toContain(
      'bashed: id',
    );
  });

  it('does not carry active skill tool restrictions into the next turn', async () => {
    const { agent, events, sink } = makeAgentWithSkill(
      [
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'load_skill', arguments: JSON.stringify({ name: 'narrow' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'first done' }, finishReason: 'stop' },
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: 'call_2',
                type: 'function',
                function: { name: 'shell', arguments: JSON.stringify({ command: 'id' }) },
              },
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'second done' }, finishReason: 'stop' },
      ],
      ['echo'],
    );

    await agent.run('first', new AbortController().signal, sink);
    await agent.run('second', new AbortController().signal, sink);

    const shellResult = events.find((e) => e.type === 'tool-result' && e.name === 'shell');
    expect(shellResult && shellResult.type === 'tool-result' ? shellResult.err : '').toBe('');
    expect(shellResult && shellResult.type === 'tool-result' ? shellResult.result : '').toContain(
      'ran:',
    );
  });
});

describe('reconcileToolCalls (H6)', () => {
  const asst = (...ids: string[]) => ({
    role: 'assistant' as const,
    content: '',
    toolCalls: ids.map((id) => ({
      id,
      type: 'function' as const,
      function: { name: `tool_${id}`, arguments: '{}' },
    })),
  });
  const toolMsg = (id: string) => ({
    role: 'tool' as const,
    content: 'ok',
    toolCallID: id,
    name: `tool_${id}`,
  });

  it('synthesizes a result for an unanswered tool call', () => {
    const out = reconcileToolCalls([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      asst('a', 'b'),
      toolMsg('a'),
    ]);
    // a synthetic tool(b) result must be appended right after tool(a)
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    const synth = out[4];
    expect(synth?.role).toBe('tool');
    expect(synth?.toolCallID).toBe('b');
    expect(synth?.name).toBe('tool_b');
    expect(synth?.content).toMatch(/did not complete/i);
  });

  it('is a no-op when every tool call is answered', () => {
    const input = [
      { role: 'system' as const, content: 's' },
      asst('a', 'b'),
      toolMsg('a'),
      toolMsg('b'),
    ];
    const out = reconcileToolCalls(input);
    expect(out).toHaveLength(input.length);
    expect(out.map((m) => m.toolCallID)).toEqual([undefined, undefined, 'a', 'b']);
  });

  it('repairs a dangling call mid-history without dropping later turns', () => {
    const out = reconcileToolCalls([
      asst('a'), // never answered
      { role: 'user', content: 'next turn' },
      asst('b'),
      toolMsg('b'),
    ]);
    expect(out.map((m) => `${m.role}:${m.toolCallID ?? ''}`)).toEqual([
      'assistant:',
      'tool:a', // synthesized, inserted before the user turn
      'user:',
      'assistant:',
      'tool:b',
    ]);
  });

  it('leaves a plain conversation untouched', () => {
    const input = [
      { role: 'system' as const, content: 's' },
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
    ];
    expect(reconcileToolCalls(input)).toEqual(input);
  });
});

// ---------- E1: parallel tool dispatch ----------

/** A tool that blocks until `n` instances are running at once, proving the
 *  agent dispatched them concurrently. If they ran sequentially the first
 *  never sees a second arrive and falls through the timeout, returning
 *  'serial' — a fast, deterministic failure rather than a hang. */
class BarrierTool implements Tool {
  private count = 0;
  private waiters: Array<(ok: boolean) => void> = [];
  constructor(private readonly need: number) {}
  name(): string {
    return 'barrier';
  }
  description(): string {
    return 'barrier';
  }
  schema(): Record<string, unknown> {
    return { type: 'object', properties: { id: { type: 'string' } } };
  }
  requiresPermission(): boolean {
    return false;
  }
  async run(args: Record<string, unknown>): Promise<string> {
    this.count += 1;
    if (this.count >= this.need) {
      for (const w of this.waiters) w(true);
      this.waiters = [];
      return `parallel-ok:${String(args.id ?? '')}`;
    }
    const ok = await new Promise<boolean>((resolve) => {
      this.waiters.push(resolve);
      setTimeout(() => resolve(false), 300);
    });
    return `${ok ? 'parallel-ok' : 'serial'}:${String(args.id ?? '')}`;
  }
}

/** A tool that sleeps for `delay_ms` then echoes `id` — used to verify result
 *  order is the call order, not the completion order. */
class DelayTool implements Tool {
  name(): string {
    return 'delay';
  }
  description(): string {
    return 'delay';
  }
  schema(): Record<string, unknown> {
    return { type: 'object', properties: { id: { type: 'string' }, delay_ms: { type: 'number' } } };
  }
  requiresPermission(): boolean {
    return false;
  }
  async run(args: Record<string, unknown>): Promise<string> {
    await new Promise((r) => setTimeout(r, Number(args.delay_ms ?? 0)));
    return `done:${String(args.id ?? '')}`;
  }
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } };
}

function agentWithTools(scripted: ChatResponse[], tools: Tool[]): Agent {
  const reg = new ToolRegistry();
  for (const t of tools) reg.register(t);
  return new Agent({
    client: new FakeClient(scripted),
    tools: reg,
    skills: new SkillRegistry(),
    prompter: new AlwaysAllow(),
    store: null,
    target: new Target(),
  });
}

describe('Agent parallel tool dispatch (E1)', () => {
  it('runs independent tool calls in the same step concurrently', async () => {
    const agent = agentWithTools(
      [
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              toolCall('c1', 'barrier', { id: 'a' }),
              toolCall('c2', 'barrier', { id: 'b' }),
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'done' }, finishReason: 'stop' },
      ],
      [new BarrierTool(2)],
    );
    const { events, sink } = collect();
    await agent.run('go', new AbortController().signal, sink);
    const results = events
      .filter((e) => e.type === 'tool-result')
      .map((e) => (e.type === 'tool-result' ? e.result : ''));
    // Both only resolve to parallel-ok if they were in flight simultaneously.
    expect(results).toEqual(['parallel-ok:a', 'parallel-ok:b']);
  });

  it('emits tool results in call order even when later calls finish first', async () => {
    const agent = agentWithTools(
      [
        {
          message: {
            role: 'assistant',
            content: '',
            toolCalls: [
              toolCall('c1', 'delay', { id: 'first', delay_ms: 60 }),
              toolCall('c2', 'delay', { id: 'second', delay_ms: 0 }),
            ],
          },
          finishReason: 'tool_calls',
        },
        { message: { role: 'assistant', content: 'done' }, finishReason: 'stop' },
      ],
      [new DelayTool()],
    );
    const { events, sink } = collect();
    await agent.run('go', new AbortController().signal, sink);
    const order = events
      .filter((e) => e.type === 'tool-result')
      .map((e) => (e.type === 'tool-result' ? e.result : ''));
    // 'second' finishes first, but results are recorded in call order.
    expect(order).toEqual(['done:first', 'done:second']);
    // History keeps the same order: assistant, tool(first), tool(second).
    const toolMsgs = agent.getHistory().filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.toolCallID)).toEqual(['c1', 'c2']);
  });
});

// ---------- M2: mid-turn context guard ----------

/** A tool that returns a large, fixed-size output so a few calls overflow a
 *  small context threshold within a single turn. */
class BigOutputTool implements Tool {
  constructor(private readonly size: number) {}
  name(): string {
    return 'big';
  }
  description(): string {
    return 'big';
  }
  schema(): Record<string, unknown> {
    return { type: 'object', properties: {} };
  }
  requiresPermission(): boolean {
    return false;
  }
  async run(): Promise<string> {
    return 'x'.repeat(this.size);
  }
}

describe('Agent mid-turn context guard (M2)', () => {
  it('elides the oldest large tool results in the working copy without touching history', async () => {
    // Six single-tool steps each return a 6000-char (~1500-token) result, then
    // a final text answer. With KEEP_RECENT=4, the guard can elide once the 5th
    // result lands and the working size crosses the threshold.
    const toolStep: ChatResponse = {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c', type: 'function', function: { name: 'big', arguments: '{}' } }],
      },
      finishReason: 'tool_calls',
    };
    const scripted: ChatResponse[] = [
      toolStep,
      toolStep,
      toolStep,
      toolStep,
      toolStep,
      toolStep,
      { message: { role: 'assistant', content: 'done' }, finishReason: 'stop' },
    ];
    const tools = new ToolRegistry();
    tools.register(new BigOutputTool(6000));
    const agent = new Agent({
      client: new FakeClient(scripted),
      tools,
      skills: new SkillRegistry(),
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
    });
    // Threshold above the starting (system+user) size so the between-turns gate
    // doesn't fire, but below what 5 big results push `working` to.
    agent.setAutoCompactThreshold(agent.approxTokens() + 5000);

    const { events, sink } = collect();
    await agent.run('go', new AbortController().signal, sink);

    // The guard emitted an informational event naming the elision.
    const guardEvent = events.find(
      (e) => e.type === 'decision' && e.summary.includes('context guard'),
    );
    expect(guardEvent).toBeDefined();

    // History keeps every tool result at full fidelity (only the working copy
    // was elided), so the saved session is lossless.
    const toolMsgs = agent.getHistory().filter((m) => m.role === 'tool');
    expect(toolMsgs.length).toBe(6);
    expect(toolMsgs.every((m) => m.content.length === 6000)).toBe(true);
  });
});

// ---------- Curated memory: pinned catalog + recall + survives compaction ----------

describe('Agent curated memory', () => {
  function makeMemoryAgent(scripted: ChatResponse[]) {
    const cwd = mkdtempSync(join(tmpdir(), 'pf-agent-mem-cwd-'));
    const home = mkdtempSync(join(tmpdir(), 'pf-agent-mem-home-'));
    const memoryStore = new MemoryStore({ cwd, home });
    const tools = new ToolRegistry();
    tools.register(new EchoTool());
    const agent = new Agent({
      client: new FakeClient(scripted),
      tools,
      skills: new SkillRegistry(),
      prompter: new AlwaysAllow(),
      store: null,
      target: new Target(),
      memoryStore,
    });
    return {
      agent,
      memoryStore,
      cleanup: () => {
        rmSync(cwd, { recursive: true, force: true });
        rmSync(home, { recursive: true, force: true });
      },
    };
  }

  it('pins a saved fact into the system prompt immediately (next turn)', async () => {
    const { agent, cleanup } = makeMemoryAgent([]);
    try {
      const fact = await agent.addMemory({ text: 'orders API IDOR on /api/orders/{id}' });
      expect(fact).not.toBeNull();
      const sys = agent.getHistory()[0]?.content ?? '';
      expect(sys).toContain('Saved memory');
      expect(sys).toContain(fact?.name ?? 'NOPE');
    } finally {
      cleanup();
    }
  });

  it('recalls a relevant fact into the turn and emits a memory-recall event', async () => {
    const { agent, cleanup } = makeMemoryAgent([
      { message: { role: 'assistant', content: 'ok' }, finishReason: 'stop' },
    ]);
    try {
      await agent.addMemory({ text: 'orders API IDOR via sequential id on /api/orders/{id}' });
      const { events, sink } = collect();
      await agent.run('test the orders endpoint for idor', new AbortController().signal, sink);
      const recall = events.find((e) => e.type === 'memory-recall');
      expect(recall && recall.type === 'memory-recall' ? recall.names.length : 0).toBeGreaterThan(
        0,
      );
    } finally {
      cleanup();
    }
  });

  it('keeps the saved-memory catalog in the prompt after a compaction', async () => {
    // compact() resets history to [system, summary]; the catalog must still be
    // present in the rebuilt system prompt so the model never "forgets" it.
    const { agent, cleanup } = makeMemoryAgent([
      { message: { role: 'assistant', content: 'COMPACTED SUMMARY' }, finishReason: 'stop' },
    ]);
    try {
      const fact = await agent.addMemory({ text: 'login OAuth redirect_uri bypass works' });
      // Seed a couple of turns of history so there is something to compact.
      agent.getHistory(); // no-op accessor
      await agent.compact(new AbortController().signal, () => {});
      const sys = agent.getHistory()[0]?.content ?? '';
      expect(sys).toContain('Saved memory');
      expect(sys).toContain(fact?.name ?? 'NOPE');
    } finally {
      cleanup();
    }
  });

  it('forgetMemory removes a curated fact and drops it from the prompt', async () => {
    const { agent, cleanup } = makeMemoryAgent([]);
    try {
      const fact = await agent.addMemory({ text: 'orders API IDOR on /api/orders/{id}' });
      const name = fact?.name ?? 'NOPE';
      expect(agent.listCuratedMemory()).toHaveLength(1);
      const removed = await agent.forgetMemory('orders');
      expect(removed).toContain(name);
      expect(agent.listCuratedMemory()).toHaveLength(0);
      expect(agent.getHistory()[0]?.content ?? '').not.toContain(name);
    } finally {
      cleanup();
    }
  });
});

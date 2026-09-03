// Probe tests. Cover both branches of probeToolSupport via a stub Client,
// and parseOllamaContextInfo with the three known sources.

import { describe, expect, it } from 'vitest';
import type { Client } from './client.js';
import { type OllamaContextInfo, parseOllamaContextInfo, probeToolSupport } from './probe.js';
import type { ChatRequest, ChatResponse } from './types.js';

function stubClient(reply: ChatResponse): Client {
  return {
    name: () => 'stub',
    model: () => 'stub-model',
    chat: async (_req: ChatRequest) => reply,
  };
}

function rejectingClient(err: Error): Client {
  return {
    name: () => 'stub',
    model: () => 'stub-model',
    chat: async () => {
      throw err;
    },
  };
}

describe('probeToolSupport', () => {
  it("returns 'yes' when the model calls the probe tool", async () => {
    const c = stubClient({
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: '__pentesterflow_probe_ping', arguments: '{"value":"ok"}' },
          },
        ],
      },
      finishReason: 'tool_calls',
    });
    const r = await probeToolSupport(c);
    expect(r.toolSupport).toBe('yes');
  });

  it("returns 'no' when the model returns plain text", async () => {
    const c = stubClient({
      message: { role: 'assistant', content: 'sure, here is the ping result: ok' },
      finishReason: 'stop',
    });
    const r = await probeToolSupport(c);
    expect(r.toolSupport).toBe('no');
    expect(r.detail).toMatch(/function-calling/);
  });

  it("returns 'no' when the model calls a different tool", async () => {
    const c = stubClient({
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'something_else', arguments: '{}' },
          },
        ],
      },
      finishReason: 'tool_calls',
    });
    const r = await probeToolSupport(c);
    expect(r.toolSupport).toBe('no');
  });

  it("returns 'unknown' when the client throws", async () => {
    const c = rejectingClient(new Error('connection refused'));
    const r = await probeToolSupport(c);
    expect(r.toolSupport).toBe('unknown');
  });
});

describe('parseOllamaContextInfo', () => {
  it('honors explicit `PARAMETER num_ctx <n>`', () => {
    const info = parseOllamaContextInfo({
      parameters: 'num_ctx 32768\nstop "<|endoftext|>"',
      model_info: { 'qwen2.context_length': 131072 },
    });
    expect(info).toEqual<OllamaContextInfo>({ numCtx: 32768, source: 'parameter' });
  });

  it('falls back to `<arch>.context_length` when no PARAMETER is set', () => {
    const info = parseOllamaContextInfo({
      parameters: 'stop "<|endoftext|>"',
      model_info: { 'llama.context_length': 8192 },
    });
    expect(info).toEqual<OllamaContextInfo>({ numCtx: 8192, source: 'metadata' });
  });

  it('falls back to 2048 when nothing is known', () => {
    const info = parseOllamaContextInfo({});
    expect(info).toEqual<OllamaContextInfo>({ numCtx: 2048, source: 'default' });
  });

  it('ignores malformed PARAMETER lines and uses metadata', () => {
    const info = parseOllamaContextInfo({
      parameters: 'num_ctx not-a-number',
      model_info: { 'gemma2.context_length': 4096 },
    });
    expect(info).toEqual<OllamaContextInfo>({ numCtx: 4096, source: 'metadata' });
  });

  it('handles model_info values that arrive as strings', () => {
    const info = parseOllamaContextInfo({
      model_info: { 'mistral.context_length': '16384' },
    });
    expect(info.numCtx).toBe(16384);
    expect(info.source).toBe('metadata');
  });
});

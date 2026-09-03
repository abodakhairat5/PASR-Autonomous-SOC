// Startup checks for the active LLM. Two things matter for an agent:
//
//   1. The model emits real tool_calls (not just text that *describes*
//      calling a tool). If it doesn't, the agent loop spins until
//      max_steps because every turn returns plain prose where we expect
//      a function call.
//
//   2. The model's context window is at least as big as the conversation
//      history we plan to feed it. Ollama defaults to num_ctx=2048,
//      which silently truncates input on every turn — the agent has
//      no way to detect this from the chat response.
//
// Both probes are best-effort: failure is reported as 'unknown', never
// fatal, so a slow / offline backend doesn't block startup.

import { warn } from '../logger/logger.js';
import type { Client } from './client.js';
import type { ChatRequest, ToolSpec } from './types.js';

const PROBE_TIMEOUT_MS = 8_000;
const PING_TOOL_NAME = '__pentesterflow_probe_ping';

/**
 * Status of the tool-calling capability probe:
 *   'yes'     — the model produced a tool_call for our probe.
 *   'no'      — the model responded with text (or no tool_calls).
 *   'unknown' — the probe failed (network, timeout, parse error).
 */
export type ToolSupport = 'yes' | 'no' | 'unknown';

export interface ProbeResult {
  toolSupport: ToolSupport;
  /** Detail string suitable for a stderr warning when toolSupport === 'no'. */
  detail?: string;
}

/**
 * Send a minimal chat that forces a tool_call decision. The system prompt
 * instructs the model to *only* call the ping tool — if it produces text
 * instead, this model isn't usable as an agent.
 *
 * Returns 'unknown' on any failure so the caller can decide whether to
 * surface a warning, retry, or proceed.
 */
export async function probeToolSupport(
  client: Client,
  parentSignal?: AbortSignal,
): Promise<ProbeResult> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (parentSignal?.aborted) ctl.abort();
  else parentSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);

  const pingTool: ToolSpec = {
    type: 'function',
    function: {
      name: PING_TOOL_NAME,
      description: 'Echo back the value you receive. Used to verify tool-calling works.',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string', description: 'Echo this string back verbatim.' },
        },
        required: ['value'],
      },
    },
  };

  const req: ChatRequest = {
    model: client.model(),
    messages: [
      {
        role: 'system',
        content:
          'You are a tool-calling probe. Your ONLY response must be a call to the `__pentesterflow_probe_ping` tool with value="ok". Do not produce any text. Do not call any other tool.',
      },
      { role: 'user', content: 'probe' },
    ],
    tools: [pingTool],
  };

  try {
    const resp = await client.chat(req, ctl.signal);
    const calls = resp.message.toolCalls ?? [];
    const called = calls.some((c) => c.function.name === PING_TOOL_NAME);
    if (called) return { toolSupport: 'yes' };
    return {
      toolSupport: 'no',
      detail:
        'model returned text instead of a tool_call — agent loop will not work. Pick a function-calling model (e.g. qwen2.5-coder, llama3.1+).',
    };
  } catch (err) {
    warn('llm probe failed', { err: err instanceof Error ? err.message : String(err) });
    return { toolSupport: 'unknown' };
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

// ---------- Ollama context-window detection ----------

const CTX_PROBE_TIMEOUT_MS = 5_000;

export interface OllamaContextInfo {
  /** Effective num_ctx the server will use for this model. */
  numCtx: number;
  /** Where the value came from: explicit PARAMETER, model metadata, or default. */
  source: 'parameter' | 'metadata' | 'default';
}

/**
 * Query Ollama's /api/show endpoint for the model's effective context
 * window. The endpoint returns:
 *
 *   {
 *     parameters: "num_ctx 8192\nstop ...",   // human-readable PARAMETER lines
 *     model_info: { "<arch>.context_length": 32768 },
 *     ...
 *   }
 *
 * We prefer the explicit PARAMETER (what Ollama will actually use); fall
 * back to the model's metadata window if no PARAMETER is set; fall back
 * to 2048 (Ollama's default) if neither is present.
 */
export async function detectOllamaContextWindow(
  baseURL: string,
  model: string,
  parentSignal?: AbortSignal,
): Promise<OllamaContextInfo | undefined> {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (parentSignal?.aborted) ctl.abort();
  else parentSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), CTX_PROBE_TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseURL}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: ctl.signal,
    });
    if (resp.status !== 200) return undefined;
    const body = (await resp.json()) as {
      parameters?: unknown;
      model_info?: Record<string, unknown>;
    };
    return parseOllamaContextInfo(body);
  } catch (err) {
    warn('ollama context probe failed', { err: err instanceof Error ? err.message : String(err) });
    return undefined;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

/** Exposed for tests. */
export function parseOllamaContextInfo(body: {
  parameters?: unknown;
  model_info?: Record<string, unknown>;
}): OllamaContextInfo {
  // 1. Explicit `PARAMETER num_ctx <n>`. The `parameters` field is a
  //    newline-delimited string of "key value" pairs.
  if (typeof body.parameters === 'string') {
    for (const line of body.parameters.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('num_ctx')) continue;
      const parts = trimmed.split(/\s+/);
      const n = Number.parseInt(parts[1] ?? '', 10);
      if (Number.isFinite(n) && n > 0) return { numCtx: n, source: 'parameter' };
    }
  }
  // 2. Model metadata. The key is "<arch>.context_length" — architecture
  //    varies (llama, qwen2, gemma, ...). Look for any *.context_length.
  if (body.model_info) {
    for (const [k, v] of Object.entries(body.model_info)) {
      if (!k.endsWith('.context_length')) continue;
      const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
      if (Number.isFinite(n) && n > 0) return { numCtx: n, source: 'metadata' };
    }
  }
  // 3. Ollama default.
  return { numCtx: 2048, source: 'default' };
}

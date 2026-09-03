// Ollama backend. behavior:
// - POST /api/chat with stream=true emits ND-JSON; accumulate tool calls
//   as they arrive (the terminal `done:true` chunk often carries an empty
//   tool_calls slice, so relying on the last chunk drops calls).
// - Malformed streamed chunks are logged with a preview (warn level) and
//   skipped — silently dropping them caused tool calls to vanish.
// - GET /api/tags for the health probe.

import { warn } from '../logger/logger.js';
import type { Client, Pinger, StreamingClient } from './client.js';
import { type BackendError, classifyBackend, parseRetryAfter } from './errors.js';
import { newCallID } from './ids.js';
import { withRetry } from './retry.js';
import type { ChatRequest, ChatResponse, FinishReason, Message, ToolCall } from './types.js';

/** Annotate a backend error with the server's Retry-After so withRetry can
 *  honor it instead of its computed backoff. */
function withRetryAfter(err: BackendError, resp: Response): BackendError {
  const ms = parseRetryAfter(resp.headers.get('retry-after'));
  if (ms !== undefined) err.retryAfterMs = ms;
  return err;
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChatResp {
  message?: OllamaMessage;
  done?: boolean;
  /** Why generation stopped: 'stop', 'length' (hit num_predict/num_ctx), ... */
  done_reason?: string;
}
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;
// Floor for the context window when none is configured. Ollama silently
// defaults to num_ctx=2048 and truncates input every turn; 8192 is a sane
// minimum for agent histories. A probed/configured value overrides this.
const OLLAMA_DEFAULT_NUM_CTX = 8192;

export class OllamaClient implements Client, StreamingClient, Pinger {
  readonly baseURL: string;
  readonly modelID: string;
  private numCtx?: number;
  private readonly temperature?: number;
  private readonly maxTokens?: number;

  constructor(
    baseURL: string,
    model: string,
    numCtx?: number,
    genOpts: { temperature?: number; maxTokens?: number } = {},
  ) {
    this.baseURL = baseURL || 'http://localhost:11434';
    this.modelID = model;
    this.numCtx = numCtx;
    this.temperature = genOpts.temperature;
    this.maxTokens = genOpts.maxTokens;
  }

  /** Apply the context window detected at startup (detectOllamaContextWindow).
   *  Callers holding the client use this after the probe so the next request
   *  stops silently truncating input at Ollama's 2048 default. */
  setNumCtx(n: number): void {
    if (Number.isFinite(n) && n > 0) this.numCtx = n;
  }

  name(): string {
    return 'ollama';
  }

  model(): string {
    return this.modelID;
  }

  async ping(signal?: AbortSignal): Promise<void> {
    try {
      const resp = await fetch(`${this.baseURL}/api/tags`, { method: 'GET', signal });
      if (resp.status >= 500) {
        throw new Error(`ollama status ${resp.status}`);
      }
    } catch (err) {
      if (err instanceof Error) throw err;
      throw new Error(String(err));
    }
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    // Retry rate limits / transient 5xx with backoff (E7). The non-streaming
    // call has no observable side effects before it returns, so re-running it
    // wholesale is safe.
    return withRetry(() => this.chatOnce(req, signal), { signal });
  }

  private async chatOnce(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body = this.encodeRequest(req, false);
    const { signal: combinedSignal, dispose } = withTimeout(signal, CHAT_TIMEOUT_MS);
    try {
      let resp: Response;
      try {
        resp = await fetch(`${this.baseURL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (err) {
        throw classifyBackend('ollama', err, 0, undefined);
      }
      const raw = await resp.text();
      if (resp.status !== 200) {
        throw withRetryAfter(classifyBackend('ollama', null, resp.status, raw), resp);
      }
      let parsed: OllamaChatResp;
      try {
        parsed = JSON.parse(raw) as OllamaChatResp;
      } catch {
        throw classifyBackend('ollama', null, resp.status, `invalid JSON from ollama: ${raw}`);
      }
      return this.assembleResponse(
        parsed.message ?? { role: 'assistant', content: '' },
        req.tools,
        parsed.done_reason,
      );
    } finally {
      dispose();
    }
  }

  async chatStream(
    req: ChatRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> {
    // Retry only the connection setup (E7): a transient 429/5xx surfaces before
    // any delta is emitted, so re-opening can't double-emit tokens. Once the
    // 200 stream is flowing, a mid-stream failure is NOT retried.
    const { resp, dispose } = await withRetry(() => this.openStream(req, signal), { signal });
    if (!resp.body) {
      dispose();
      throw new Error('ollama: empty stream body');
    }

    let content = '';
    const toolCalls: OllamaToolCall[] = [];
    let skipped = 0;
    let doneReason: string | undefined;

    try {
      for await (const line of iterLines(resp.body)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let chunk: OllamaChatResp;
        try {
          chunk = JSON.parse(trimmed) as OllamaChatResp;
        } catch (err) {
          // Defensive logging. Drop the chunk but
          // surface enough detail to diagnose vanished tool calls.
          skipped += 1;
          const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
          warn('ollama: dropped malformed stream chunk', {
            err: err instanceof Error ? err.message : String(err),
            preview,
            total_skipped: skipped,
          });
          continue;
        }
        if (chunk.message?.content) {
          content += chunk.message.content;
          onDelta(chunk.message.content);
        }
        if (chunk.message?.tool_calls?.length) {
          toolCalls.push(...chunk.message.tool_calls);
        }
        if (chunk.done) {
          doneReason = chunk.done_reason;
          break;
        }
      }
    } finally {
      dispose();
    }

    return this.assembleResponse(
      { role: 'assistant', content, tool_calls: toolCalls },
      req.tools,
      doneReason,
    );
  }

  /** Open the streaming response and pair it with a `dispose` that cancels its
   *  timeout, or throw a (retry-annotated) BackendError. Extracted so withRetry
   *  can re-attempt setup without re-entering the consume loop; on success the
   *  caller owns `dispose` and must call it once the stream is consumed. */
  private async openStream(
    req: ChatRequest,
    signal?: AbortSignal,
  ): Promise<{ resp: Response; dispose: () => void }> {
    const body = this.encodeRequest(req, true);
    const { signal: combinedSignal, dispose } = withTimeout(signal, CHAT_TIMEOUT_MS);
    try {
      let resp: Response;
      try {
        resp = await fetch(`${this.baseURL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: combinedSignal,
        });
      } catch (err) {
        throw classifyBackend('ollama', err, 0, undefined);
      }
      if (resp.status !== 200) {
        const raw = await resp.text();
        throw withRetryAfter(classifyBackend('ollama', null, resp.status, raw), resp);
      }
      return { resp, dispose };
    } catch (err) {
      // Failed attempt: clear its timer now so a retry doesn't leak it.
      dispose();
      throw err;
    }
  }

  private encodeRequest(req: ChatRequest, stream: boolean) {
    // Pin the context window so Ollama doesn't silently truncate at its 2048
    // default. A probed/configured value wins; otherwise floor at 8192 (M-num_ctx).
    // temperature / num_predict (max tokens) are forwarded only when the user
    // configured them, so the model's own defaults apply otherwise.
    const options: { num_ctx: number; temperature?: number; num_predict?: number } = {
      num_ctx: this.numCtx ?? OLLAMA_DEFAULT_NUM_CTX,
    };
    if (this.temperature !== undefined) options.temperature = this.temperature;
    if (this.maxTokens !== undefined && this.maxTokens > 0) options.num_predict = this.maxTokens;
    return {
      model: this.modelID,
      stream,
      options,
      messages: req.messages.map((m) => {
        const out: OllamaMessage = { role: m.role, content: m.content };
        if (m.toolCalls?.length) {
          out.tool_calls = m.toolCalls.map((tc) => {
            let args: Record<string, unknown> = {};
            if (tc.function.arguments) {
              try {
                args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
              } catch {
                args = {};
              }
            }
            return { function: { name: tc.function.name, arguments: args } };
          });
        }
        return out;
      }),
      tools: req.tools?.map((t) => ({
        type: 'function',
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      })),
    };
  }

  private assembleResponse(
    msg: OllamaMessage,
    tools?: ChatRequest['tools'],
    doneReason?: string,
  ): ChatResponse {
    const out: Message = { role: 'assistant', content: msg.content ?? '' };
    const toolCalls = msg.tool_calls?.length
      ? msg.tool_calls
      : parseContentToolCalls(
          msg.content ?? '',
          new Set((tools ?? []).map((t) => t.function.name)),
        );

    if (toolCalls.length) {
      out.toolCalls = toolCalls.map<ToolCall>((tc) => ({
        id: newCallID(),
        type: 'function',
        function: {
          name: tc.function.name,
          arguments: JSON.stringify(tc.function.arguments ?? {}),
        },
      }));
    }
    return {
      message: out,
      finishReason: mapFinishReason(doneReason, Boolean(out.toolCalls?.length)),
    };
  }
}

/** Map Ollama's `done_reason` onto a FinishReason. A `length` truncation (hit
 *  num_predict / num_ctx) is surfaced so the agent can tell a capped turn from
 *  a clean one; otherwise tool calls win, then a plain stop. */
function mapFinishReason(doneReason: string | undefined, hasToolCalls: boolean): FinishReason {
  if (doneReason === 'length') return 'length';
  return hasToolCalls ? 'tool_calls' : 'stop';
}

function parseContentToolCalls(content: string, knownTools: Set<string>): OllamaToolCall[] {
  if (knownTools.size === 0) return [];

  const parsed = parseJSONFromContent(content);
  if (parsed === undefined) return [];

  return normalizeToolCalls(parsed, knownTools);
}

function parseJSONFromContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return undefined;

  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function normalizeToolCalls(value: unknown, knownTools: Set<string>): OllamaToolCall[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeToolCalls(item, knownTools));
  }
  if (!isRecord(value)) return [];

  const calls =
    value.tool_calls ??
    value.toolCalls ??
    value.tool_call ??
    value.toolCall ??
    value.function_call ??
    value.functionCall;
  if (isRecord(calls)) {
    return normalizeToolCalls(calls, knownTools);
  }
  if (Array.isArray(calls)) {
    return calls.flatMap((item) => normalizeToolCalls(item, knownTools));
  }

  const functionValue = value.function;
  if (isRecord(functionValue)) {
    const call = normalizeNamedCall(functionValue.name, functionValue.arguments, knownTools);
    return call ? [call] : [];
  }
  if (typeof functionValue === 'string') {
    const args = value.arguments ?? value.args ?? value.parameters ?? value.input ?? {};
    const call = normalizeNamedCall(functionValue, args, knownTools);
    return call ? [call] : [];
  }

  const name =
    value.name ??
    value.tool ??
    value.tool_name ??
    value.toolName ??
    value.action ??
    value.action_name ??
    value.actionName;
  const args =
    value.arguments ??
    value.args ??
    value.parameters ??
    value.input ??
    value.action_input ??
    value.actionInput ??
    {};
  const call = normalizeNamedCall(name, args, knownTools);
  return call ? [call] : [];
}

function normalizeNamedCall(
  nameValue: unknown,
  argsValue: unknown,
  knownTools: Set<string>,
): OllamaToolCall | undefined {
  if (typeof nameValue !== 'string' || !knownTools.has(nameValue)) return undefined;

  let args: unknown = argsValue;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      args = {};
    }
  }
  const argsRecord = isRecord(args) ? args : {};

  return {
    function: {
      name: nameValue,
      arguments: argsRecord,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Decode a byte stream into newline-delimited string chunks. */
async function* iterLines(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        yield buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** Build a per-request abort signal that fires when `parent` aborts OR after
 *  `ms`, paired with a `dispose` that clears the timer and detaches the
 *  listener. Replaces AbortSignal.timeout/any, whose 10-minute timers stay
 *  pending until they fire even after the request settles — leaking one timer
 *  per call. Call `dispose()` in a finally once the request is done. */
function withTimeout(
  parent: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; dispose: () => void } {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (parent?.aborted) ctl.abort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), ms);
  return {
    signal: ctl.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

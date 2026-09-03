// LLM client interfaces.
//
// Streaming uses an `onDelta` callback rather than an async iterator so
// the call site (agent.chat) can keep its imperative shape. The agent
// can wrap onDelta into an iterator if it wants to expose tokens as a
// stream further up.

import type { ChatRequest, ChatResponse } from './types.js';

export interface Client {
  /** Backend label (e.g. "ollama", "lmstudio", "openai-compat"). */
  name(): string;
  /** Currently-selected model id. */
  model(): string;
  /** Non-streaming chat request. */
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
}

export interface StreamingClient extends Client {
  /**
   * Streaming chat. `onDelta` is invoked for each token/chunk; the
   * returned promise resolves once the stream completes with the
   * accumulated message + finish reason.
   */
  chatStream(
    req: ChatRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse>;
}

export interface Pinger {
  /**
   * Cheap GET against the backend's health endpoint. Resolves on
   * reachable (incl. 401/403 — server is up), rejects on transport
   * failure or 5xx. Used by the TUI's status-bar `ready`/`disconnected`
   * indicator.
   */
  ping(signal?: AbortSignal): Promise<void>;
}

export function isStreaming(c: Client): c is StreamingClient {
  return typeof (c as Partial<StreamingClient>).chatStream === 'function';
}

export function isPinger(c: Client): c is Client & Pinger {
  return typeof (c as Partial<Pinger>).ping === 'function';
}

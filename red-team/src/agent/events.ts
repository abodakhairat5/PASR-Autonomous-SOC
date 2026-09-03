// Event types the agent emits during a run / compact. The TUI subscribes to the event stream
// and renders each one into the transcript.

export interface AssistantTextEvent {
  type: 'assistant-text';
  text: string;
}
export interface AssistantDeltaEvent {
  type: 'assistant-delta';
  text: string;
}
export interface ToolCallEvent {
  type: 'tool-call';
  id: string;
  name: string;
  args: Record<string, unknown>;
  argsJSON: string;
}
export interface ToolResultEvent {
  type: 'tool-result';
  id: string;
  name: string;
  result: string;
  err: string;
  durationMs: number;
}
export interface ErrorEvent {
  type: 'error';
  err: Error;
}
export interface CompactEvent {
  type: 'compact';
  summary: string;
  tokensBefore?: number;
  tokensAfter?: number;
  memoryItems?: number;
}
export interface DecisionEvent {
  type: 'decision';
  summary: string;
}
export interface SkillActiveEvent {
  type: 'skill-active';
  name: string;
}
export interface MemoryRecallEvent {
  type: 'memory-recall';
  names: string[];
}
export interface DoneEvent {
  type: 'done';
}

export interface PolicyDecisionEvent {
  type: 'policy-decision';
  hostname: string;
  action: 'allow' | 'deny' | 'require-approval';
  reason: string;
}

export interface EvidenceCapturedEvent {
  type: 'evidence-captured';
  evidenceId: string;
  tool: string;
  hash: string;
}

export interface ExperienceRecordedEvent {
  type: 'experience-recorded';
  experienceId: string;
  category: string;
  outcome: string;
}

export type AgentEvent =
  | AssistantTextEvent
  | AssistantDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ErrorEvent
  | CompactEvent
  | DecisionEvent
  | SkillActiveEvent
  | MemoryRecallEvent
  | DoneEvent
  | PolicyDecisionEvent
  | EvidenceCapturedEvent
  | ExperienceRecordedEvent;

/** MaxStepsError is the recognizable Error subtype raised when the tool
 *  loop hits the per-turn cap. The TUI promotes it to a friendlier alert. */
export class MaxStepsError extends Error {
  readonly steps: number;
  constructor(steps: number) {
    super(`hit max steps (${steps}) without finishing`);
    this.name = 'MaxStepsError';
    this.steps = steps;
  }
}
